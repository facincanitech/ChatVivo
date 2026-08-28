import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import './App.css'

const ROOM_ID = 'general'
const NAME_KEY = 'chatvivo_name'

type Message = {
  id: string
  author: string
  content: string
  created_at: string
}

type TypingEvent = {
  author: string
  text: string
}

function App() {
  const [name] = useState(() => {
    const stored = localStorage.getItem(NAME_KEY)
    if (stored) return stored
    const chosen = window.prompt('Como você quer aparecer na sala?')?.trim() || `anon-${Math.floor(Math.random() * 1000)}`
    localStorage.setItem(NAME_KEY, chosen)
    return chosen
  })

  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [liveTyping, setLiveTyping] = useState<Record<string, string>>({})
  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase
      .from('messages')
      .select('*')
      .eq('room_id', ROOM_ID)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (data) setMessages(data as Message[])
      })

    const channel = supabase
      .channel(`room:${ROOM_ID}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { author, text } = payload as TypingEvent
        setLiveTyping((prev) => {
          const next = { ...prev }
          if (text) next[author] = text
          else delete next[author]
          return next
        })
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${ROOM_ID}` },
        (payload) => {
          const msg = payload.new as Message
          setMessages((prev) => [...prev, msg])
          setLiveTyping((prev) => {
            const next = { ...prev }
            delete next[msg.author]
            return next
          })
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, liveTyping])

  function broadcastTyping(text: string) {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { author: name, text } satisfies TypingEvent,
    })
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    setDraft(text)
    broadcastTyping(text)
  }

  async function handleSend() {
    const content = draft.trim()
    if (!content) return
    broadcastTyping('')
    setDraft('')
    await supabase.from('messages').insert({ room_id: ROOM_ID, author: name, content })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const othersTyping = Object.entries(liveTyping).filter(([author]) => author !== name)

  return (
    <div className="room">
      <header className="room-header">
        <h1>ChatVivo</h1>
        <span className="room-name">sala: {ROOM_ID} · você: {name}</span>
      </header>

      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className="message">
            <span className="message-author">{m.author}</span>
            <span className="message-content">{m.content}</span>
          </div>
        ))}

        {othersTyping.map(([author, text]) => (
          <div key={author} className="message message-live">
            <span className="message-author">{author}</span>
            <span className="message-content">{text}<span className="cursor">|</span></span>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="digite... tudo aqui é visto ao vivo pelo grupo"
          rows={2}
        />
        <button type="button" onClick={handleSend} disabled={!draft.trim()}>
          Enviar
        </button>
      </div>
    </div>
  )
}

export default App
