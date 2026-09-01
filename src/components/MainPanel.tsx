import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { playNudgeSound, triggerNudgeShake } from '../lib/nudge'
import { WINKS, playWinkEffect, playCustomWinkEffect } from '../lib/winks'
import { getCustomWinks, saveCustomWink, deleteCustomWink, fileToDataUrl, type CustomWink } from '../lib/customWinks'
import { getPresenceColor } from '../lib/presence'
import { getErrorMessage } from '../lib/errors'
import { displayName } from '../lib/displayName'
import { colorFromId } from '../lib/avatarColor'
import { sanitizeImageUrl } from '../lib/imageUrl'
import { uploadImage } from '../lib/uploadImage'
import { readCache, writeCache } from '../lib/cache'
import { sendPush } from '../lib/pushSend'
import {
  uploadEphemeralMedia,
  openEphemeralMedia,
  checkExpireEphemeralMedia,
  type EphemeralKind,
  type EphemeralMediaRow,
  type EphemeralMediaView,
  type EphemeralOpenResult,
} from '../lib/ephemeralMedia'
import { IconArrowLeft, IconAttach, IconBell, IconChat, IconCheck, IconCheckDouble, IconChevronDown, IconCrown, IconDownload, IconHeart, IconLock, IconMic, IconNudge, IconPhone, IconPlus, IconSend, IconSmile, IconVideo } from './icons'
import type { CallKind, CallPeer } from '../lib/call'
import { ReplayPlayer, type ReplayEvent } from './ReplayPlayer'
import { ProfilePopup } from './ProfilePopup'
import type { Community, Conversation, Message, Profile } from '../types'

const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😍',
  '🥰', '😘', '😋', '😜', '🤪', '🤩', '🥳', '😎', '🤓', '🧐',
  '😏', '😒', '🙄', '😬', '🤔', '😴', '🥱', '😪', '😢', '😭',
  '🥺', '😤', '😠', '😡', '🤬', '😨', '😱', '😰', '😅', '😓',
  '🤯', '😳', '🥵', '🥶', '😷', '🤒', '🤕', '🤢', '🤮', '🥴',
  '😵', '🤗', '🤭', '🤫', '🤥', '😶', '💀', '☠️', '👻', '👽',
  '🤖', '🎃', '😺', '😹', '😻', '🙈', '🙉', '🙊',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💕', '💞',
  '💓', '💗', '💖', '💘', '💔', '❣️', '💯', '💢', '💥', '💫',
  '👍', '👎', '👏', '🙌', '🙏', '🤝', '👋', '🤙', '💪', '✌️',
  '🤞', '🤟', '👌', '🫡', '👀', '🧠', '🦴',
  '🍕', '🍔', '🍟', '🌭', '🍿', '🍩', '🍪', '🍰', '🎂', '🍫',
  '🍬', '🍭', '🍎', '🍌', '🍉', '🍇', '🍓', '🥑', '🍺', '🍻',
  '🍷', '☕', '🧃', '🥤',
  '⚽', '🏀', '🏈', '🎮', '🎲', '🎧', '🎵', '🎉', '🎊', '🎁',
  '🏆', '🔥', '💧', '⭐', '🌟', '✨', '🌈', '☀️', '🌙', '⚡',
  '🚗', '✈️', '🚀', '📱', '💻', '📷', '💡', '💰', '💸', '🕐',
  '✅', '❌', '❓', '❗', '⚠️', '🔒', '👑', '💎',
]
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

