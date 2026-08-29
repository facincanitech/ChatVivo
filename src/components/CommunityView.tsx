import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/displayName'
import { getErrorMessage } from '../lib/errors'
import { ReplayPlayer, type ReplayEvent } from './ReplayPlayer'
import { IconArrowLeft, IconEdit, IconSend, IconSmile, IconUser } from './icons'
import type { Community, Profile } from '../types'

const REACTION_EMOJIS = ['😀', '😂', '😍', '😭', '🔥', '👍', '🙏', '😡']
const REPLAY_WINDOW_MS = 20000

type PostAuthor = { username: string; display_name: string | null; avatar_url: string | null }

type Post = {
  id: string
  community_id: string
  author_id: string
  content: string | null
  image_url: string | null
  created_at: string
  edited_at: string | null
  events: ReplayEvent[] | null
}

type Comment = {
  id: string
  post_id: string
  author_id: string
  content: string
  created_at: string
  edited_at: string | null
  events: ReplayEvent[] | null
}

type Reaction = { post_id: string; user_id: string; emoji: string }

type MemberProfile = { id: string; username: string; display_name: string | null; avatar_url: string | null; is_editor: boolean }

type Props = {
  me: Profile
  community: Community
  onBack: () => void
  onCommunityUpdate: (patch: Partial<Community>) => void
}

function recordEvent(bufferRef: React.MutableRefObject<ReplayEvent[]>, text: string) {
  const now = Date.now()
  bufferRef.current.push({ t: now, text })
  bufferRef.current = bufferRef.current.filter((e) => now - e.t <= REPLAY_WINDOW_MS)
}

