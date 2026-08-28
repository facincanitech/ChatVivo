import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Conversation, Message, Profile } from '../types'

const EMOJIS = ['😀', '😂', '😍', '😭', '🔥', '👍', '🙏', '😡', '💀', '❤️']
const REPLAY_WINDOW_MS = 20000

type ReplayEvent = { t: number; text: string }

type Props = {
  me: Profile
  conversation: Conversation
  onBack: () => void
}

export function Chat({ me, conversation, onBack }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [usernames, setUsernames] = useState<Record<string, string>>({})
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
    let cancelled = false

    async function load() {
      const { data: members } = await supabase
        .from('conversation_members')
        .select('user_id, profile:profiles(id, username)')
        .eq('conversation_id', conversation.id)

      if (!cancelled && members) {
        const map: Record<string, string> = {}
        for (const row of members) {
          const p = row.profile as unknown as Profile
          if (p) map[p.id] = p.username
        }
        setUsernames(map)
      }

      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(200)

      if (!cancelled && msgs) setMessages(msgs as Message[])
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
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [conversation.id, me.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, liveTyping])

  function recordReplayEvent(text: string) {
    const now = Date.now()
    replayBuffer.current.push({ t: now, text })
    replayBuffer.current = replayBuffer.current.filter((e) => now - e.t <= REPLAY_WINDOW_MS)
  }

  function broadcastTyping(text: string) {
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: me.id, text } })
  }

  function broadcastMedia(dataUrl: string | null) {
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
    if (!content) return

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

  const title = useMemo(() => {
    if (conversation.type === 'group') return conversation.name || 'grupo'
    const other = Object.entries(usernames).find(([id]) => id !== me.id)
    return other ? other[1] : 'conversa'
  }, [conversation, usernames, me.id])

  return (
    <div className="room">
      <header className="room-header">
        <button type="button" className="back" onClick={onBack}>← voltar</button>
        <h1>{title}</h1>
      </header>

      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className="message">
            <span className="message-author">{usernames[m.author_id] || '...'}</span>
            <span className="message-content">{m.content}</span>
            {m.author_id === me.id && (
              <button type="button" className="replay-btn" onClick={() => openReplay(m)}>replay</button>
            )}
          </div>
        ))}

        {Object.entries(liveTyping).map(([userId, text]) => (
          <div key={userId} className="message message-live">
            <span className="message-author">{usernames[userId] || '...'}</span>
            <span className="message-content">{text}<span className="cursor">|</span></span>
          </div>
        ))}

        {Object.entries(liveMedia).map(([userId, dataUrl]) => (
          <div key={`media-${userId}`} className="message message-live">
            <span className="message-author">{usernames[userId] || '...'}</span>
            <img src={dataUrl} alt="preview ao vivo" className="live-media-preview" />
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <button type="button" onClick={() => setShowEmoji((v) => !v)}>😊</button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>📎</button>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
        <textarea
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="digite... tudo aqui é visto ao vivo pelo grupo"
          rows={2}
        />
        <button type="button" onClick={handleSend} disabled={!draft.trim()}>Enviar</button>
      </div>

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

      <p className="media-note">imagens só aparecem ao vivo pra quem está na sala — não ficam salvas no histórico</p>

      {replayFor && (
        <div className="replay-modal" onClick={() => setReplayFor(null)}>
          <div className="replay-content" onClick={(e) => e.stopPropagation()}>
            <h2>replay: "{replayFor.content}"</h2>
            {replayEvents === null && <p>carregando...</p>}
            {replayEvents?.length === 0 && <p>sem hesitação registrada pra essa mensagem</p>}
            {replayEvents && replayEvents.length > 0 && <ReplayPlayer events={replayEvents} />}
            <button type="button" onClick={() => setReplayFor(null)}>fechar</button>
          </div>
        </div>
      )}
    </div>
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

  return <p className="replay-text">{events[index]?.text}</p>
}
