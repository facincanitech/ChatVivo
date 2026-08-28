import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { playNudgeSound, triggerNudgeShake } from '../lib/nudge'
import { formatPresence, getPresenceColor } from '../lib/presence'
import { getErrorMessage } from '../lib/errors'
import { displayName } from '../lib/displayName'
import { IconAttach, IconBell, IconChat, IconCheck, IconCheckDouble, IconCrown, IconMic, IconMore, IconPlus, IconSend, IconSmile, IconUser } from './icons'
import type { Conversation, Message, Profile } from '../types'

const EMOJIS = ['😀', '😂', '😍', '😭', '🔥', '👍', '🙏', '😡', '💀', '❤️']
const REPLAY_WINDOW_MS = 20000

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(iso, today.toISOString())) return 'Hoje'
  if (isSameDay(iso, yesterday.toISOString())) return 'Ontem'
  return d.toLocaleDateString('pt-BR')
}

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
  email: string
  avatar_url: string | null
  status: string | null
  last_seen_at: string | null
  is_idle: boolean
  last_read_at: string
  added_by: string | null
  is_leader: boolean
  role: string | null
}

type Props = {
  me: Profile | null
  conversation: Conversation | null
  onBack: () => void
  onConversationUpdate: (patch: Partial<Conversation>) => void
  blockedIds: Set<string>
}