export function CommunityView({ me, community, onBack, onCommunityUpdate }: Props) {
  const [posts, setPosts] = useState<Post[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [authors, setAuthors] = useState<Record<string, PostAuthor>>({})
  const [memberCount, setMemberCount] = useState(0)
  const [isMember, setIsMember] = useState(false)
  const [memberList, setMemberList] = useState<MemberProfile[]>([])
  const [draft, setDraft] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [editName, setEditName] = useState('')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [infoBusy, setInfoBusy] = useState(false)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [editPostDraft, setEditPostDraft] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentDraft, setEditCommentDraft] = useState('')
  const [replayFor, setReplayFor] = useState<{ events: ReplayEvent[] } | null>(null)

  const newPostEvents = useRef<ReplayEvent[]>([])
  const editPostEvents = useRef<ReplayEvent[]>([])
  const commentEventsRef = useRef<Record<string, ReplayEvent[]>>({})
  const editCommentEvents = useRef<ReplayEvent[]>([])

  const isOwner = community.created_by === me.id
  const myMembership = memberList.find((m) => m.id === me.id)
  const isManager = isOwner || !!myMembership?.is_editor

  async function load() {
    const { data: memberRows } = await supabase
      .from('community_members')
      .select('user_id, is_editor')
      .eq('community_id', community.id)
    setMemberCount(memberRows?.length || 0)
    setIsMember(!!memberRows?.some((r) => r.user_id === me.id))

    const memberIds = (memberRows || []).map((r) => r.user_id as string)
    if (memberIds.length > 0) {
      const { data: memberProfiles } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', memberIds)
      const editorMap = new Map((memberRows || []).map((r) => [r.user_id as string, !!r.is_editor]))
      setMemberList(
        ((memberProfiles as Omit<MemberProfile, 'is_editor'>[]) || []).map((p) => ({
          ...p,
          is_editor: editorMap.get(p.id) || false,
        })),
      )
    } else {
      setMemberList([])
    }

    const { data: postRows } = await supabase
      .from('community_posts')
      .select('*')
      .eq('community_id', community.id)
      .order('created_at', { ascending: false })
    const loadedPosts = (postRows as Post[]) || []
    setPosts(loadedPosts)

    const postIds = loadedPosts.map((p) => p.id)
    if (postIds.length === 0) {
      setComments([])
      setReactions([])
      return
    }

    const [{ data: commentRows }, { data: reactionRows }] = await Promise.all([
      supabase.from('community_comments').select('*').in('post_id', postIds).order('created_at', { ascending: true }),
      supabase.from('community_reactions').select('*').in('post_id', postIds),
    ])
    setComments((commentRows as Comment[]) || [])
    setReactions((reactionRows as Reaction[]) || [])

    const authorIds = Array.from(
      new Set([
        ...loadedPosts.map((p) => p.author_id),
        ...((commentRows as Comment[]) || []).map((c) => c.author_id),
      ]),
    )
    if (authorIds.length > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', authorIds)
      const map: Record<string, PostAuthor> = {}
      for (const p of profileRows || []) {
        map[p.id] = { username: p.username, display_name: p.display_name, avatar_url: p.avatar_url }
      }
      setAuthors(map)
    }
  }

  useEffect(() => {
    load()
  }, [community.id])

  function authorLabel(id: string): string {
    const a = authors[id]
    return a ? displayName(a) : '...'
  }

  function openInfo() {
    setEditName(community.name)
    setEditImageUrl(community.image_url || '')
    setInfoError(null)
    setShowInfo(true)
  }

  async function saveCommunityInfo() {
    const name = editName.trim()
    if (!name) return
    setInfoBusy(true)
    setInfoError(null)
    try {
      const image_url = editImageUrl.trim() || null
      const { error: err } = await supabase
        .from('communities')
        .update({ name, image_url })
        .eq('id', community.id)
      if (err) throw err
      onCommunityUpdate({ name, image_url })
      setShowInfo(false)
    } catch (err) {
      setInfoError(getErrorMessage(err))
    } finally {
      setInfoBusy(false)
    }
  }

  async function removeParticipant(userId: string) {
    await supabase.from('community_members').delete().eq('community_id', community.id).eq('user_id', userId)
    setMemberList((prev) => prev.filter((m) => m.id !== userId))
    setMemberCount((n) => Math.max(0, n - 1))
    if (userId === me.id) setIsMember(false)
  }

  async function toggleEditor(userId: string, next: boolean) {
    await supabase.from('community_members').update({ is_editor: next }).eq('community_id', community.id).eq('user_id', userId)
    setMemberList((prev) => prev.map((m) => (m.id === userId ? { ...m, is_editor: next } : m)))
  }

  async function joinCommunity() {
    await supabase.from('community_members').insert({ community_id: community.id, user_id: me.id })
    setIsMember(true)
    setMemberCount((n) => n + 1)
  }

  async function leaveCommunity() {
    await supabase.from('community_members').delete().eq('community_id', community.id).eq('user_id', me.id)
    setIsMember(false)
    setMemberCount((n) => Math.max(0, n - 1))
  }

  async function createPost() {
    const content = draft.trim()
    const img = imageUrl.trim()
    if (!content && !img) return
    setBusy(true)
    setError(null)
    try {
      const eventsToStore = newPostEvents.current.length > 1 ? newPostEvents.current : null
      const { data, error: err } = await supabase
        .from('community_posts')
        .insert({ community_id: community.id, author_id: me.id, content: content || null, image_url: img || null, events: eventsToStore })
        .select()
        .single()
      if (err) throw err
      setPosts((prev) => [data as Post, ...prev])
      setAuthors((prev) => (prev[me.id] ? prev : { ...prev, [me.id]: { username: me.username, display_name: me.display_name ?? null, avatar_url: me.avatar_url ?? null } }))
      setDraft('')
      setImageUrl('')
      newPostEvents.current = []
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function startEditPost(post: Post) {
    setEditingPostId(post.id)
    setEditPostDraft(post.content || '')
    editPostEvents.current = []
    recordEvent(editPostEvents, post.content || '')
  }

  async function saveEditPost(postId: string) {
    const content = editPostDraft.trim()
    if (!content) return
    const eventsToStore = editPostEvents.current.length > 1 ? editPostEvents.current : null
    const edited_at = new Date().toISOString()
    await supabase.from('community_posts').update({ content, events: eventsToStore, edited_at }).eq('id', postId)
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, content, events: eventsToStore, edited_at } : p)))
    setEditingPostId(null)
    setEditPostDraft('')
    editPostEvents.current = []
  }

  async function react(postId: string, emoji: string) {
    setReactionPickerFor(null)
    const mine = reactions.find((r) => r.post_id === postId && r.user_id === me.id)
    if (mine && mine.emoji === emoji) {
      await supabase.from('community_reactions').delete().eq('post_id', postId).eq('user_id', me.id)
      setReactions((prev) => prev.filter((r) => !(r.post_id === postId && r.user_id === me.id)))
      return
    }
    await supabase.from('community_reactions').upsert({ post_id: postId, user_id: me.id, emoji })
    setReactions((prev) => [...prev.filter((r) => !(r.post_id === postId && r.user_id === me.id)), { post_id: postId, user_id: me.id, emoji }])
  }

  async function submitComment(postId: string) {
    const content = (commentDrafts[postId] || '').trim()
    if (!content) return
    const buf = commentEventsRef.current[postId] || []
    const eventsToStore = buf.length > 1 ? buf : null
    const { data, error: err } = await supabase
      .from('community_comments')
      .insert({ post_id: postId, author_id: me.id, content, events: eventsToStore })
      .select()
      .single()
    if (err) {
      setError(getErrorMessage(err))
      return
    }
    setComments((prev) => [...prev, data as Comment])
    setAuthors((prev) => (prev[me.id] ? prev : { ...prev, [me.id]: { username: me.username, display_name: me.display_name ?? null, avatar_url: me.avatar_url ?? null } }))
    setCommentDrafts((prev) => ({ ...prev, [postId]: '' }))
    commentEventsRef.current[postId] = []
  }

  function startEditComment(c: Comment) {
    setEditingCommentId(c.id)
    setEditCommentDraft(c.content)
    editCommentEvents.current = []
    recordEvent(editCommentEvents, c.content)
  }

  async function saveEditComment(commentId: string) {
    const content = editCommentDraft.trim()
    if (!content) return
    const eventsToStore = editCommentEvents.current.length > 1 ? editCommentEvents.current : null
    const edited_at = new Date().toISOString()
    await supabase.from('community_comments').update({ content, events: eventsToStore, edited_at }).eq('id', commentId)
    setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, content, events: eventsToStore, edited_at } : c)))
    setEditingCommentId(null)
    setEditCommentDraft('')
    editCommentEvents.current = []
  }

  function toggleExpanded(postId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  function reactionSummary(postId: string): { emoji: string; count: number }[] {
    const counts: Record<string, number> = {}
    for (const r of reactions) {
      if (r.post_id !== postId) continue
      counts[r.emoji] = (counts[r.emoji] || 0) + 1
    }
    return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }))
  }

  return (
    <main className="main">
      <header className="chat-header">
        <button type="button" className="icon-btn" onClick={onBack}><IconArrowLeft size={20} /></button>
        <div className="header-photo" style={{ overflow: 'hidden', cursor: 'pointer' }} onClick={openInfo}>
          {community.image_url ? (
            <img src={community.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            community.name[0]?.toUpperCase()
          )}
        </div>
        <div className="header-text" style={{ cursor: 'pointer' }} onClick={openInfo}>
          <div className="header-name">{community.name}</div>
          <div className="status">
            {memberCount} {memberCount === 1 ? 'participante' : 'participantes'}
            {community.category ? ` · ${community.category}` : ''}
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="google-btn" onClick={isMember ? leaveCommunity : joinCommunity}>
            {isMember ? 'Sair da comunidade' : 'Participar'}
          </button>
        </div>
      </header>

      <section className="messages community-feed">
        {community.description && <p className="community-description">{community.description}</p>}

        {isMember && (
          <div className="community-composer">
            <textarea
              placeholder="Novo tópico..."
              value={draft}
              onChange={(e) => { setDraft(e.target.value); recordEvent(newPostEvents, e.target.value) }}
              rows={2}
            />
            <input
              placeholder="link de imagem (opcional)"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
            <button type="button" disabled={busy} onClick={createPost}>Postar</button>
            {error && <span className="auth-error">{error}</span>}
          </div>
        )}
        {!isMember && <p className="community-description">Participe da comunidade pra postar e comentar.</p>}

        {posts.length === 0 && <div className="empty">Nenhum tópico ainda</div>}

        {posts.map((post) => {
          const postComments = comments.filter((c) => c.post_id === post.id)
          const isExpanded = expanded.has(post.id)
          const myReaction = reactions.find((r) => r.post_id === post.id && r.user_id === me.id)
          const authorMember = memberList.find((m) => m.id === post.author_id)
          return (
            <div key={post.id} className="community-post">
              <div className="community-post-header">
                <div className="option-icon"><IconUser size={18} /></div>
                <div>
                  <div className="author-label" style={{ marginBottom: 0 }}>
                    {authorLabel(post.author_id)}
                    {authorMember?.is_editor && <IconEdit size={11} />}
                  </div>
                  <div className="status" style={{ marginTop: 0 }}>
                    {new Date(post.created_at).toLocaleString('pt-BR')}{post.edited_at ? ' (editado)' : ''}
                  </div>
                </div>
                {post.author_id === me.id && editingPostId !== post.id && (
                  <button type="button" className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => startEditPost(post)} title="Editar tópico">
                    <IconEdit size={16} />
                  </button>
                )}
              </div>

              {editingPostId === post.id ? (
                <div style={{ marginTop: 10 }}>
                  <textarea
                    className="edit-message-input"
                    value={editPostDraft}
                    onChange={(e) => { setEditPostDraft(e.target.value); recordEvent(editPostEvents, e.target.value) }}
                    rows={2}
                    autoFocus
                  />
                  <button type="button" className="replay-btn" onClick={() => saveEditPost(post.id)}>salvar</button>
                  <button type="button" className="replay-btn" onClick={() => setEditingPostId(null)}>cancelar</button>
                </div>
              ) : (
                <>
                  {post.content && <p className="community-post-content">{post.content}</p>}
                  {post.image_url && <img src={post.image_url} alt="" className="community-post-image" />}
                </>
              )}

              <div className="community-post-actions">
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="replay-btn"
                    onClick={() => setReactionPickerFor((v) => (v === post.id ? null : post.id))}
                  >
                    <IconSmile size={14} /> {myReaction ? myReaction.emoji : 'reagir'}
                  </button>
                  {reactionPickerFor === post.id && (
                    <div className="emoji-picker" style={{ bottom: '110%' }}>
                      {REACTION_EMOJIS.map((e) => (
                        <button key={e} type="button" onClick={() => react(post.id, e)}>{e}</button>
                      ))}
                    </div>
                  )}
                </div>
                {reactionSummary(post.id).map(({ emoji, count }) => (
                  <span key={emoji} className="reaction-pill">{emoji} {count}</span>
                ))}
                <button type="button" className="replay-btn" onClick={() => toggleExpanded(post.id)}>
                  {postComments.length} {postComments.length === 1 ? 'comentário' : 'comentários'}
                </button>
                {post.events && (
                  <button type="button" className="replay-btn" onClick={() => setReplayFor({ events: post.events! })}>replay</button>
                )}
              </div>

              {isExpanded && (
                <div className="community-comments">
                  {postComments.map((c) => {
                    const isMine = c.author_id === me.id
                    const commentAuthorMember = memberList.find((m) => m.id === c.author_id)
                    return (
                      <div key={c.id} className="community-comment">
                        <span className="author-label">
                          {authorLabel(c.author_id)}
                          {commentAuthorMember?.is_editor && <IconEdit size={10} />}
                        </span>
                        {editingCommentId === c.id ? (
                          <span style={{ display: 'flex', gap: 4, flex: 1 }}>
                            <input
                              className="edit-message-input"
                              style={{ margin: 0 }}
                              value={editCommentDraft}
                              onChange={(e) => { setEditCommentDraft(e.target.value); recordEvent(editCommentEvents, e.target.value) }}
                              autoFocus
                            />
                            <button type="button" className="replay-btn" onClick={() => saveEditComment(c.id)}>salvar</button>
                            <button type="button" className="replay-btn" onClick={() => setEditingCommentId(null)}>cancelar</button>
                          </span>
                        ) : (
                          <>
                            <span>{c.content}{c.edited_at ? ' (editado)' : ''}</span>
                            {isMine && (
                              <button type="button" className="icon-btn" onClick={() => startEditComment(c)} title="Editar comentário">
                                <IconEdit size={13} />
                              </button>
                            )}
                            {c.events && (
                              <button type="button" className="replay-btn" onClick={() => setReplayFor({ events: c.events! })}>replay</button>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  {isMember && (
                    <div className="community-comment-composer">
                      <input
                        placeholder="Comentar..."
                        value={commentDrafts[post.id] || ''}
                        onChange={(e) => {
                          setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))
                          const buf = commentEventsRef.current[post.id] || []
                          const now = Date.now()
                          buf.push({ t: now, text: e.target.value })
                          commentEventsRef.current[post.id] = buf.filter((ev) => now - ev.t <= REPLAY_WINDOW_MS)
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') submitComment(post.id) }}
                      />
                      <button type="button" onClick={() => submitComment(post.id)}><IconSend size={16} /></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {replayFor && (
        <div className="modal-backdrop" onClick={() => setReplayFor(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>replay</h2>
            <ReplayPlayer events={replayFor.events} />
            <button type="button" className="modal-close" onClick={() => setReplayFor(null)}>fechar</button>
          </div>
        </div>
      )}

      {showInfo && (
        <div className="modal-backdrop" onClick={() => setShowInfo(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="account-avatar-wrap">
              <div className="account-avatar" style={{ overflow: 'hidden' }}>
                {community.image_url ? (
                  <img src={community.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <IconUser size={40} />
                )}
              </div>
            </div>

            {isManager ? (
              <>
                <h2>Editar comunidade</h2>
                <label>Nome</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                <label style={{ marginTop: 10 }}>Foto (link)</label>
                <input value={editImageUrl} onChange={(e) => setEditImageUrl(e.target.value)} placeholder="link da imagem" />
                <button type="button" disabled={infoBusy} onClick={saveCommunityInfo} style={{ marginTop: 10 }}>Salvar</button>
                {infoError && <span className="auth-error">{infoError}</span>}
              </>
            ) : (
              <>
                <h2>{community.name}</h2>
                {community.description && <p>{community.description}</p>}
                <p style={{ fontSize: '.75rem', color: '#8696a0' }}>
                  criada em {new Date(community.created_at).toLocaleDateString('pt-BR')}
                </p>
              </>
            )}

            <label style={{ marginTop: 16 }}>Participantes</label>
            <div className="chat-config-members">
              {memberList.map((m) => (
                <div key={m.id} className="chat-config-row">
                  <span>
                    {displayName(m)}
                    {m.id === community.created_by ? ' (dono)' : m.is_editor ? ' (editor)' : ''}
                    {m.id === me.id ? ' (você)' : ''}
                  </span>
                  {isOwner && m.id !== community.created_by && (
                    <span className="chat-config-actions">
                      <button type="button" onClick={() => toggleEditor(m.id, !m.is_editor)}>
                        {m.is_editor ? 'tirar editor' : 'tornar editor'}
                      </button>
                      <button type="button" onClick={() => removeParticipant(m.id)}>remover</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="modal-close" onClick={() => setShowInfo(false)}>fechar</button>
          </div>
        </div>
      )}
    </main>
  )
}
