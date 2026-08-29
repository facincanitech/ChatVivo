import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/displayName'
import { getErrorMessage } from '../lib/errors'
import { IconArrowLeft, IconSend, IconSmile, IconTrash, IconUser } from './icons'
import type { Community, Profile } from '../types'

const REACTION_EMOJIS = ['😀', '😂', '😍', '😭', '🔥', '👍', '🙏', '😡']

type PostAuthor = { username: string; display_name: string | null; avatar_url: string | null }

type Post = {
  id: string
  community_id: string
  author_id: string
  content: string | null
  image_url: string | null
  created_at: string
  deleted_at: string | null
}

type Comment = {
  id: string
  post_id: string
  author_id: string
  content: string
  created_at: string
  deleted_at: string | null
}

type Reaction = { post_id: string; user_id: string; emoji: string }

type MemberProfile = { id: string; username: string; display_name: string | null; avatar_url: string | null }

type Props = {
  me: Profile
  community: Community
  onBack: () => void
  onCommunityUpdate: (patch: Partial<Community>) => void
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
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [showInfo, setShowInfo] = useState(false)
  const [editName, setEditName] = useState('')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [infoBusy, setInfoBusy] = useState(false)
  const [infoError, setInfoError] = useState<string | null>(null)

  const isOwner = community.created_by === me.id

  async function load() {
    const { data: memberRows } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', community.id)
    setMemberCount(memberRows?.length || 0)
    setIsMember(!!memberRows?.some((r) => r.user_id === me.id))

    const memberIds = (memberRows || []).map((r) => r.user_id as string)
    if (memberIds.length > 0) {
      const { data: memberProfiles } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', memberIds)
      setMemberList((memberProfiles as MemberProfile[]) || [])
    } else {
      setMemberList([])
    }

    const { data: postRows } = await supabase
      .from('community_posts')
      .select('*')
      .eq('community_id', community.id)
      .is('deleted_at', null)
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
      const { data, error: err } = await supabase
        .from('community_posts')
        .insert({ community_id: community.id, author_id: me.id, content: content || null, image_url: img || null })
        .select()
        .single()
      if (err) throw err
      setPosts((prev) => [data as Post, ...prev])
      setAuthors((prev) => (prev[me.id] ? prev : { ...prev, [me.id]: { username: me.username, display_name: me.display_name ?? null, avatar_url: me.avatar_url ?? null } }))
      setDraft('')
      setImageUrl('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function deletePost(postId: string) {
    await supabase.from('community_posts').update({ deleted_at: new Date().toISOString() }).eq('id', postId)
    setPosts((prev) => prev.filter((p) => p.id !== postId))
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
    const { data, error: err } = await supabase
      .from('community_comments')
      .insert({ post_id: postId, author_id: me.id, content })
      .select()
      .single()
    if (err) {
      setError(getErrorMessage(err))
      return
    }
    setComments((prev) => [...prev, data as Comment])
    setAuthors((prev) => (prev[me.id] ? prev : { ...prev, [me.id]: { username: me.username, display_name: me.display_name ?? null, avatar_url: me.avatar_url ?? null } }))
    setCommentDrafts((prev) => ({ ...prev, [postId]: '' }))
  }

  async function deleteComment(commentId: string) {
    await supabase.from('community_comments').update({ deleted_at: new Date().toISOString() }).eq('id', commentId)
    setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, deleted_at: new Date().toISOString() } : c)))
  }

  function toggleExpanded(postId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  function toggleReveal(commentId: string) {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(commentId)) next.delete(commentId)
      else next.add(commentId)
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
              onChange={(e) => setDraft(e.target.value)}
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
          return (
            <div key={post.id} className="community-post">
              <div className="community-post-header">
                <div className="option-icon"><IconUser size={18} /></div>
                <div>
                  <div className="author-label" style={{ marginBottom: 0 }}>{authorLabel(post.author_id)}</div>
                  <div className="status" style={{ marginTop: 0 }}>{new Date(post.created_at).toLocaleString('pt-BR')}</div>
                </div>
                {post.author_id === me.id && (
                  <button type="button" className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => deletePost(post.id)} title="Apagar tópico">
                    <IconTrash size={16} />
                  </button>
                )}
              </div>
              {post.content && <p className="community-post-content">{post.content}</p>}
              {post.image_url && <img src={post.image_url} alt="" className="community-post-image" />}

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
              </div>

              {isExpanded && (
                <div className="community-comments">
                  {postComments.map((c) => {
                    const isDeleted = !!c.deleted_at
                    const isMineToDelete = c.author_id === me.id && !isDeleted
                    const isRevealed = revealed.has(c.id)
                    return (
                      <div key={c.id} className="community-comment">
                        <span className="author-label">{authorLabel(c.author_id)}</span>
                        {isDeleted && !isRevealed ? (
                          <span className="community-comment-deleted" onClick={() => toggleReveal(c.id)}>
                            comentário apagado (replay)
                          </span>
                        ) : (
                          <span>{c.content}</span>
                        )}
                        {isDeleted && isRevealed && (
                          <span className="community-comment-deleted-tag">apagado</span>
                        )}
                        {isMineToDelete && (
                          <button type="button" className="icon-btn" onClick={() => deleteComment(c.id)} title="Apagar comentário">
                            <IconTrash size={13} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {isMember && (
                    <div className="community-comment-composer">
                      <input
                        placeholder="Comentar..."
                        value={commentDrafts[post.id] || ''}
                        onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
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

      {showInfo && (
        <div className="modal-backdrop" onClick={() => setShowInfo(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            {isOwner ? (
              <>
                <h2>Editar comunidade</h2>
                <label>Nome</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                <label style={{ marginTop: 10 }}>Foto (link)</label>
                <input value={editImageUrl} onChange={(e) => setEditImageUrl(e.target.value)} placeholder="link da imagem" />
                <button type="button" disabled={infoBusy} onClick={saveCommunityInfo} style={{ marginTop: 10 }}>Salvar</button>
                {infoError && <span className="auth-error">{infoError}</span>}

                <label style={{ marginTop: 16 }}>Participantes</label>
                <div className="chat-config-members">
                  {memberList.map((m) => (
                    <div key={m.id} className="chat-config-row">
                      <span>{displayName(m)}{m.id === me.id ? ' (você)' : ''}</span>
                      {m.id !== me.id && (
                        <button type="button" onClick={() => removeParticipant(m.id)}>remover</button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="account-avatar-wrap">
                  <div className="account-avatar" style={{ overflow: 'hidden' }}>
                    {community.image_url ? (
                      <img src={community.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <IconUser size={40} />
                    )}
                  </div>
                </div>
                <h2>{community.name}</h2>
                {community.description && <p>{community.description}</p>}
                <p style={{ fontSize: '.75rem', color: '#8696a0' }}>
                  criada em {new Date(community.created_at).toLocaleDateString('pt-BR')}
                </p>
              </>
            )}
            <button type="button" className="modal-close" onClick={() => setShowInfo(false)}>fechar</button>
          </div>
        </div>
      )}
    </main>
  )
}
