import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { playNudgeSound, triggerNudgeShake } from '../lib/nudge'
import { formatPresence, getPresenceColor } from '../lib/presence'
import { getErrorMessage } from '../lib/errors'
import { displayName } from '../lib/displayName'
import { IconArrowLeft, IconAttach, IconBell, IconChat, IconCheck, IconCheckDouble, IconMic, IconPlus, IconSend, IconSmile, IconUser } from './icons'
import type { Conversation, Message, Profile } from '../types'

const EMOJIS = ['😀', '😂', '😍', '😭', '🔥', '👍', '🙏', '😡', '💀', '❤️']
const REPLAY_WINDOW_MS = 20000

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: any) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

type ReplayEvent = { t: number; text: string }
type MemberMeta = {
  username: string
  display_name: string | null
  avatar_url: string | null
  status: string | null
  last_seen_at: string | null
  is_idle: boolean
  last_read_at: string
}

type Props = {
  me: Profile | null
  conversation: Conversation | null
  onBack: () => void
  onConversationUpdate: (patch: Partial<Conversation>) => void
}

export function MainPanel({ me, conversation, onBack, onConversationUpdate }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<Record<string, MemberMeta>>({})
  const [draft, setDraft] = useState('')
  const [liveTyping, setLiveTyping] = useState<Record<string, string>>({})
  const [liveMedia, setLiveMedia] = useState<Record<string, string>>({})
  const [showEmoji, setShowEmoji] = useState(false)
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [replayFor, setReplayFor] = useState<Message | null>(null)
  const [replayEvents, setReplayEvents] = useState<ReplayEvent[] | null>(null)
  const [showAddMember, setShowAddMember] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [profilePopup, setProfilePopup] = useState<{ id: string; meta: MemberMeta } | null>(null)
  const [atBottom, setAtBottom] = useState(true)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replayBuffer = useRef<ReplayEvent[]>([])

  useEffect(() => {
    setMessages([])
    setLiveTyping({})
    setLiveMedia({})
    setDraft('')
    setAtBottom(true)
    if (!conversation || !me) return

    let cancelled = false

    async function markRead() {
      if (!conversation || !me) return
      await supabase
        .from('conversation_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversation.id)
        .eq('user_id', me.id)
    }

    async function loadMembers() {
      if (!conversation) return
      const { data: rows } = await supabase
        .from('conversation_members')
        .select('user_id, last_read_at, profile:profiles(id, username, display_name, avatar_url, status, last_seen_at, is_idle)')
        .eq('conversation_id', conversation.id)

      if (!cancelled && rows) {
        const map: Record<string, MemberMeta> = {}
        for (const row of rows) {
          const p = row.profile as unknown as Profile
          if (p) {
            map[p.id] = {
              username: p.username,
              display_name: p.display_name ?? null,
              avatar_url: p.avatar_url ?? null,
              status: p.status ?? null,
              last_seen_at: p.last_seen_at ?? null,
              is_idle: p.is_idle ?? false,
              last_read_at: row.last_read_at as string,
            }
          }
        }
        setMembers(map)
      }
    }

    async function load() {
      if (!conversation) return
      await loadMembers()

      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(200)

      if (!cancelled && msgs) setMessages(msgs as Message[])
      await markRead()
    }

    load()

    const channel = supabase
      .channel(`conversation:${conversation.id}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { userId, text } = payload as { userId: string; text: string }
        if (userId === me.id) return
        setLiveTyping((prev) => {
          const next = { ...prev }
          if (text) next[userId] = text
          else delete next[userId]
          return next
        })
      })
      .on('broadcast', { event: 'nudge' }, ({ payload }) => {
        const { userId } = payload as { userId: string }
        if (userId === me.id) return
        triggerNudgeShake()
        playNudgeSound()
      })
      .on('broadcast', { event: 'media' }, ({ payload }) => {
        const { userId, dataUrl } = payload as { userId: string; dataUrl: string | null }
        if (userId === me.id) return
        setLiveMedia((prev) => {
          const next = { ...prev }
          if (dataUrl) next[userId] = dataUrl
          else delete next[userId]
          return next
        })
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const msg = payload.new as Message
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
          setLiveTyping((prev) => {
            const next = { ...prev }
            delete next[msg.author_id]
            return next
          })
          setLiveMedia((prev) => {
            const next = { ...prev }
            delete next[msg.author_id]
            return next
          })
          markRead()
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const row = payload.new as { user_id: string; last_read_at: string }
          setMembers((prev) => {
            const meta = prev[row.user_id]
            if (!meta) return prev
            return { ...prev, [row.user_id]: { ...meta, last_read_at: row.last_read_at } }
          })
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          const p = payload.new as Profile
          setMembers((prev) => {
            if (!prev[p.id]) return prev
            return {
              ...prev,
              [p.id]: {
                ...prev[p.id],
                username: p.username,
                display_name: p.display_name ?? null,
                avatar_url: p.avatar_url ?? null,
                status: p.status ?? null,
                last_seen_at: p.last_seen_at ?? null,
                is_idle: p.is_idle ?? false,
              },
            }
          })
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [conversation?.id, me?.id])

  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, liveTyping, atBottom])

  function handleMessagesScroll(e: React.UIEvent<HTMLElement>) {
    const el = e.currentTarget
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAtBottom(distanceFromBottom < 80)
  }

  function recordReplayEvent(text: string) {
    const now = Date.now()
    replayBuffer.current.push({ t: now, text })
    replayBuffer.current = replayBuffer.current.filter((e) => now - e.t <= REPLAY_WINDOW_MS)
  }

  function broadcastTyping(text: string) {
    if (!me) return
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: me.id, text } })
  }

  function sendNudge() {
    if (!me) return
    channelRef.current?.send({ type: 'broadcast', event: 'nudge', payload: { userId: me.id } })
    triggerNudgeShake()
    playNudgeSound()
  }

  function broadcastMedia(dataUrl: string | null) {
    if (!me) return
    channelRef.current?.send({ type: 'broadcast', event: 'media', payload: { userId: me.id, dataUrl } })
    setLiveMedia((prev) => {
      const next = { ...prev }
      if (dataUrl) next[me.id] = dataUrl
      else delete next[me.id]
      return next
    })
  }

  async function addMember() {
    if (!me || !conversation) return
    const email = addEmail.trim().toLowerCase()
    if (!email) return
    setAddBusy(true)
    setAddError(null)
    try {
      const { data: found, error: findErr } = await supabase.rpc('find_profile_by_email', { p_email: email })
      if (findErr) throw findErr
      const target = found?.[0]
      if (!target) {
        setAddError('Essa pessoa ainda não tem conta no Ferus')
        return
      }

      const { error: memberErr } = await supabase
        .from('conversation_members')
        .insert({ conversation_id: conversation.id, user_id: target.id })
      if (memberErr && !memberErr.message.includes('duplicate')) throw memberErr

      setMembers((prev) => ({
        ...prev,
        [target.id]: {
          username: target.username,
          display_name: null,
          avatar_url: null,
          status: null,
          last_seen_at: null,
          is_idle: false,
          last_read_at: new Date().toISOString(),
        },
      }))

      if (conversation.type === 'dm') {
        const { error: convErr } = await supabase
          .from('conversations')
          .update({ type: 'group' })
          .eq('id', conversation.id)
        if (convErr) throw convErr
        onConversationUpdate({ type: 'group' })
      }

      setAddEmail('')
      setShowAddMember(false)
    } catch (err) {
      setAddError(getErrorMessage(err))
    } finally {
      setAddBusy(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    setDraft(text)
    recordReplayEvent(text)
    broadcastTyping(text)
  }

  function pickEmojiPreview(emoji: string | null) {
    broadcastTyping(emoji ? draft + emoji : draft)
  }

  function appendEmoji(emoji: string) {
    const next = draft + emoji
    setDraft(next)
    recordReplayEvent(next)
    broadcastTyping(next)
    setShowEmoji(false)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => broadcastMedia(reader.result as string)
    reader.readAsDataURL(file)
  }

  function clearMedia() {
    broadcastMedia(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function toggleRecording() {
    if (recording) {
      recognitionRef.current?.stop()
      return
    }

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      alert('Reconhecimento de voz não é suportado nesse navegador (funciona no Chrome/Edge).')
      return
    }

    const recognition: SpeechRecognitionLike = new SpeechRecognitionCtor()
    recognition.lang = 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = true

    const baseDraft = draft ? `${draft} ` : ''

    recognition.onresult = (e: any) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript
      }
      const next = baseDraft + transcript
      setDraft(next)
      recordReplayEvent(next)
      broadcastTyping(next)
    }
    recognition.onend = () => setRecording(false)
    recognition.onerror = () => setRecording(false)

    recognitionRef.current = recognition
    setRecording(true)
    recognition.start()
  }

  async function handleSend() {
    const content = draft.trim()
    if (!content || !conversation || !me) return

    const eventsToStore = [...replayBuffer.current]
    broadcastTyping('')
    clearMedia()
    setDraft('')
    replayBuffer.current = []

    const { data: msg } = await supabase
      .from('messages')
      .insert({ conversation_id: conversation.id, author_id: me.id, content })
      .select()
      .single()

    if (msg && eventsToStore.length > 1) {
      await supabase.from('message_replays').insert({ message_id: msg.id, events: eventsToStore })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function openReplay(msg: Message) {
    setReplayFor(msg)
    setReplayEvents(null)
    const { data } = await supabase
      .from('message_replays')
      .select('events')
      .eq('message_id', msg.id)
      .maybeSingle()
    setReplayEvents((data?.events as ReplayEvent[]) || [])
  }

  const otherMemberEntry = useMemo(() => {
    if (!conversation || conversation.type !== 'dm') return null
    const entry = Object.entries(members).find(([id]) => id !== me?.id)
    return entry || null
  }, [conversation, members, me?.id])
  const otherMember = otherMemberEntry?.[1] || null

  const title = useMemo(() => {
    if (!conversation) return ''
    if (conversation.type === 'group') return conversation.name || 'grupo'
    return otherMember ? displayName(otherMember) : 'conversa'
  }, [conversation, otherMember])

  const displayTitle = conversation?.type === 'group' ? title : `@${title}`

  const subtitle = useMemo(() => {
    if (!otherMember) return ''
    if (otherMember.status) return otherMember.status
    return formatPresence(otherMember.last_seen_at)
  }, [otherMember])

  function isReadByOthers(msg: Message) {
    const others = Object.entries(members).filter(([id]) => id !== me?.id)
    if (others.length === 0) return false
    return others.every(([, meta]) => new Date(meta.last_read_at) >= new Date(msg.created_at))
  }

  if (!conversation || !me) {
    return (
      <main className="main">
        <div className="empty">
          <div className="empty-card">
            <div style={{ color: '#71818a' }}><IconChat size={46} /></div>
            <h2>Nenhuma conversa selecionada</h2>
            <p>Escolha uma conversa ou comece uma nova pra ver o mecanismo ao vivo em ação.</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="main">
      <header className="chat-header">
        <button type="button" className="icon-btn back-mobile" onClick={onBack}><IconArrowLeft size={20} /></button>
        <div
          style={{ position: 'relative', cursor: otherMember ? 'pointer' : 'default' }}
          onClick={() => otherMember && me && setProfilePopup({ id: otherMemberEntry![0], meta: otherMember })}
        >
          <div className="header-photo" style={{ overflow: 'hidden' }}>
            {otherMember?.avatar_url ? (
              <img src={otherMember.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              title[0]?.toUpperCase()
            )}
          </div>
          {otherMember && (
            <span className={`presence-dot ${getPresenceColor(otherMember.last_seen_at, otherMember.is_idle)}`} />
          )}
        </div>
        <div className="header-text">
          <div
            className="header-name"
            style={{ cursor: otherMember ? 'pointer' : 'default' }}
            onClick={() => otherMember && me && setProfilePopup({ id: otherMemberEntry![0], meta: otherMember })}
          >
            {displayTitle}
          </div>
          {subtitle && <div className="status">{subtitle}</div>}
        </div>
        <div className="header-actions" style={{ position: 'relative' }}>
          <button
            type="button"
            className="nudge-btn"
            title="Adicionar pessoa"
            onClick={() => { setShowAddMember((v) => !v); setAddError(null) }}
          >
            <IconPlus size={20} />
          </button>
          <button type="button" className="nudge-btn" title="Chamar atenção" onClick={sendNudge}><IconBell size={20} /></button>

          {showAddMember && (
            <div className="add-member-popover">
              <input
                type="email"
                placeholder="email da pessoa"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                autoFocus
              />
              <button type="button" disabled={addBusy} onClick={addMember}>Adicionar</button>
              {addError && <span className="auth-error">{addError}</span>}
            </div>
          )}
        </div>
      </header>

      <section className="messages" onScroll={handleMessagesScroll}>
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.author_id === me.id ? 'out' : 'in'}`}>
            <div className="bubble">
              {m.author_id !== me.id && conversation.type === 'group' && (
                <span
                  className="author-label"
                  style={{ cursor: members[m.author_id] ? 'pointer' : 'default' }}
                  onClick={() => members[m.author_id] && setProfilePopup({ id: m.author_id, meta: members[m.author_id] })}
                >
                  @{members[m.author_id] ? displayName(members[m.author_id]) : '...'}
                </span>
              )}
              {m.content}
              {m.author_id === me.id && (
                <span className={`read-receipt${isReadByOthers(m) ? ' read' : ''}`}>
                  {isReadByOthers(m) ? <IconCheckDouble size={15} /> : <IconCheck size={13} />}
                </span>
              )}
              <button type="button" className="replay-btn" onClick={() => openReplay(m)}>replay</button>
            </div>
          </div>
        ))}

        {Object.entries(liveTyping).map(([userId, text]) => (
          <div key={userId} className="message in live">
            <div className="bubble">
              <span className="author-label">@{members[userId] ? displayName(members[userId]) : '...'}</span>
              {text}
            </div>
          </div>
        ))}

        {Object.entries(liveMedia).map(([userId, dataUrl]) => (
          <div key={`media-${userId}`} className={`message live ${userId === me.id ? 'out' : 'in'}`}>
            <div className="bubble">
              <span className="author-label">@{members[userId] ? displayName(members[userId]) : '...'}</span>
              <img
                src={dataUrl}
                alt="preview ao vivo"
                className="live-media-preview"
                onClick={() => setExpandedImage(dataUrl)}
              />
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </section>

      <p className="media-note">imagens só aparecem ao vivo pra quem está na sala — não ficam salvas no histórico</p>

      <footer className="composer">
        <button type="button" className="compose-btn" onClick={() => setShowEmoji((v) => !v)} title="Emoji"><IconSmile size={20} /></button>
        <button type="button" className="compose-btn" onClick={() => fileInputRef.current?.click()} title="Anexar"><IconAttach size={20} /></button>
        <button
          type="button"
          className={`compose-btn${recording ? ' recording' : ''}`}
          onClick={toggleRecording}
          title="Falar (transcreve pra texto, áudio não é salvo)"
        >
          <IconMic size={20} />
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
        <div className="input">
          <textarea
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Digite uma mensagem... tudo aqui é visto ao vivo"
            rows={1}
          />
        </div>
        <button type="button" className="send" onClick={handleSend} disabled={!draft.trim()}><IconSend size={18} /></button>

        {showEmoji && (
          <div className="emoji-picker">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onMouseEnter={() => pickEmojiPreview(e)}
                onMouseLeave={() => pickEmojiPreview(null)}
                onClick={() => appendEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </footer>

      {replayFor && (
        <div className="modal-backdrop" onClick={() => setReplayFor(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>replay: "{replayFor.content}"</h2>
            {replayEvents === null && <p>carregando...</p>}
            {replayEvents?.length === 0 && <p>sem hesitação registrada pra essa mensagem</p>}
            {replayEvents && replayEvents.length > 0 && <ReplayPlayer events={replayEvents} />}
            <button type="button" className="modal-close" onClick={() => setReplayFor(null)}>fechar</button>
          </div>
        </div>
      )}

      {expandedImage && (
        <div className="image-lightbox" onClick={() => setExpandedImage(null)}>
          <img src={expandedImage} alt="preview ao vivo expandido" />
        </div>
      )}

      {profilePopup && (
        <div className="modal-backdrop" onClick={() => setProfilePopup(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="account-avatar-wrap">
              <div className="account-avatar" style={{ overflow: 'hidden' }}>
                {profilePopup.meta.avatar_url ? (
                  <img src={profilePopup.meta.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <IconUser size={40} />
                )}
              </div>
            </div>
            <h2>@{displayName(profilePopup.meta)}</h2>
            <p>{profilePopup.meta.status || 'sem status'}</p>
            <p style={{ fontSize: '.75rem' }}>{formatPresence(profilePopup.meta.last_seen_at)}</p>
            <button type="button" className="modal-close" onClick={() => setProfilePopup(null)}>fechar</button>
          </div>
        </div>
      )}
    </main>
  )
}

function ReplayPlayer({ events }: { events: ReplayEvent[] }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
    if (events.length < 2) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const start = events[0].t
    events.forEach((ev, i) => {
      timers.push(setTimeout(() => setIndex(i), ev.t - start))
    })
    return () => timers.forEach(clearTimeout)
  }, [events])

  return <p style={{ minHeight: '2.5em', fontStyle: 'italic', color: '#8696a0' }}>{events[index]?.text}</p>
}