// fecha um popup (menu/picker) ao clicar ou tocar fora de qualquer um dos elementos passados em `refs`
function useOutsideClose(active: boolean, refs: React.RefObject<HTMLElement | null>[], onClose: () => void) {
  useEffect(() => {
    if (!active) return
    function onOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node
      if (refs.some((r) => r.current?.contains(target))) return
      onClose()
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('touchstart', onOutside)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('touchstart', onOutside)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
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
  name_style_font: string | null
  name_style_effect: 'solid' | 'gradient' | 'neon' | 'prism' | null
  name_style_color: string | null
}

type Props = {
  me: Profile | null
  conversation: Conversation | null
  onBack: () => void
  onConversationUpdate: (patch: Partial<Conversation>) => void
  blockedIds: Set<string>
  onOpenCommunity: (c: Community) => void
  onStartCall: (peer: CallPeer, kind: CallKind) => void
}

export function MainPanel({ me, conversation, onBack, onConversationUpdate, blockedIds, onOpenCommunity, onStartCall }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<Record<string, MemberMeta>>({})
  const [draft, setDraft] = useState('')
  const [liveTyping, setLiveTyping] = useState<Record<string, string>>({})
  const [showEmoji, setShowEmoji] = useState(false)
  const [showWinks, setShowWinks] = useState(false)
  const [customWinks, setCustomWinks] = useState<CustomWink[]>([])
  const [winkManagerView, setWinkManagerView] = useState<'closed' | 'list' | 'form'>('closed')
  const [editingWinkId, setEditingWinkId] = useState<string | null>(null)
  const [newWinkLabel, setNewWinkLabel] = useState('')
  const [newWinkImage, setNewWinkImage] = useState<string | null>(null)
  const [newWinkSound, setNewWinkSound] = useState<string | null>(null)
  const [newWinkError, setNewWinkError] = useState<string | null>(null)
  const winkImageInputRef = useRef<HTMLInputElement>(null)
  const winkSoundInputRef = useRef<HTMLInputElement>(null)

  function reloadCustomWinks() {
    getCustomWinks().then(setCustomWinks).catch(() => setCustomWinks([]))
  }

  useEffect(() => {
    if (!showWinks) return
    reloadCustomWinks()
  }, [showWinks])

  function openWinkManager() {
    setShowWinks(false)
    reloadCustomWinks()
    setWinkManagerView('list')
  }

  function openWinkForm(existing?: CustomWink) {
    setEditingWinkId(existing?.id || null)
    setNewWinkLabel(existing?.label || '')
    setNewWinkImage(existing?.imageData || null)
    setNewWinkSound(existing?.soundData || null)
    setNewWinkError(null)
    setWinkManagerView('form')
  }
  const [recording, setRecording] = useState(false)
  const [replayFor, setReplayFor] = useState<Message | null>(null)
  const [replayEvents, setReplayEvents] = useState<ReplayEvent[] | null>(null)
  const [showChatConfig, setShowChatConfig] = useState(false)
  const [configView, setConfigView] = useState<'root' | 'invite' | 'edit' | 'view' | 'members'>('root')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [editInvitePermission, setEditInvitePermission] = useState<'all' | 'owner'>('all')
  const [groupImageUploading, setGroupImageUploading] = useState(false)
  const [groupImageFailed, setGroupImageFailed] = useState(false)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false)
  const groupImageInputRef = useRef<HTMLInputElement>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [inviteFriends, setInviteFriends] = useState<{ id: string; username: string; display_name: string | null; avatar_url: string | null; email: string }[]>([])
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [profilePopupId, setProfilePopupId] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [nudgeFrom, setNudgeFrom] = useState<string | null>(null)
  const [editedIds, setEditedIds] = useState<Set<string>>(new Set())
  const [ephemeralByMessage, setEphemeralByMessage] = useState<Record<string, EphemeralMediaRow>>({})
  const [pendingEphemeralFile, setPendingEphemeralFile] = useState<File | null>(null)
  const [pendingViewOnce, setPendingViewOnce] = useState(false)
  const [ephemeralSending, setEphemeralSending] = useState(false)
  const [ephemeralViewer, setEphemeralViewer] = useState<(EphemeralOpenResult & { id: string }) | null>(null)
  const [inlineMedia, setInlineMedia] = useState<Record<string, EphemeralOpenResult & { id: string }>>({})
  const [openTranscripts, setOpenTranscripts] = useState<Set<string>>(new Set())
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [pendingFilePreviewUrl, setPendingFilePreviewUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const requestedInlineRef = useRef<Set<string>>(new Set())
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const attachBtnRef = useRef<HTMLButtonElement>(null)
  const emojiMenuRef = useRef<HTMLDivElement>(null)
  const emojiBtnRef = useRef<HTMLButtonElement>(null)
  const winkMenuRef = useRef<HTMLDivElement>(null)
  const winkBtnRef = useRef<HTMLButtonElement>(null)

  useOutsideClose(showAttachMenu, [attachMenuRef, attachBtnRef], () => setShowAttachMenu(false))
  useOutsideClose(showEmoji, [emojiMenuRef, emojiBtnRef], () => setShowEmoji(false))
  useOutsideClose(showWinks, [winkMenuRef, winkBtnRef], () => setShowWinks(false))

  useEffect(() => {
    if (!pendingEphemeralFile) {
      setPendingFilePreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(pendingEphemeralFile)
    setPendingFilePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingEphemeralFile])

  const channelRef = useRef<RealtimeChannel | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const replayBuffer = useRef<ReplayEvent[]>([])
  const messagesRef = useRef<Message[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    setGroupImageFailed(false)
  }, [conversation?.image_url])

  function hasHiddenEdit(events: ReplayEvent[], finalContent: string): boolean {
    // so conta como "edição escondida" quando o texto chegou a ficar
    // bem maior do que o final e depois encolheu — pequenas correções de
    // digitação (typo de 1-2 letras, ou o interim do reconhecimento de voz
    // se revisando) não contam, senão a bolinha vermelha aparece direto
    let maxLen = 0
    for (const e of events) {
      const len = (e.text ?? '').length
      if (len > maxLen) maxLen = len
    }
    return maxLen - finalContent.length >= 6
  }

  useEffect(() => {
    setMessages(conversation ? readCache<Message[]>(`flux-messages:${conversation.id}`) || [] : [])
    setMembers(conversation ? readCache<Record<string, MemberMeta>>(`flux-members:${conversation.id}`) || {} : {})
    setLiveTyping({})
    setDraft('')
    setAtBottom(true)
    setNudgeFrom(null)
    setEditedIds(new Set())
    setEphemeralByMessage({})
    setPendingEphemeralFile(null)
    setEphemeralViewer(null)
    setInlineMedia({})
    setOpenTranscripts(new Set())
    requestedInlineRef.current = new Set()
    setShowChatConfig(false)
    setConfigView('root')
    setConfirmDeleteGroup(false)
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
        .select('user_id, last_read_at, added_by, is_leader, role, profile:profiles!conversation_members_user_id_fkey(id, username, display_name, email, avatar_url, status, last_seen_at, is_idle, name_style_font, name_style_effect, name_style_color)')
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
              name_style_font: p.name_style_font ?? null,
              name_style_effect: p.name_style_effect ?? null,
              name_style_color: p.name_style_color ?? null,
            }
          }
        }
        setMembers(map)
        writeCache(`flux-members:${conversation.id}`, map)
      }
    }

    async function load() {
      if (!conversation) return
      await loadMembers()

      const { data: msgs } = await supabase
        .from('messages')
        .select('*, message_replays(events), ephemeral_media(*, ephemeral_media_views(*))')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(200)

      if (!cancelled && msgs) {
        setMessages(msgs as Message[])
        writeCache(`flux-messages:${conversation.id}`, msgs.slice(-100))
        const edited = new Set<string>()
        const ephemeralMap: Record<string, EphemeralMediaRow> = {}
        for (const m of msgs as (Message & {
          message_replays: { events: ReplayEvent[] }[] | { events: ReplayEvent[] } | null
          ephemeral_media: EphemeralMediaRow[] | EphemeralMediaRow | null
        })[]) {
          const raw = m.message_replays
          const events = Array.isArray(raw) ? raw[0]?.events : raw?.events
          if (events && hasHiddenEdit(events, m.content)) edited.add(m.id)
          const eph = Array.isArray(m.ephemeral_media) ? m.ephemeral_media[0] : m.ephemeral_media
          if (eph) ephemeralMap[m.id] = eph
        }
        setEditedIds(edited)
        setEphemeralByMessage(ephemeralMap)
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
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const msg = payload.new as Message
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev
            const next = [...prev, msg]
            writeCache(`flux-messages:${conversation.id}`, next.slice(-100))
            return next
          })
          setLiveTyping((prev) => {
            const next = { ...prev }
            delete next[msg.author_id]
            return next
          })
          markRead()
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ephemeral_media', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const row = payload.new as EphemeralMediaRow
          setEphemeralByMessage((prev) => ({ ...prev, [row.message_id]: row }))
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
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
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
    sendPush(Object.keys(members).filter((id) => id !== me.id), displayName(me), 'chamou sua atenção', conversation.id)
  }

  function sendWink(winkId: string) {
    if (!me || !conversation) return
    setShowWinks(false)
    playWinkEffect(winkId)

    Object.keys(members)
      .filter((id) => id !== me.id)
      .forEach((id) => {
        const personalChannel = supabase.channel(`nudge:${id}`)
        personalChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            personalChannel.send({
              type: 'broadcast',
              event: 'wink',
              payload: { userId: me.id, conversationId: conversation.id, winkId },
            })
            setTimeout(() => supabase.removeChannel(personalChannel), 1000)
          }
        })
      })
    sendPush(Object.keys(members).filter((id) => id !== me.id), displayName(me), 'mandou um wink', conversation.id)
  }

  const MAX_WINK_IMAGE_BYTES = 300 * 1024
  const MAX_WINK_SOUND_BYTES = 150 * 1024

  async function pickWinkImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_WINK_IMAGE_BYTES) {
      setNewWinkError('Imagem muito grande, escolhe uma menor (até 300KB, tipo figurinha)')
      return
    }
    setNewWinkError(null)
    setNewWinkImage(await fileToDataUrl(file))
  }

  async function pickWinkSound(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_WINK_SOUND_BYTES) {
      setNewWinkError('Som muito grande, escolhe um menor (até 150KB, tipo curtinho)')
      return
    }
    setNewWinkError(null)
    setNewWinkSound(await fileToDataUrl(file))
  }

  async function saveWinkForm() {
    if (!newWinkImage) {
      setNewWinkError('Escolhe uma imagem ou gif')
      return
    }
    const wink: CustomWink = {
      id: editingWinkId || crypto.randomUUID(),
      label: newWinkLabel.trim() || 'Wink',
      imageData: newWinkImage,
      soundData: newWinkSound,
      fromUser: null,
    }
    await saveCustomWink(wink)
    setCustomWinks((prev) => {
      const exists = prev.some((w) => w.id === wink.id)
      return exists ? prev.map((w) => (w.id === wink.id ? wink : w)) : [...prev, wink]
    })
    setWinkManagerView('list')
  }

  async function removeCustomWink(id: string) {
    await deleteCustomWink(id)
    setCustomWinks((prev) => prev.filter((w) => w.id !== id))
    if (editingWinkId === id) setWinkManagerView('list')
  }

  function sendCustomWink(wink: CustomWink) {
    if (!me || !conversation) return
    setShowWinks(false)
    playCustomWinkEffect(wink.imageData, wink.soundData)

    Object.keys(members)
      .filter((id) => id !== me.id)
      .forEach((id) => {
        const personalChannel = supabase.channel(`nudge:${id}`)
        personalChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            personalChannel.send({
              type: 'broadcast',
              event: 'customWink',
              payload: {
                userId: me.id,
                conversationId: conversation.id,
                label: wink.label,
                imageData: wink.imageData,
                soundData: wink.soundData,
              },
            })
            setTimeout(() => supabase.removeChannel(personalChannel), 1000)
          }
        })
      })
    sendPush(Object.keys(members).filter((id) => id !== me.id), displayName(me), `mandou um wink (${wink.label})`, conversation.id)
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
          name_style_font: null,
          name_style_effect: null,
          name_style_color: null,
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

  async function uploadGroupImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !me) return
    setGroupImageUploading(true)
    try {
      const url = await uploadImage(file, me.id, 'group')
      setEditImageUrl(url)
    } catch (err) {
      setAddError(getErrorMessage(err))
    } finally {
      setGroupImageUploading(false)
      if (groupImageInputRef.current) groupImageInputRef.current.value = ''
    }
  }

  async function saveGroupInfo() {
    if (!conversation) return
    setEditBusy(true)
    try {
      const patch: Partial<Conversation> = { name: editName.trim(), description: editDesc.trim() || null, image_url: sanitizeImageUrl(editImageUrl) }
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

  async function deleteGroup() {
    if (!conversation) return
    setEditBusy(true)
    try {
      await supabase.from('conversations').delete().eq('id', conversation.id)
      setShowChatConfig(false)
      onBack()
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

  function handleAttachFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPendingEphemeralFile(file)
    setPendingViewOnce(false)
    setShowAttachMenu(false)
  }

  async function sendEphemeralMedia() {
    if (!pendingEphemeralFile || !conversation || !me) return
    const kind: EphemeralKind = pendingViewOnce ? 'view_once' : 'timed'
    setEphemeralSending(true)
    try {
      const label = kind === 'view_once' ? 'Mídia de visualização única' : 'Mídia temporária'
      const { data: msg, error: msgErr } = await supabase
        .from('messages')
        .insert({ conversation_id: conversation.id, author_id: me.id, content: label, kind: 'ephemeral' })
        .select()
        .single()
      if (msgErr || !msg) throw msgErr

      const { storagePath, mediaType, fileName } = await uploadEphemeralMedia(pendingEphemeralFile, conversation.id, msg.id)

      const { data: ephemeralRow, error: ephErr } = await supabase
        .from('ephemeral_media')
        .insert({
          message_id: msg.id,
          conversation_id: conversation.id,
          storage_path: storagePath,
          media_type: mediaType,
          file_name: fileName,
          kind,
        })
        .select()
        .single()
      if (ephErr) throw ephErr

      setEphemeralByMessage((prev) => ({ ...prev, [msg.id]: ephemeralRow as EphemeralMediaRow }))
      setPendingEphemeralFile(null)
      setPendingViewOnce(false)

      const recipientIds = Object.keys(members).filter((id) => id !== me.id)
      sendPush(recipientIds, displayName(me), kind === 'view_once' ? 'mandou uma mídia de visualização única' : 'mandou uma mídia temporária', conversation.id)
    } catch (err) {
      console.error('sendEphemeralMedia failed', err)
    } finally {
      setEphemeralSending(false)
    }
  }

  function myEphemeralView(eph: EphemeralMediaRow) {
    return eph.ephemeral_media_views?.find((v) => v.user_id === me?.id) || null
  }

  function upsertMyEphemeralView(messageId: string, patch: Partial<EphemeralMediaView>) {
    setEphemeralByMessage((prev) => {
      const eph = prev[messageId]
      if (!eph || !me) return prev
      const views = eph.ephemeral_media_views || []
      const existing = views.find((v) => v.user_id === me.id)
      const nextViews = existing
        ? views.map((v) => (v.user_id === me.id ? { ...v, ...patch } : v))
        : [...views, { id: 'local', ephemeral_media_id: eph.id, user_id: me.id, opened_at: null, expired: false, ...patch }]
      return { ...prev, [messageId]: { ...eph, ephemeral_media_views: nextViews } }
    })
  }

  async function handleOpenEphemeral(row: EphemeralMediaRow, opts?: { inline?: boolean }) {
    if (row.storage_deleted || myEphemeralView(row)?.expired) return
    try {
      const result = await openEphemeralMedia(row.id)
      if ('expired' in result) {
        upsertMyEphemeralView(row.message_id, { expired: true })
        return
      }
      if (opts?.inline) {
        setInlineMedia((prev) => ({ ...prev, [row.message_id]: { ...result, id: row.id } }))
      } else {
        setEphemeralViewer({ ...result, id: row.id })
      }
      if (result.kind === 'view_once') {
        upsertMyEphemeralView(row.message_id, { expired: true, opened_at: new Date().toISOString() })
        // da um tempo pro cliente carregar a imagem/video antes de mandar o servidor apagar o storage
        setTimeout(() => {
          checkExpireEphemeralMedia(row.id).catch(() => {})
        }, 8000)
      } else {
        upsertMyEphemeralView(row.message_id, { opened_at: myEphemeralView(row)?.opened_at || new Date().toISOString() })
        setTimeout(async () => {
          const { expired } = await checkExpireEphemeralMedia(row.id).catch(() => ({ expired: false }))
          if (expired) {
            upsertMyEphemeralView(row.message_id, { expired: true })
            setInlineMedia((prev) => {
              if (!prev[row.message_id]) return prev
              const next = { ...prev }
              delete next[row.message_id]
              return next
            })
          }
        }, 61_000)
      }
    } catch (err) {
      console.error('handleOpenEphemeral failed', err)
    }
  }

  // midia "temporaria" (nao visualizacao unica) aparece direto no chat, sem
  // precisar tocar em botao - o toque-pra-ver so continua existindo pra
  // visualizacao unica, que precisa de uma acao explicita antes de sumir
  useEffect(() => {
    for (const eph of Object.values(ephemeralByMessage)) {
      if (eph.kind !== 'timed') continue
      if (eph.storage_deleted) continue
      if (myEphemeralView(eph)?.expired) continue
      if (inlineMedia[eph.message_id]) continue
      if (requestedInlineRef.current.has(eph.message_id)) continue
      requestedInlineRef.current.add(eph.message_id)
      handleOpenEphemeral(eph, { inline: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ephemeralByMessage])

  function toggleTranscript(messageId: string) {
    setOpenTranscripts((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  async function sendAudioMessage(file: File, transcript: string) {
    if (!conversation || !me) return
    setEphemeralSending(true)
    try {
      const { data: msg, error: msgErr } = await supabase
        .from('messages')
        .insert({ conversation_id: conversation.id, author_id: me.id, content: transcript, kind: 'ephemeral' })
        .select()
        .single()
      if (msgErr || !msg) throw msgErr

      const { storagePath, fileName } = await uploadEphemeralMedia(file, conversation.id, msg.id)

      const { data: ephemeralRow, error: ephErr } = await supabase
        .from('ephemeral_media')
        .insert({
          message_id: msg.id,
          conversation_id: conversation.id,
          storage_path: storagePath,
          media_type: 'audio',
          file_name: fileName,
          kind: 'timed',
        })
        .select()
        .single()
      if (ephErr) throw ephErr

      setEphemeralByMessage((prev) => ({ ...prev, [msg.id]: ephemeralRow as EphemeralMediaRow }))
      const recipientIds = Object.keys(members).filter((id) => id !== me.id)
      sendPush(recipientIds, displayName(me), 'mandou um áudio', conversation.id)
    } catch (err) {
      console.error('sendAudioMessage failed', err)
    } finally {
      setEphemeralSending(false)
    }
  }

  function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop()
      return
    }

    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        const chunks: BlobPart[] = []
        const recorder = new MediaRecorder(stream)
        mediaRecorderRef.current = recorder

        const autoTranscribe = localStorage.getItem('flux-auto-transcribe') !== '0'
        const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        let recognition: SpeechRecognitionLike | null = null
        let transcript = ''
        if (autoTranscribe && SpeechRecognitionCtor) {
          const r: SpeechRecognitionLike = new SpeechRecognitionCtor()
          r.lang = 'pt-BR'
          r.continuous = true
          r.interimResults = true
          r.onresult = (e: any) => {
            let t = ''
            for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript
            transcript = t
          }
          r.onend = () => {}
          r.onerror = () => {}
          try {
            r.start()
          } catch {
            // ignore
          }
          recognition = r
        }

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data)
        }
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          try {
            recognition?.stop()
          } catch {
            // ignore
          }
          setRecording(false)
          if (chunks.length === 0) return
          const blob = new Blob(chunks, { type: 'audio/webm' })
          const file = new File([blob], `audio-${Date.now()}.webm`, { type: 'audio/webm' })
          sendAudioMessage(file, transcript.trim())
        }
        recorder.start()
        setRecording(true)
      })
      .catch((err) => {
        console.error('mic access failed', err)
        alert('Não consegui acessar o microfone.')
      })
  }

  async function handleSend() {
    const content = draft.trim()
    if (!content || !conversation || !me) return

    const eventsToStore = [...replayBuffer.current]
    broadcastTyping('')
    setDraft('')
    setAtBottom(true)
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

    const recipientIds = Object.keys(members).filter((id) => id !== me.id)
    sendPush(recipientIds, displayName(me), content, conversation.id)
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
        <button type="button" className="back-mobile icon-btn" onClick={onBack}><IconArrowLeft size={20} /></button>
        <div
          style={{ position: 'relative', cursor: otherMember || isRoleGroup ? 'pointer' : 'default' }}
          onClick={() => {
            if (otherMember && me) setProfilePopupId(otherMemberEntry![0])
            else if (isRoleGroup) openGroupEdit()
          }}
        >
          <div
            className="header-photo"
            style={{ overflow: 'hidden', ...(!otherMember && !(conversation.image_url && !groupImageFailed) ? { background: colorFromId(conversation.id), color: '#fff' } : {}) }}
          >
            {otherMember?.avatar_url ? (
              <img src={otherMember.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : !otherMember && conversation.image_url && !groupImageFailed ? (
              <img
                src={conversation.image_url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={() => setGroupImageFailed(true)}
              />
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
        </div>
        <div className="header-actions">
          {conversation.type === 'dm' && otherMember && otherMemberEntry && (
            <>
              <button
                type="button"
                className="icon-btn"
                title="Chamada de voz"
                onClick={() => onStartCall({ id: otherMemberEntry[0], name: displayName(otherMember), avatarUrl: otherMember.avatar_url }, 'audio')}
              >
                <IconPhone size={20} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Chamada de vídeo"
                onClick={() => onStartCall({ id: otherMemberEntry[0], name: displayName(otherMember), avatarUrl: otherMember.avatar_url }, 'video')}
              >
                <IconVideo size={20} />
              </button>
            </>
          )}
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
                ...((configView === 'edit' ? editImageUrl : conversation.image_url && !groupImageFailed)
                  ? {}
                  : { background: colorFromId(conversation.id), color: '#fff' }),
              }}
              onClick={() => {
                if (configView === 'edit') groupImageInputRef.current?.click()
                else if (canEditGroupInfo && configView === 'root') openGroupEdit()
              }}
            >
              {configView === 'edit' ? (
                editImageUrl ? (
                  <img src={editImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  'G'
                )
              ) : conversation.image_url && !groupImageFailed ? (
                <img
                  src={conversation.image_url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={() => setGroupImageFailed(true)}
                />
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
                            <button type="button" className="remove-btn" onClick={() => removeMember(id)}>remover</button>
                          )}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {configView === 'edit' && (
              <div className="new-conv-form" style={{ padding: 0 }}>
                <input placeholder="nome do grupo" value={editName} onChange={(e) => setEditName(e.target.value)} />
                <input placeholder="descrição" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                <input ref={groupImageInputRef} type="file" accept="image/*" hidden onChange={uploadGroupImage} />
                <button type="button" disabled={groupImageUploading} onClick={() => groupImageInputRef.current?.click()}>
                  {groupImageUploading ? 'enviando...' : editImageUrl ? 'Trocar foto' : 'Escolher foto'}
                </button>
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
                {conversation.created_by === me?.id && !confirmDeleteGroup && (
                  <button type="button" className="danger" disabled={editBusy} onClick={() => setConfirmDeleteGroup(true)} style={{ marginTop: 10 }}>
                    Excluir grupo
                  </button>
                )}
                {conversation.created_by === me?.id && confirmDeleteGroup && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button type="button" className="danger" disabled={editBusy} onClick={deleteGroup}>
                      Confirmar exclusão
                    </button>
                    <button type="button" disabled={editBusy} onClick={() => setConfirmDeleteGroup(false)}>
                      cancelar
                    </button>
                  </div>
                )}
              </div>
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
            ) : m.kind === 'ephemeral' ? (
              <div className={`message ${m.author_id === me.id ? 'out' : 'in'}`}>
                <div className="bubble">
                  {m.author_id !== me.id && conversation.type === 'group' && (
                    <span
                      className="author-label"
                      style={{ cursor: members[m.author_id] ? 'pointer' : 'default' }}
                      onClick={() => members[m.author_id] && setProfilePopupId(m.author_id)}
                    >
                      {/* estilo do nome fica só no card de perfil por pedido do usuário - members[id].name_style_* continua disponível se quiser trazer de volta aqui */}
                      {members[m.author_id] ? displayName(members[m.author_id]) : '...'}
                    </span>
                  )}
                  {(() => {
                    const eph = ephemeralByMessage[m.id]
                    if (!eph) return <span className="ephemeral-btn">carregando…</span>
                    const myView = myEphemeralView(eph)
                    if (eph.storage_deleted || myView?.expired) {
                      return (
                        <span className="ephemeral-btn expired">
                          <IconLock size={16} />
                          {eph.kind === 'view_once' ? 'Visualização única — já visto' : 'Mídia expirada'}
                        </span>
                      )
                    }
                    if (eph.kind === 'view_once') {
                      return (
                        <button type="button" className="ephemeral-btn" onClick={() => handleOpenEphemeral(eph)}>
                          <IconLock size={16} />
                          Visualização única — toque pra ver
                        </button>
                      )
                    }
                    const media = inlineMedia[m.id]
                    if (!media || !('url' in media)) return <span className="ephemeral-btn">carregando mídia…</span>
                    return (
                      <div className="ephemeral-inline">
                        {media.mediaType === 'image' && (
                          <div className="ephemeral-media-wrap">
                            <img src={media.url} alt="" onClick={() => setExpandedImage(media.url)} />
                            <a className="ephemeral-download" href={media.url} download={media.fileName || undefined} title="Baixar">
                              <IconDownload size={16} />
                            </a>
                          </div>
                        )}
                        {media.mediaType === 'video' && (
                          <div className="ephemeral-media-wrap">
                            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                            <video src={media.url} controls />
                            <a className="ephemeral-download" href={media.url} download={media.fileName || undefined} title="Baixar">
                              <IconDownload size={16} />
                            </a>
                          </div>
                        )}
                        {media.mediaType === 'audio' && (
                          <div className="audio-bubble">
                            <div className="audio-bubble-row">
                              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                              <audio src={media.url} controls />
                              <a className="ephemeral-download-inline" href={media.url} download={media.fileName || undefined} title="Baixar">
                                <IconDownload size={14} />
                              </a>
                            </div>
                            {m.content && (
                              <div className="audio-transcribe">
                                <button type="button" className="chevron-btn" onClick={() => toggleTranscript(m.id)}>
                                  <IconChevronDown size={13} /> {openTranscripts.has(m.id) ? 'Ocultar transcrição' : 'Transcrever'}
                                </button>
                                {openTranscripts.has(m.id) && <p className="audio-transcript-text">{m.content}</p>}
                              </div>
                            )}
                          </div>
                        )}
                        {media.mediaType === 'file' && (
                          <a className="ephemeral-file" href={media.url} download={media.fileName || undefined}>
                            <IconDownload size={16} /> {media.fileName || 'arquivo'}
                          </a>
                        )}
                      </div>
                    )
                  })()}
                  <div className="message-footer">
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
            ) : (
              <div className={`message ${m.author_id === me.id ? 'out' : 'in'}`}>
                <div className="bubble">
                  {m.author_id !== me.id && conversation.type === 'group' && (
                    <span
                      className="author-label"
                      style={{ cursor: members[m.author_id] ? 'pointer' : 'default' }}
                      onClick={() => members[m.author_id] && setProfilePopupId(m.author_id)}
                    >
                      {/* estilo do nome fica só no card de perfil por pedido do usuário - members[id].name_style_* continua disponível se quiser trazer de volta aqui */}
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

        <div ref={bottomRef} />
      </section>

      <footer className="composer">
        <div className="composer-icons">
          <button ref={emojiBtnRef} type="button" className="compose-btn" onClick={() => setShowEmoji((v) => !v)} title="Emoji"><IconSmile size={20} /></button>
          <button ref={attachBtnRef} type="button" className="compose-btn" onClick={() => setShowAttachMenu((v) => !v)} title="Anexar"><IconAttach size={20} /></button>
          <button
            type="button"
            className={`compose-btn${recording ? ' recording' : ''}`}
            onClick={toggleRecording}
            title={recording ? 'Parar e enviar áudio' : 'Gravar áudio'}
          >
            <IconMic size={20} />
          </button>
          <button type="button" className="compose-btn" title="Chamar atenção" onClick={sendNudge}><IconNudge size={20} /></button>
          <button ref={winkBtnRef} type="button" className="compose-btn" title="Mandar um wink" onClick={() => setShowWinks((v) => !v)}><IconHeart size={20} /></button>
          <input ref={docInputRef} type="file" hidden onChange={handleAttachFilePicked} />
          <input ref={mediaInputRef} type="file" accept="image/*,video/*" hidden onChange={handleAttachFilePicked} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleAttachFilePicked} />
          <input ref={audioInputRef} type="file" accept="audio/*" hidden onChange={handleAttachFilePicked} />
        </div>
        <div className="composer-input-row">
          <div className="input">
            <textarea
              value={draft}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem"
              rows={1}
            />
          </div>
          <button type="button" className="send" onClick={handleSend} disabled={!draft.trim()}><IconSend size={18} /></button>
        </div>

        {showAttachMenu && (
          <div className="attach-menu" ref={attachMenuRef}>
            <button type="button" onClick={() => cameraInputRef.current?.click()}>Câmera</button>
            <button type="button" onClick={() => mediaInputRef.current?.click()}>Fotos e vídeos</button>
            <button type="button" onClick={() => audioInputRef.current?.click()}>Áudio</button>
            <button type="button" onClick={() => docInputRef.current?.click()}>Documento</button>
          </div>
        )}

        {showEmoji && (
          <div className="emoji-picker" ref={emojiMenuRef}>
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

        {showWinks && (
          <div className="emoji-picker wink-picker" ref={winkMenuRef}>
            {WINKS.map((w) => (
              <button key={w.id} type="button" title={w.label} onClick={() => sendWink(w.id)}>
                {w.emoji}
              </button>
            ))}
            {customWinks.map((w) => (
              <button
                key={w.id}
                type="button"
                title={w.label}
                className="wink-picker-custom"
                onClick={() => sendCustomWink(w)}
                onContextMenu={(e) => { e.preventDefault(); removeCustomWink(w.id) }}
              >
                <img src={w.imageData} alt="" />
              </button>
            ))}
            <button type="button" title="Meus winks" className="wink-picker-add" onClick={openWinkManager}>
              <IconPlus size={16} />
            </button>
          </div>
        )}

        {winkManagerView === 'list' && (
          <div className="modal-backdrop" onClick={() => setWinkManagerView('closed')}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h2>Meus winks</h2>
              <button type="button" className="primary" onClick={() => openWinkForm()}>+ Criar wink</button>
              <div className="wink-manager-list">
                {customWinks.length === 0 && <p style={{ color: '#8696a0', fontSize: '.85rem' }}>nenhum wink criado ainda</p>}
                {customWinks.map((w) => (
                  <button key={w.id} type="button" className="wink-manager-item" onClick={() => openWinkForm(w)}>
                    <img src={w.imageData} alt="" />
                    <span>{w.label}</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setWinkManagerView('closed')}>fechar</button>
            </div>
          </div>
        )}

        {winkManagerView === 'form' && (
          <div className="modal-backdrop" onClick={() => setWinkManagerView('list')}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h2>{editingWinkId ? 'Editar wink' : 'Criar wink'}</h2>
              <div className="new-conv-form">
                <input
                  type="text"
                  placeholder="Nome do wink"
                  value={newWinkLabel}
                  onChange={(e) => setNewWinkLabel(e.target.value)}
                />
                <input ref={winkImageInputRef} type="file" accept="image/*" hidden onChange={pickWinkImage} />
                <button type="button" onClick={() => winkImageInputRef.current?.click()}>
                  {newWinkImage ? 'Trocar imagem/gif' : 'Escolher imagem/gif'}
                </button>
                {newWinkImage && <img src={newWinkImage} alt="" style={{ maxWidth: 120, maxHeight: 120, alignSelf: 'center' }} />}
                <input ref={winkSoundInputRef} type="file" accept="audio/*" hidden onChange={pickWinkSound} />
                <button type="button" onClick={() => winkSoundInputRef.current?.click()}>
                  {newWinkSound ? 'Trocar som' : 'Escolher som (opcional)'}
                </button>
                {newWinkError && <p className="error">{newWinkError}</p>}
                <button type="button" className="primary" onClick={saveWinkForm}>Salvar wink</button>
                {editingWinkId && (
                  <button type="button" className="danger" onClick={() => removeCustomWink(editingWinkId)}>Excluir wink</button>
                )}
                <button type="button" onClick={() => setWinkManagerView('list')}>voltar</button>
              </div>
            </div>
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

      {pendingEphemeralFile && (
        <div className="modal-backdrop" onClick={() => !ephemeralSending && setPendingEphemeralFile(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Enviar mídia temporária</h2>
            {pendingEphemeralFile.type.startsWith('image/') && (
              <img src={pendingFilePreviewUrl || ''} alt="" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8 }} />
            )}
            {pendingEphemeralFile.type.startsWith('video/') && (
              <video src={pendingFilePreviewUrl || ''} controls style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8 }} />
            )}
            {!pendingEphemeralFile.type.startsWith('image/') && !pendingEphemeralFile.type.startsWith('video/') && (
              <p className="status">{pendingEphemeralFile.name}</p>
            )}
            <button
              type="button"
              className={`theme-option${pendingViewOnce ? ' active' : ''}`}
              style={{ marginTop: 10 }}
              onClick={() => setPendingViewOnce((v) => !v)}
            >
              <IconLock size={14} /> Visualização única
            </button>
            <p style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 6 }}>
              {pendingViewOnce
                ? 'Some assim que for vista, sem opção de baixar.'
                : 'Some 1 minuto depois de aberta — dá pra baixar antes disso.'}
            </p>
            <div className="new-conv-form" style={{ marginTop: 10 }}>
              <button type="button" className="primary" disabled={ephemeralSending} onClick={sendEphemeralMedia}>
                {ephemeralSending ? 'Enviando...' : 'Enviar'}
              </button>
              <button type="button" disabled={ephemeralSending} onClick={() => setPendingEphemeralFile(null)}>cancelar</button>
            </div>
          </div>
        </div>
      )}

      {ephemeralViewer && (
        <div className="image-lightbox" onClick={() => setEphemeralViewer(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {'url' in ephemeralViewer && ephemeralViewer.mediaType === 'image' && <img src={ephemeralViewer.url} alt="mídia temporária" />}
            {'url' in ephemeralViewer && ephemeralViewer.mediaType === 'video' && (
              <video src={ephemeralViewer.url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '80vh' }} />
            )}
            {'url' in ephemeralViewer && ephemeralViewer.mediaType === 'file' && (
              <p style={{ color: '#fff' }}>{ephemeralViewer.fileName || 'arquivo'}</p>
            )}
            {'url' in ephemeralViewer && ephemeralViewer.kind === 'timed' && (
              <a
                href={ephemeralViewer.url}
                download={ephemeralViewer.fileName || undefined}
                className="google-btn"
                style={{ textDecoration: 'none', textAlign: 'center' }}
              >
                Baixar
              </a>
            )}
          </div>
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