export function MainPanel({ me, conversation, onBack, onConversationUpdate, blockedIds }: Props) {
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
  const [showChatConfig, setShowChatConfig] = useState(false)
  const chatConfigRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showChatConfig) return
    function handleClickOutside(e: MouseEvent) {
      if (chatConfigRef.current && !chatConfigRef.current.contains(e.target as Node)) {
        setShowChatConfig(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showChatConfig])
  const [configView, setConfigView] = useState<'root' | 'invite' | 'edit'>('root')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [profilePopup, setProfilePopup] = useState<{ id: string; meta: MemberMeta } | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [friendRequestState, setFriendRequestState] = useState<'idle' | 'sent' | 'friends' | 'error'>('idle')
  const [friendRequestLoading, setFriendRequestLoading] = useState(false)
  useEffect(() => {
    setFriendRequestState('idle')
    if (!me || !profilePopup) {
      setFriendRequestLoading(false)
      return
    }
    setFriendRequestLoading(true)
    supabase
      .from('friend_requests')
      .select('status, from_id')
      .or(`and(from_id.eq.${me.id},to_id.eq.${profilePopup.id}),and(from_id.eq.${profilePopup.id},to_id.eq.${me.id})`)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          if (data.status === 'accepted') setFriendRequestState('friends')
          else if (data.status === 'pending' && data.from_id === me.id) setFriendRequestState('sent')
        }
        setFriendRequestLoading(false)
      })
  }, [profilePopup?.id, me?.id])
  const [atBottom, setAtBottom] = useState(true)
  const [nudgeFrom, setNudgeFrom] = useState<string | null>(null)
  const [editedIds, setEditedIds] = useState<Set<string>>(new Set())

  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replayBuffer = useRef<ReplayEvent[]>([])
  const messagesRef = useRef<Message[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  function hasHiddenEdit(events: ReplayEvent[], finalContent: string): boolean {
    let prevLen = 0
    for (const e of events) {
      const t = e.text ?? ''
      if (t.length < prevLen) return true
      if (!finalContent.startsWith(t)) return true
      prevLen = t.length
    }
    return false
  }

  useEffect(() => {
    setMessages([])
    setLiveTyping({})
    setLiveMedia({})
    setDraft('')
    setAtBottom(true)
    setNudgeFrom(null)
    setEditedIds(new Set())
    setShowChatConfig(false)
    setConfigView('root')
    if (!conversation || !me) return

    let cancelled = false

    async function markRead() {
      if (!conversation || !me) return
      await supabase.rpc('mark_conversation_read', { p_conversation_id: conversation.id })
    }

    async function loadMembers() {
      if (!conversation) return
      const { data: rows } = await supabase
        .from('conversation_members')
        .select('user_id, last_read_at, added_by, is_leader, role, profile:profiles!conversation_members_user_id_fkey(id, username, display_name, email, avatar_url, status, last_seen_at, is_idle)')
        .eq('conversation_id', conversation.id)

      if (!cancelled && rows) {
        const map: Record<string, MemberMeta> = {}
        for (const row of rows) {
          const p = row.profile as unknown as Profile
          if (p) {
            map[p.id] = {
              username: p.username,
              display_name: p.display_name ?? null,
              email: p.email,
              avatar_url: p.avatar_url ?? null,
              status: p.status ?? null,
              last_seen_at: p.last_seen_at ?? null,
              is_idle: p.is_idle ?? false,
              last_read_at: row.last_read_at as string,
              added_by: row.added_by as string | null,
              is_leader: row.is_leader as boolean,
              role: row.role as string | null,
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
        .select('*, message_replays(events)')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(200)

      if (!cancelled && msgs) {
        setMessages(msgs as Message[])
        const edited = new Set<string>()
        for (const m of msgs as (Message & { message_replays: { events: ReplayEvent[] }[] | { events: ReplayEvent[] } | null })[]) {
          const raw = m.message_replays
          const events = Array.isArray(raw) ? raw[0]?.events : raw?.events
          if (events && hasHiddenEdit(events, m.content)) edited.add(m.id)
        }
        setEditedIds(edited)
      }
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
        setNudgeFrom(userId)
        setTimeout(() => setNudgeFrom((prev) => (prev === userId ? null : prev)), 3000)
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
        { event: 'INSERT', schema: 'public', table: 'message_replays' },
        (payload) => {
          const row = payload.new as { message_id: string; events: ReplayEvent[] }
          const msg = messagesRef.current.find((m) => m.id === row.message_id)
          if (msg && hasHiddenEdit(row.events, msg.content)) {
            setEditedIds((prev) => (prev.has(msg.id) ? prev : new Set(prev).add(msg.id)))
          }
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
                email: p.email,
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

  async function sendFriendFromPopup() {
    if (!me || !profilePopup) return
    const { error: reqErr } = await supabase
      .from('friend_requests')
      .insert({ from_id: me.id, to_id: profilePopup.id })
    if (reqErr && !reqErr.message.includes('duplicate')) {
      setFriendRequestState('error')
      return
    }
    if (reqErr) {
      await supabase
        .from('friend_requests')
        .update({ status: 'pending' })
        .eq('from_id', me.id)
        .eq('to_id', profilePopup.id)
    }
    setFriendRequestState('sent')
  }

  async function blockFromPopup() {
    if (!me || !profilePopup) return
    await supabase.from('blocks').insert({ blocker_id: me.id, blocked_id: profilePopup.id })
    setProfileMenuOpen(false)
    setProfilePopup(null)
    onBack()
  }

  function sendNudge() {
    if (!me || !conversation) return
    channelRef.current?.send({ type: 'broadcast', event: 'nudge', payload: { userId: me.id } })
    triggerNudgeShake()
    playNudgeSound()

    Object.keys(members)
      .filter((id) => id !== me.id)
      .forEach((id) => {
        const personalChannel = supabase.channel(`nudge:${id}`)
        personalChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            personalChannel.send({
              type: 'broadcast',
              event: 'nudge',
              payload: { userId: me.id, conversationId: conversation.id },
            })
            setTimeout(() => supabase.removeChannel(personalChannel), 1000)
          }
        })
      })
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

  async function postSystemMessage(content: string) {
    if (!me || !conversation) return
    await supabase.from('messages').insert({ conversation_id: conversation.id, author_id: me.id, content, kind: 'system' })
  }

  async function addMember() {
    if (!me || !conversation) return
    const input = addEmail.trim()
    if (!input) return
    setAddBusy(true)
    setAddError(null)
    try {
      let target: { id: string; username: string; email?: string } | undefined

      if (input.startsWith('@')) {
        const handle = input.slice(1)
        const { data, error: findErr } = await supabase
          .from('profiles')
          .select('id, username, email')
          .or(`username.ilike.${handle},display_name.ilike.${handle}`)
          .limit(1)
        if (findErr) throw findErr
        target = data?.[0] || undefined
      } else {
        const { data: found, error: findErr } = await supabase.rpc('find_profile_by_email', {
          p_email: input.toLowerCase(),
        })
        if (findErr) throw findErr
        target = found?.[0]
      }

      if (!target) {
        setAddError('Essa pessoa ainda não tem conta no Ferus')
        return
      }

      const isRoleGroup = !!members[me.id]?.role
      const { error: memberErr } = await supabase
        .from('conversation_members')
        .insert({
          conversation_id: conversation.id,
          user_id: target.id,
          added_by: me.id,
          ...(isRoleGroup ? { role: 'member' } : {}),
        })
      if (memberErr && !memberErr.message.includes('duplicate')) {
        if (memberErr.message.includes('row-level security')) {
          throw new Error('Só dá pra adicionar quem é seu amigo (ou é o parceiro da DM original)')
        }
        throw memberErr
      }

      setMembers((prev) => ({
        ...prev,
        [target!.id]: {
          username: target!.username,
          display_name: null,
          email: target!.email || input,
          avatar_url: null,
          status: null,
          last_seen_at: null,
          is_idle: false,
          last_read_at: new Date().toISOString(),
          added_by: me.id,
          is_leader: false,
          role: isRoleGroup ? 'member' : null,
        },
      }))

      if (conversation.type === 'dm') {
        const { error: convErr } = await supabase
          .from('conversations')
          .update({ type: 'group' })
          .eq('id', conversation.id)
        if (convErr) throw convErr
        onConversationUpdate({ type: 'group' })

        await supabase
          .from('conversation_members')
          .update({ is_leader: true })
          .eq('conversation_id', conversation.id)
          .eq('user_id', me.id)
        setMembers((prev) => (prev[me.id] ? { ...prev, [me.id]: { ...prev[me.id], is_leader: true } } : prev))
      }

      await postSystemMessage(`${displayName(me)} adicionou ${target.username} ao chat`)

      setAddEmail('')
      setConfigView('root')
    } catch (err) {
      setAddError(getErrorMessage(err))
    } finally {
      setAddBusy(false)
    }
  }

  const myMembership = me ? members[me.id] : undefined
  const isRoleGroup = !!myMembership?.role
  const canManageMembers = !!myMembership && (myMembership.added_by === null || myMembership.is_leader)

  function canKick(target: MemberMeta): boolean {
    if (!myMembership) return false
    if (isRoleGroup) {
      if (myMembership.role === 'admin') return target.role !== 'admin'
      if (myMembership.role === 'moderator') return target.role === 'member'
      return false
    }
    return target.added_by !== null && canManageMembers
  }

  function canPromote(target: MemberMeta): boolean {
    if (isRoleGroup) return myMembership?.role === 'admin' && target.role === 'member'
    return target.added_by !== null && canManageMembers && !target.is_leader
  }

  function canDemote(target: MemberMeta): boolean {
    if (isRoleGroup) return false
    return target.added_by !== null && canManageMembers && !!target.is_leader
  }

  async function saveGroupInfo() {
    if (!conversation) return
    setEditBusy(true)
    try {
      await supabase
        .from('conversations')
        .update({ name: editName.trim(), description: editDesc.trim() || null })
        .eq('id', conversation.id)
      onConversationUpdate({ name: editName.trim() })
      setConfigView('root')
    } finally {
      setEditBusy(false)
    }
  }

  async function removeMember(targetId: string) {
    if (!conversation || !me) return
    const targetMeta = members[targetId]
    await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversation.id)
      .eq('user_id', targetId)
    const remaining = Object.keys(members).filter((id) => id !== targetId)
    setMembers((prev) => {
      const next = { ...prev }
      delete next[targetId]
      return next
    })
    if (!isRoleGroup && conversation.type === 'group' && remaining.length === 2) {
      await supabase.from('conversations').update({ type: 'dm' }).eq('id', conversation.id)
      onConversationUpdate({ type: 'dm' })
    }
    if (targetMeta) {
      await postSystemMessage(`${displayName(me)} removeu ${displayName(targetMeta)} do chat`)
    }
  }

  async function promoteLeader(targetId: string) {
    if (!conversation || !me) return
    const targetMeta = members[targetId]
    if (isRoleGroup) {
      await supabase
        .from('conversation_members')
        .update({ role: 'moderator' })
        .eq('conversation_id', conversation.id)
        .eq('user_id', targetId)
      setMembers((prev) => (prev[targetId] ? { ...prev, [targetId]: { ...prev[targetId], role: 'moderator' } } : prev))
      if (targetMeta) await postSystemMessage(`${displayName(me)} promoveu ${displayName(targetMeta)} a moderador`)
      return
    }
    await supabase
      .from('conversation_members')
      .update({ is_leader: true })
      .eq('conversation_id', conversation.id)
      .eq('user_id', targetId)
    setMembers((prev) => (prev[targetId] ? { ...prev, [targetId]: { ...prev[targetId], is_leader: true } } : prev))
    if (targetMeta) await postSystemMessage(`${displayName(me)} deu a coroa pra ${displayName(targetMeta)}`)
  }

  async function demoteLeader(targetId: string) {
    if (!conversation || !me) return
    const targetMeta = members[targetId]
    await supabase
      .from('conversation_members')
      .update({ is_leader: false })
      .eq('conversation_id', conversation.id)
      .eq('user_id', targetId)
    setMembers((prev) => (prev[targetId] ? { ...prev, [targetId]: { ...prev[targetId], is_leader: false } } : prev))
    if (targetMeta) await postSystemMessage(`${displayName(me)} tirou a coroa de ${displayName(targetMeta)}`)
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
      if (hasHiddenEdit(eventsToStore, content)) {
        setEditedIds((prev) => new Set(prev).add(msg.id))
      }
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

  const isOrganicGroup = conversation?.type === 'group' && !isRoleGroup

  const otherMemberEntry = useMemo(() => {
    if (!conversation) return null
    if (conversation.type === 'dm') {
      const entry = Object.entries(members).find(([id]) => id !== me?.id)
      return entry || null
    }
    if (isOrganicGroup) {
      // show the other original DM member (added_by === null) as the "face" of the group
      const entry = Object.entries(members).find(([id, meta]) => id !== me?.id && meta.added_by === null)
      return entry || null
    }
    return null
  }, [conversation, members, me?.id, isOrganicGroup])
  const otherMember = otherMemberEntry?.[1] || null

  const title = useMemo(() => {
    if (!conversation) return ''
    if (conversation.type === 'group') {
      if (isOrganicGroup && otherMember) return displayName(otherMember)
      return conversation.name || 'grupo'
    }
    return otherMember ? displayName(otherMember) : 'conversa'
  }, [conversation, otherMember, isOrganicGroup])

  const displayTitle = title

  const subtitle = useMemo(() => {
    if (!otherMember) return ''
    if (otherMember.status) return otherMember.status
    return formatPresence(otherMember.last_seen_at)
  }, [otherMember])

  function isReadByOthers(msg: Message) {
    let others = Object.entries(members).filter(([id]) => id !== me?.id)
    if (isOrganicGroup) {
      others = others.filter(([, meta]) => meta.added_by === null)
    }
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
            {isOrganicGroup && <span className="grupal-badge">Grupo</span>}
            {nudgeFrom && (
              <span className="nudge-indicator" title="chamou sua atenção">
                <IconBell size={14} />
                {conversation.type === 'group' && members[nudgeFrom] && ` ${displayName(members[nudgeFrom])}`}
              </span>
            )}
          </div>
          {subtitle && <div className="status">{subtitle}</div>}
        </div>
        <div className="header-actions" style={{ position: 'relative' }} ref={chatConfigRef}>
          <button
            type="button"
            className="nudge-btn"
            title="Config do chat"
            onClick={() => { setShowChatConfig((v) => !v); setConfigView('root'); setAddError(null) }}
          >
            <IconPlus size={20} />
          </button>

          {showChatConfig && (
            <div className="add-member-popover">
              {configView === 'root' && (
                <>
                  <div className="chat-config-members">
                    {Object.entries(members).map(([id, meta]) => (
                      <div key={id} className="chat-config-row">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {displayName(meta)}
                          {isRoleGroup
                            ? meta.role === 'admin'
                              ? ' (adm)'
                              : meta.role === 'moderator'
                                ? ' (mod)'
                                : ''
                            : (meta.added_by === null || meta.is_leader) && <IconCrown size={12} />}
                        </span>
                        {id !== me?.id && (
                          <span className="chat-config-actions">
                            {canPromote(meta) && (
                              <button type="button" onClick={() => promoteLeader(id)}>
                                {isRoleGroup ? 'mod' : 'dar coroa'}
                              </button>
                            )}
                            {canDemote(meta) && (
                              <button type="button" onClick={() => demoteLeader(id)}>tirar coroa</button>
                            )}
                            {canKick(meta) && (
                              <button type="button" onClick={() => removeMember(id)}>remover</button>
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setConfigView('invite')}>Convidar amigo</button>
                  {isRoleGroup && (myMembership?.role === 'admin' || myMembership?.role === 'moderator') && (
                    <button
                      type="button"
                      onClick={() => { setEditName(conversation?.name || ''); setEditDesc(conversation?.description || ''); setConfigView('edit') }}
                    >
                      Editar nome/descrição
                    </button>
                  )}
                </>
              )}
              {configView === 'edit' && (
                <>
                  <input placeholder="nome do grupo" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                  <input placeholder="descrição" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                  <button type="button" disabled={editBusy} onClick={saveGroupInfo}>Salvar</button>
                  <button type="button" onClick={() => setConfigView('root')}>voltar</button>
                </>
              )}
              {configView === 'invite' && (
                <>
                  <input
                    placeholder="email ou @usuário"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    autoFocus
                  />
                  <button type="button" disabled={addBusy} onClick={addMember}>Adicionar</button>
                  <button type="button" onClick={() => setConfigView('root')}>voltar</button>
                </>
              )}
              {addError && <span className="auth-error">{addError}</span>}
            </div>
          )}
        </div>
      </header>

      <section className="messages" onScroll={handleMessagesScroll}>
        {messages.filter((m) => !blockedIds.has(m.author_id)).map((m, idx, arr) => {
          const prev = arr[idx - 1]
          const showDate = !prev || !isSameDay(prev.created_at, m.created_at)
          return (
          <Fragment key={m.id}>
            {showDate && <div className="date">{formatDateLabel(m.created_at)}</div>}
            {m.kind === 'system' ? (
              <div className="system-message">{m.content}</div>
            ) : (
              <div className={`message ${m.author_id === me.id ? 'out' : 'in'}`}>
                <div className="bubble">
                  {m.author_id !== me.id && conversation.type === 'group' && (
                    <span
                      className="author-label"
                      style={{ cursor: members[m.author_id] ? 'pointer' : 'default' }}
                      onClick={() => members[m.author_id] && setProfilePopup({ id: m.author_id, meta: members[m.author_id] })}
                    >
                      {members[m.author_id] ? displayName(members[m.author_id]) : '...'}
                    </span>
                  )}
                  {m.content}
                  <span className="meta">
                    {formatMessageTime(m.created_at)}
                    {m.author_id === me.id && (
                      <span className={`read-receipt${isReadByOthers(m) ? ' read' : ''}`}>
                        {isReadByOthers(m) ? <IconCheckDouble size={15} /> : <IconCheck size={13} />}
                      </span>
                    )}
                  </span>
                  <button type="button" className="replay-btn" onClick={() => openReplay(m)}>
                    replay{editedIds.has(m.id) && <span className="replay-edited" title="tem coisa diferente do texto final">!</span>}
                  </button>
                </div>
              </div>
            )}
          </Fragment>
          )
        })}

        {Object.entries(liveTyping).filter(([userId]) => !blockedIds.has(userId)).map(([userId, text]) => (
          <div key={userId} className="message in live">
            <div className="bubble">
              <span className="author-label">{members[userId] ? displayName(members[userId]) : '...'}</span>
              {text}
            </div>
          </div>
        ))}

        {Object.entries(liveMedia).filter(([userId]) => !blockedIds.has(userId)).map(([userId, dataUrl]) => (
          <div key={`media-${userId}`} className={`message live ${userId === me.id ? 'out' : 'in'}`}>
            <div className="bubble">
              <span className="author-label">{members[userId] ? displayName(members[userId]) : '...'}</span>
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
        <div className="composer-icons">
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
          <button type="button" className="compose-btn" title="Chamar atenção" onClick={sendNudge}><IconBell size={20} /></button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
        </div>
        <div className="composer-input-row">
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
          <div className="modal-card" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="icon-btn"
              style={{ position: 'absolute', top: 8, right: 8 }}
              onClick={() => setProfileMenuOpen((v) => !v)}
            >
              <IconMore size={18} />
            </button>
            {profileMenuOpen && (
              <div className="request-menu" style={{ top: 40, right: 8 }}>
                <button type="button" onClick={blockFromPopup}>Bloquear</button>
              </div>
            )}
            <div className="account-avatar-wrap">
              <div className="account-avatar" style={{ overflow: 'hidden' }}>
                {profilePopup.meta.avatar_url ? (
                  <img src={profilePopup.meta.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <IconUser size={40} />
                )}
              </div>
            </div>
            <h2>{displayName(profilePopup.meta)}</h2>
            <p style={{ fontSize: '.75rem', color: '#8696a0' }}>{profilePopup.meta.email}</p>
            <p>{profilePopup.meta.status || 'sem status'}</p>
            <p style={{ fontSize: '.75rem' }}>{formatPresence(profilePopup.meta.last_seen_at)}</p>
            {friendRequestLoading ? null : friendRequestState === 'friends' ? (
              <p style={{ fontSize: '.75rem', color: '#a9e7d8' }}>✓ Amigos</p>
            ) : friendRequestState === 'sent' ? (
              <p style={{ fontSize: '.75rem', color: '#a9e7d8' }}>solicitação de amizade enviada</p>
            ) : (
              <button type="button" className="google-btn" onClick={sendFriendFromPopup}>
                <IconPlus size={14} /> Amigar
              </button>
            )}
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
