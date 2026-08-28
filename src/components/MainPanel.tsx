import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { playNudgeSound, triggerNudgeShake } from '../lib/nudge'
import { formatPresence } from '../lib/presence'
import { IconAttach, IconBell, IconChat, IconCheck, IconCheckDouble, IconSend, IconSmile } from './icons'
import type { Conversation, Message, Profile } from '../types'

const EMOJIS = ['😀', '😂', '😍', '😭', '🔥', '👍', '🙏', '😡', '💀', '❤️']
const REPLAY_WINDOW_MS = 20000

type ReplayEvent = { t: number; text: string }
type MemberMeta = { username: string; status: string | null; last_seen_at: string | null; last_read_at: string }

type Props = {
  me: Profile | null
  conversation: Conversation | null
}

export function MainPanel({ me, conversation }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<Record<string, MemberMeta>>({})
  const [draft, setDraft] = useState('')
  const [liveTyping, setLiveTyping] = useState<Record<string, string>>({})
  const [liveMedia, setLiveMedia] = useState<Record<string, string>>({})
  const [showEmoji, setShowEmoji] = useState(false)
  const [replayFor, setReplayFor] = useState<Message | null>(null)
  const [replayEvents, setReplayEvents] = useState<ReplayEvent[] | null>(null)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replayBuffer = useRef<ReplayEvent[]>([])

  useEffect(() => {
    setMessages([])
    setLiveTyping({})
    setLiveMedia({})
    setDraft('')
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
        .select('user_id, last_read_at, profile:profiles(id, username, status, last_seen_at)')
        .eq('conversation_id', conversation.id)

      if (!cancelled && rows) {
        const map: Record<string, MemberMeta> = {}
        for (const row of rows) {
          const p = row.profile as unknown as Profile
          if (p) {
            map[p.id] = {
              username: p.username,
              status: p.status ?? null,
              last_seen_at: p.last_seen_at ?? null,
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
      .subscribe()

    channelRef.current = channel

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [conversation?.id, me?.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, liveTyping])

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
  }

  function broadcastMedia(dataUrl: string | null) {
    if (!me) return
    channelRef.current?.send({ type: 'broadcast', event: 'media', payload: { userId: me.id, dataUrl } })
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

  const otherMember = useMemo(() => {
    if (!conversation || conversation.type !== 'dm') return null
    const entry = Object.entries(members).find(([id]) => id !== me?.id)
    return entry ? entry[1] : null
  }, [conversation, members, me?.id])

  const title = useMemo(() => {
    if (!conversation) return ''
    if (conversation.type === 'group') return conversation.name || 'grupo'
    return otherMember?.username || 'conversa'
  }, [conversation, otherMember])

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
        <div className="header-photo">{title[0]?.toUpperCase()}</div>
        <div className="header-text">
          <div className="header-name">{title}</div>
          {subtitle && <div className="status">{subtitle}</div>}
        </div>
        <div className="header-actions">
          <button type="button" className="nudge-btn" title="Chamar atenção" onClick={sendNudge}><IconBell size={20} /></button>
        </div>
      </header>

      <section className="messages">
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.author_id === me.id ? 'out' : 'in'}`}>
            <div className="bubble">
              {m.author_id !== me.id && conversation.type === 'group' && (
                <span className="author-label">{members[m.author_id]?.username || '...'}</span>
              )}
              {m.content}
              {m.author_id === me.id && (
                <span className={`read-receipt${isReadByOthers(m) ? ' read' : ''}`}>
                  {isReadByOthers(m) ? <IconCheckDouble size={15} /> : <IconCheck size={13} />}
                </span>
              )}
              {m.author_id === me.id && (
                <button type="button" className="replay-btn" onClick={() => openReplay(m)}>replay</button>
              )}
            </div>
          </div>
        ))}

        {Object.entries(liveTyping).map(([userId, text]) => (
          <div key={userId} className="message in live">
            <div className="bubble">
              <span className="author-label">{members[userId]?.username || '...'}</span>
              {text}
            </div>
          </div>
        ))}

        {Object.entries(liveMedia).map(([userId, dataUrl]) => (
          <div key={`media-${userId}`} className="message in live">
            <div className="bubble">
              <span className="author-label">{members[userId]?.username || '...'}</span>
              <img src={dataUrl} alt="preview ao vivo" className="live-media-preview" />
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </section>

      <p className="media-note">imagens só aparecem ao vivo pra quem está na sala — não ficam salvas no histórico</p>

      <footer className="composer">
        <button type="button" className="compose-btn" onClick={() => setShowEmoji((v) => !v)} title="Emoji"><IconSmile size={20} /></button>
        <button type="button" className="compose-btn" onClick={() => fileInputRef.current?.click()} title="Anexar"><IconAttach size={20} /></button>
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
