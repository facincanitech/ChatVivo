import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { playNudgeSound, triggerNudgeShake } from '../lib/nudge'
import { formatPresence, getPresenceColor } from '../lib/presence'
import { getErrorMessage } from '../lib/errors'
import { displayName } from '../lib/displayName'
import { colorFromId } from '../lib/avatarColor'
import { IconAttach, IconBell, IconChat, IconCheck, IconCheckDouble, IconCrown, IconMic, IconPlus, IconSend, IconSmile } from './icons'
import { ReplayPlayer, type ReplayEvent } from './ReplayPlayer'
import { ProfilePopup } from './ProfilePopup'
import type { Community, Conversation, Message, Profile } from '../types'

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
  onOpenCommunity: (c: Community) => void
}

export function MainPanel({ me, conversation, onBack, onConversationUpdate, blockedIds, onOpenCommunity }: Props) {
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
  const [configView, setConfigView] = useState<'root' | 'invite' | 'edit' | 'view' | 'members'>('root')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [editInvitePermission, setEditInvitePermission] = useState<'all' | 'owner'>('all')
  const [editBusy, setEditBusy] = useState(false)
  const [inviteFriends, setInviteFriends] = useState<{ id: string; username: string; display_name: string | null; avatar_url: string | null; email: string }[]>([])
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [profilePopupId, setProfilePopupId] = useState<string | null>(null)
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

  async function blockUser(userId: string) {
    if (!me) return
    await supabase.from('blocks').insert({ blocker_id: me.id, blocked_id: userId })
    setProfilePopupId(null)
    if (conversation?.type === 'dm' && userId === otherMemberEntry?.[0]) onBack()
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

  async function loadInviteFriends() {
    if (!me) return
    const { data } = await supabase
      .from('friend_requests')
      .select(
        'from_id, to_id, from_profile:profiles!friend_requests_from_id_fkey(id, username, display_name, avatar_url, email), to_profile:profiles!friend_requests_to_id_fkey(id, username, display_name, avatar_url, email)',
      )
      .eq('status', 'accepted')
      .or(`from_id.eq.${me.id},to_id.eq.${me.id}`)
    setInviteFriends(
      (data || []).map((row: any) => (row.from_id === me.id ? row.to_profile : row.from_profile)),
    )
  }

  async function addMember(target: { id: string; username: string; email?: string; display_name?: string | null; avatar_url?: string | null }) {
    if (!me || !conversation) return
    setAddBusy(true)
    setAddError(null)
    try {
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
        [target.id]: {
          username: target.username,
          display_name: target.display_name ?? null,
          email: target.email || '',
          avatar_url: target.avatar_url ?? null,
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
  const canEditGroupInfo = isRoleGroup && (myMembership?.role === 'admin' || myMembership?.role === 'moderator')

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

  function openGroupEdit() {
    setEditName(conversation?.name || '')
    setEditDesc(conversation?.description || '')
    setEditImageUrl(conversation?.image_url || '')
    setEditInvitePermission(conversation?.invite_permission || 'all')
    setShowChatConfig(true)
    setConfigView(canEditGroupInfo ? 'edit' : 'view')
  }

  async function saveGroupInfo() {
    if (!conversation) return
    setEditBusy(true)
    try {
      const patch: Partial<Conversation> = { name: editName.trim(), description: editDesc.trim() || null, image_url: editImageUrl.trim() || null }
      if (isRoleGroup) patch.invite_permission = editInvitePermission
      await supabase
        .from('conversations')
        .update(patch)
        .eq('id', conversation.id)
      onConversationUpdate(patch)
      setConfigView('root')
    } finally {
      setEditBusy(false)
    }
  }

  const canInvite = !isRoleGroup || conversation?.invite_permission !== 'owner' || myMembership?.role === 'admin'

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
          style={{ position: 'relative', cursor: otherMember || isRoleGroup ? 'pointer' : 'default' }}
          onClick={() => {
            if (otherMember && me) setProfilePopupId(otherMemberEntry![0])
            else if (isRoleGroup) openGroupEdit()
          }}
        >
          <div
            className="header-photo"
            style={{ overflow: 'hidden', ...(!otherMember && !conversation.image_url ? { background: colorFromId(conversation.id), color: '#fff' } : {}) }}
          >
            {otherMember?.avatar_url ? (
              <img src={otherMember.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : !otherMember && conversation.image_url ? (
              <img src={conversation.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : !otherMember ? (
              'G'
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
            style={{ cursor: otherMember || isRoleGroup ? 'pointer' : 'default' }}
            onClick={() => {
            if (otherMember && me) setProfilePopupId(otherMemberEntry![0])
            else if (isRoleGroup) openGroupEdit()
          }}
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
        <div className="header-actions">
          <button
            type="button"
            className="nudge-btn"
            title="Config do chat"
            onClick={() => { setShowChatConfig(true); setConfigView('root'); setAddError(null) }}
          >
            <IconPlus size={20} />
          </button>
        </div>
      </header>

      {showChatConfig && (
        <div className="modal-backdrop" onClick={() => setShowChatConfig(false)}>
          <div className="modal-card group-info-card" onClick={(e) => e.stopPropagation()}>
            <div
              className="group-info-avatar"
              style={{
                cursor: canEditGroupInfo ? 'pointer' : 'default',
                ...(conversation.image_url ? {} : { background: colorFromId(conversation.id), color: '#fff' }),
              }}
              onClick={() => canEditGroupInfo && configView === 'root' && openGroupEdit()}
            >
              {conversation.image_url ? (
                <img src={conversation.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                'G'
              )}
            </div>
            <h2>{conversation.name || title}</h2>
            <p className="status">
              grupo ·{' '}
              <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setConfigView('members')}>
                {Object.keys(members).length} membros
              </span>
            </p>
            {conversation.description && configView === 'root' && (
              <p className="community-description">{conversation.description}</p>
            )}

            {configView === 'root' && (
              <div className="group-info-actions">
                {canInvite && (
                  <button type="button" onClick={() => { loadInviteFriends(); setConfigView('invite') }}>Convidar amigo</button>
                )}
                {canEditGroupInfo && (
                  <button type="button" onClick={openGroupEdit}>Editar nome/descrição/foto</button>
                )}
                <button type="button" onClick={() => setConfigView('members')}>Ver membros</button>
              </div>
            )}
            {configView === 'members' && (
              <>
                <label className="group-info-section-label">
                  {Object.keys(members).length} membros
                </label>
                <div className="chat-config-members">
                  {Object.entries(members)
                    .sort(([, a], [, b]) => displayName(a).localeCompare(displayName(b), 'pt-BR'))
                    .map(([id, meta]) => (
                    <div key={id} className="chat-config-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <div className="photo" style={{ width: 32, height: 32, flexShrink: 0 }}>
                          {meta.avatar_url ? <img src={meta.avatar_url} alt="" /> : (meta.username[0] || '?').toUpperCase()}
                        </div>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {displayName(meta)}
                          {isRoleGroup
                            ? meta.role === 'admin'
                              ? ' (adm)'
                              : meta.role === 'moderator'
                                ? ' (mod)'
                                : ''
                            : (meta.added_by === null || meta.is_leader) && <IconCrown size={12} />}
                        </span>
                      </div>
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
                <button type="button" onClick={() => setConfigView('root')} style={{ marginTop: 10 }}>voltar</button>
              </>
            )}
            {configView === 'edit' && (
              <div className="new-conv-form" style={{ padding: 0 }}>
                <input placeholder="nome do grupo" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                <input placeholder="descrição" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                <input placeholder="link da imagem" value={editImageUrl} onChange={(e) => setEditImageUrl(e.target.value)} />
                {isRoleGroup && (
                  <>
                    <label className="group-info-section-label" style={{ marginTop: 6 }}>Quem pode convidar</label>
                    <div className="theme-picker">
                      <button
                        type="button"
                        className={`theme-option${editInvitePermission === 'all' ? ' active' : ''}`}
                        onClick={() => setEditInvitePermission('all')}
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        className={`theme-option${editInvitePermission === 'owner' ? ' active' : ''}`}
                        onClick={() => setEditInvitePermission('owner')}
                      >
                        Só o dono
                      </button>
                    </div>
                  </>
                )}
                <button type="button" disabled={editBusy} onClick={saveGroupInfo}>Salvar</button>
                <button type="button" onClick={() => setConfigView('root')}>voltar</button>
              </div>
            )}
            {configView === 'view' && (
              <button type="button" onClick={() => setConfigView('root')} style={{ marginTop: 10 }}>voltar</button>
            )}
            {configView === 'invite' && (
              <>
                <div className="chat-config-members">
                  {inviteFriends.filter((f) => !members[f.id]).length === 0 && (
                    <span style={{ fontSize: '.8rem', color: '#8696a0' }}>
                      {inviteFriends.length === 0 ? 'você ainda não tem amigos' : 'todos os seus amigos já estão aqui'}
                    </span>
                  )}
                  {inviteFriends.filter((f) => !members[f.id]).map((f) => (
                    <div key={f.id} className="chat-config-row" style={{ cursor: addBusy ? 'default' : 'pointer' }} onClick={() => !addBusy && addMember(f)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <div className="photo" style={{ width: 32, height: 32, flexShrink: 0 }}>
                          {f.avatar_url ? <img src={f.avatar_url} alt="" /> : (f.username[0] || '?').toUpperCase()}
                        </div>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(f)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setConfigView('root')} style={{ marginTop: 10 }}>voltar</button>
              </>
            )}
            {addError && <span className="auth-error">{addError}</span>}
            <button type="button" className="modal-close" onClick={() => setShowChatConfig(false)}>fechar</button>
          </div>
        </div>
      )}

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
                      onClick={() => members[m.author_id] && setProfilePopupId(m.author_id)}
                    >
                      {members[m.author_id] ? displayName(members[m.author_id]) : '...'}
                    </span>
                  )}
                  {m.content}
                  <div className="message-footer">
                    <button type="button" className="replay-btn" onClick={() => openReplay(m)}>
                      replay{editedIds.has(m.id) && <span className="replay-edited" title="tem coisa diferente do texto final">!</span>}
                    </button>
                    <span className="meta">
                      {formatMessageTime(m.created_at)}
                      {m.author_id === me.id && (
                        <span className={`read-receipt${isReadByOthers(m) ? ' read' : ''}`}>
                          {isReadByOthers(m) ? <IconCheckDouble size={15} /> : <IconCheck size={13} />}
                        </span>
                      )}
                    </span>
                  </div>
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

      {profilePopupId && me && (
        <ProfilePopup
          me={me}
          userId={profilePopupId}
          onClose={() => setProfilePopupId(null)}
          onOpenCommunity={onOpenCommunity}
          blockedIds={blockedIds}
          onBlock={blockUser}
        />
      )}
    </main>
  )
}

