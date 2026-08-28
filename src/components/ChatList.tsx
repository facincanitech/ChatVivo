import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errors'
import { displayName } from '../lib/displayName'
import {
  IconArchive,
  IconArrowLeft,
  IconBellOff,
  IconGroup,
  IconHash,
  IconHeart,
  IconKey,
  IconListPlus,
  IconLock,
  IconLogout,
  IconMailUnread,
  IconMinusCircle,
  IconMore,
  IconPinOff,
  IconSearch,
  IconStar,
  IconTrash,
  IconUser,
} from './icons'
import type { Conversation, PanelView, Profile } from '../types'

type AccountView = 'root' | 'profile' | 'account' | 'privacy' | 'blocked' | 'terms'

type Props = {
  me: Profile | null
  selected: Conversation | null
  onSelect: (c: Conversation | null) => void
  panelOpen: boolean
  panelView: PanelView
  onPanelOpenChange: (open: boolean) => void
  onPanelViewChange: (view: PanelView) => void
  accountOpen: boolean
  onAccountOpenChange: (open: boolean) => void
  groupsOpen: boolean
  onGroupsOpenChange: (open: boolean) => void
  onProfileChange: (patch: Partial<Profile>) => void
  blockedIds: Set<string>
}

type ConvWithLabel = Conversation & {
  label: string
  avatarUrl: string | null
  otherId: string | null
  isFavorite: boolean
  favoritedAt: string | null
}
type FriendRequest = {
  id: string
  from_id: string
  from_profile: { id: string; username: string; email: string }
}
type OutgoingRequest = {
  id: string
  to_id: string
  status: string
  to_profile: { id: string; username: string; email: string }
}

type BlockedUser = { id: string; username: string; email: string }

export function ChatList({
  me,
  selected,
  onSelect,
  panelOpen,
  panelView,
  onPanelOpenChange,
  onPanelViewChange,
  accountOpen,
  onAccountOpenChange,
  groupsOpen,
  onGroupsOpenChange,
  onProfileChange,
  blockedIds,
}: Props) {
  const [conversations, setConversations] = useState<ConvWithLabel[]>([])
  const [groupsView, setGroupsView] = useState<'root' | 'create'>('root')
  const [myGroups, setMyGroups] = useState<{ id: string; name: string; role: string | null }[]>([])
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDesc, setNewGroupDesc] = useState('')
  const [groupsBusy, setGroupsBusy] = useState(false)
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'favorites'>('all')
  const [dmEmail, setDmEmail] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [inviteSent, setInviteSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [friendEmail, setFriendEmail] = useState('')
  const [friendInfo, setFriendInfo] = useState<string | null>(null)
  const [incoming, setIncoming] = useState<FriendRequest[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ conv: ConvWithLabel; x: number; y: number } | null>(null)

  const [accountView, setAccountView] = useState<AccountView>('root')
  const [usernameDraft, setUsernameDraft] = useState('')
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [statusDraft, setStatusDraft] = useState('')
  const [accountSaving, setAccountSaving] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<BlockedUser[]>([])
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  async function loadConversations() {
    if (!me) {
      setConversations([])
      return
    }
    const { data: memberRows } = await supabase
      .from('conversation_members')
      .select('conversation:conversations(*), is_favorite, favorited_at')
      .eq('user_id', me.id)

    const myRows = memberRows || []
    const convs = myRows
      .map((row) => row.conversation as unknown as Conversation)
      .filter(Boolean)

    if (convs.length === 0) {
      setConversations([])
      return
    }

    const ids = convs.map((c) => c.id)
    const { data: allMembers } = await supabase
      .from('conversation_members')
      .select('conversation_id, profile:profiles(id, username, display_name, avatar_url)')
      .in('conversation_id', ids)

    const labeled: ConvWithLabel[] = convs
      .map((c) => {
        const mine = myRows.find((r) => (r.conversation as unknown as Conversation)?.id === c.id)
        const isFavorite = !!mine?.is_favorite
        const favoritedAt = (mine?.favorited_at as string | null) || null
        if (c.type === 'group') return { ...c, label: c.name || 'grupo', avatarUrl: null, otherId: null, isFavorite, favoritedAt }
        const other = (allMembers || []).find(
          (m) => m.conversation_id === c.id && (m.profile as unknown as Profile)?.id !== me.id,
        )
        const p = other?.profile as unknown as Profile | undefined
        return { ...c, label: p ? displayName(p) : 'conversa', avatarUrl: p?.avatar_url || null, otherId: p?.id || null, isFavorite, favoritedAt }
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

    setConversations(labeled)
  }

  async function loadIncomingRequests() {
    if (!me) {
      setIncoming([])
      return
    }
    const { data } = await supabase
      .from('friend_requests')
      .select('id, from_id, from_profile:profiles!friend_requests_from_id_fkey(id, username, email)')
      .eq('to_id', me.id)
      .eq('status', 'pending')
    setIncoming((data as unknown as FriendRequest[]) || [])
  }

  async function loadOutgoingRequests() {
    if (!me) {
      setOutgoing([])
      return
    }
    const { data } = await supabase
      .from('friend_requests')
      .select('id, to_id, status, to_profile:profiles!friend_requests_to_id_fkey(id, username, email)')
      .eq('from_id', me.id)
      .neq('status', 'accepted')
    setOutgoing((data as unknown as OutgoingRequest[]) || [])
  }

  useEffect(() => {
    loadConversations()
    loadIncomingRequests()
    loadOutgoingRequests()
    if (!me) return
    const channel = supabase
      .channel(`member-updates:${me.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${me.id}` },
        () => loadConversations(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests', filter: `to_id=eq.${me.id}` },
        () => loadIncomingRequests(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests', filter: `from_id=eq.${me.id}` },
        () => loadOutgoingRequests(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [me?.id])

  function closePanel() {
    onPanelOpenChange(false)
    onPanelViewChange('root')
    setError(null)
    setInviteSent(false)
  }

  async function startDm() {
    if (!me) return
    setError(null)
    setBusy(true)
    setInviteSent(false)
    try {
      const email = dmEmail.trim().toLowerCase()
      if (!email) return
      if (email === me.email) throw new Error('Esse é você')

      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({ type: 'dm', created_by: me.id })
        .select()
        .single()
      if (convErr) throw convErr

      const { error: selfErr } = await supabase
        .from('conversation_members')
        .insert({ conversation_id: conv.id, user_id: me.id })
      if (selfErr) throw selfErr

      const { data: found, error: findErr } = await supabase.rpc('find_profile_by_email', { p_email: email })
      if (findErr) throw findErr
      const target = found?.[0]

      if (target) {
        const { error: memberErr } = await supabase
          .from('conversation_members')
          .insert({ conversation_id: conv.id, user_id: target.id })
        if (memberErr) throw memberErr
      } else {
        const { data: sessionData } = await supabase.auth.getSession()
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-by-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionData.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email, conversationId: conv.id }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Falha ao convidar')
        setInviteSent(true)
      }

      setDmEmail('')
      await loadConversations()
      onSelect(conv as Conversation)
      closePanel()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function joinByCode() {
    if (!me) return
    setError(null)
    setBusy(true)
    try {
      const code = joinCode.trim()
      if (!code) return

      const { data: invite, error: inviteErr } = await supabase
        .from('invites')
        .select('*')
        .eq('code', code)
        .maybeSingle()
      if (inviteErr) throw inviteErr
      if (!invite) throw new Error('Convite inválido')
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        throw new Error('Convite expirado')
      }

      const { error: memberErr } = await supabase
        .from('conversation_members')
        .insert({ conversation_id: invite.conversation_id, user_id: me.id })
      if (memberErr && !memberErr.message.includes('duplicate')) throw memberErr

      setJoinCode('')
      await loadConversations()
      closePanel()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function sendFriendRequest() {
    if (!me) return
    setError(null)
    setFriendInfo(null)
    setBusy(true)
    try {
      const email = friendEmail.trim().toLowerCase()
      if (!email) return
      if (email === me.email) throw new Error('Esse é você')

      const { data: found, error: findErr } = await supabase.rpc('find_profile_by_email', { p_email: email })
      if (findErr) throw findErr
      const target = found?.[0]
      if (!target) {
        setFriendInfo('Essa pessoa ainda não tem conta — use "Novo contato" pra convidar por email')
        return
      }

      const { error: reqErr } = await supabase
        .from('friend_requests')
        .insert({ from_id: me.id, to_id: target.id })

      if (reqErr) {
        if (!reqErr.message.includes('duplicate')) throw reqErr
        const { error: retryErr } = await supabase
          .from('friend_requests')
          .update({ status: 'pending' })
          .eq('from_id', me.id)
          .eq('to_id', target.id)
        if (retryErr) throw retryErr
      }

      setFriendEmail('')
      setFriendInfo('Solicitação enviada')
      await loadOutgoingRequests()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function retryRequest(req: OutgoingRequest) {
    setBusy(true)
    try {
      await supabase.from('friend_requests').update({ status: 'pending' }).eq('id', req.id)
      await loadOutgoingRequests()
    } finally {
      setBusy(false)
    }
  }

  async function blockUser(req: FriendRequest) {
    if (!me) return
    setBusy(true)
    try {
      await supabase.from('blocks').insert({ blocker_id: me.id, blocked_id: req.from_id })
      await supabase.from('friend_requests').update({ status: 'declined' }).eq('id', req.id)
      setOpenMenuId(null)
      await loadIncomingRequests()
    } finally {
      setBusy(false)
    }
  }

  async function acceptRequest(req: FriendRequest) {
    if (!me) return
    setError(null)
    setBusy(true)
    try {
      const { error: updateErr } = await supabase
        .from('friend_requests')
        .update({ status: 'accepted' })
        .eq('id', req.id)
      if (updateErr) throw updateErr

      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({ type: 'dm', created_by: me.id })
        .select()
        .single()
      if (convErr) throw convErr

      const { error: membersErr } = await supabase
        .from('conversation_members')
        .insert([
          { conversation_id: conv.id, user_id: me.id },
          { conversation_id: conv.id, user_id: req.from_id },
        ])
      if (membersErr) throw membersErr

      await loadIncomingRequests()
      await loadConversations()
      onSelect(conv as Conversation)
      closePanel()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function declineRequest(req: FriendRequest) {
    setBusy(true)
    try {
      await supabase.from('friend_requests').update({ status: 'declined' }).eq('id', req.id)
      await loadIncomingRequests()
    } finally {
      setBusy(false)
    }
  }

  async function leaveConversation(conv: ConvWithLabel) {
    if (!me) return
    await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conv.id)
      .eq('user_id', me.id)
    setConversations((prev) => prev.filter((c) => c.id !== conv.id))
    if (selected?.id === conv.id) onSelect(null)
    setContextMenu(null)
  }

  function handleContextMenu(e: React.MouseEvent, conv: ConvWithLabel) {
    e.preventDefault()
    setContextMenu({ conv, x: e.clientX, y: e.clientY })
  }

  function goBack() {
    if (panelView === 'root') closePanel()
    else {
      onPanelViewChange('root')
      setError(null)
    }
  }

  useEffect(() => {
    if (accountOpen && me) {
      setUsernameDraft(me.username)
      setDisplayNameDraft(me.display_name || '')
      setStatusDraft(me.status || '')
      setAccountView('root')
      setAccountError(null)
    }
  }, [accountOpen, me?.id])

  async function loadMyGroups() {
    if (!me) return
    const { data } = await supabase
      .from('conversation_members')
      .select('role, conversation:conversations(id, name)')
      .eq('user_id', me.id)
      .not('role', 'is', null)
    setMyGroups(
      (data || []).map((row) => {
        const c = row.conversation as unknown as Conversation
        return { id: c.id, name: c.name || 'grupo', role: row.role as string | null }
      }),
    )
  }

  useEffect(() => {
    if (groupsOpen && me) {
      setGroupsView('root')
      setGroupsError(null)
      setNewGroupName('')
      setNewGroupDesc('')
      loadMyGroups()
    }
  }, [groupsOpen, me?.id])

  async function createGroup2() {
    if (!me) return
    const name = newGroupName.trim()
    if (!name) return
    setGroupsBusy(true)
    setGroupsError(null)
    try {
      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({ type: 'group', name, description: newGroupDesc.trim() || null, created_by: me.id })
        .select()
        .single()
      if (convErr) throw convErr

      const { error: memberErr } = await supabase
        .from('conversation_members')
        .insert({ conversation_id: conv.id, user_id: me.id, role: 'admin' })
      if (memberErr) throw memberErr

      onGroupsOpenChange(false)
      await loadConversations()
      onSelect(conv as Conversation)
    } catch (err) {
      setGroupsError(getErrorMessage(err))
    } finally {
      setGroupsBusy(false)
    }
  }

  async function saveUsername() {
    if (!me) return
    const username = usernameDraft.trim()
    if (!username || username === me.username) return
    setAccountSaving(true)
    setAccountError(null)
    const { error: err } = await supabase.from('profiles').update({ username }).eq('id', me.id)
    if (err) setAccountError(err.message.includes('duplicate') ? 'Esse nome já está em uso' : getErrorMessage(err))
    else onProfileChange({ username })
    setAccountSaving(false)
  }

  async function saveDisplayName() {
    if (!me) return
    setAccountSaving(true)
    const display_name = displayNameDraft.trim()
    await supabase.from('profiles').update({ display_name }).eq('id', me.id)
    onProfileChange({ display_name })
    setAccountSaving(false)
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !me) return
    setAvatarUploading(true)
    setAccountError(null)
    try {
      const path = `${me.id}/avatar`
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, cacheControl: '3600' })
      if (uploadErr) throw uploadErr

      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const avatar_url = `${data.publicUrl}?t=${Date.now()}`

      const { error: updateErr } = await supabase.from('profiles').update({ avatar_url }).eq('id', me.id)
      if (updateErr) throw updateErr

      onProfileChange({ avatar_url })
    } catch (err) {
      setAccountError(getErrorMessage(err))
    } finally {
      setAvatarUploading(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  async function saveStatus() {
    if (!me) return
    setAccountSaving(true)
    const status = statusDraft.trim()
    await supabase.from('profiles').update({ status }).eq('id', me.id)
    onProfileChange({ status })
    setAccountSaving(false)
  }

  async function openBlocked() {
    if (!me) return
    setAccountView('blocked')
    const { data } = await supabase
      .from('blocks')
      .select('blocked:profiles!blocks_blocked_id_fkey(id, username, email)')
      .eq('blocker_id', me.id)
    setBlocked(((data as unknown as { blocked: BlockedUser }[]) || []).map((r) => r.blocked))
  }

  async function unblock(id: string) {
    if (!me) return
    await supabase.from('blocks').delete().eq('blocker_id', me.id).eq('blocked_id', id)
    setBlocked((prev) => prev.filter((b) => b.id !== id))
    onAccountOpenChange(false)
  }

  function accountGoBack() {
    if (accountView === 'blocked' || accountView === 'terms') setAccountView('privacy')
    else if (accountView === 'root') onAccountOpenChange(false)
    else setAccountView('root')
  }

  const accountTitle =
    accountView === 'root'
      ? (me ? displayName(me) : '')
      : accountView === 'profile'
        ? 'Perfil'
        : accountView === 'account'
          ? 'Conta'
          : accountView === 'privacy'
            ? 'Privacidade'
            : accountView === 'terms'
              ? 'Termo de uso'
              : 'Bloqueados'

  async function toggleFavorite(c: ConvWithLabel) {
    if (!me) return
    const next = !c.isFavorite
    const favoritedAt = next ? new Date().toISOString() : null
    await supabase
      .from('conversation_members')
      .update({ is_favorite: next, favorited_at: favoritedAt })
      .eq('conversation_id', c.id)
      .eq('user_id', me.id)
    setConversations((prev) =>
      prev.map((conv) => (conv.id === c.id ? { ...conv, isFavorite: next, favoritedAt } : conv)),
    )
  }

  const filtered = conversations
    .filter((c) => !(c.otherId && blockedIds.has(c.otherId)))
    .filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    .filter((c) => activeFilter === 'all' || c.isFavorite)
    .sort((a, b) => {
      if (activeFilter !== 'favorites') return 0
      return (a.favoritedAt || '').localeCompare(b.favoritedAt || '')
    })

  const panelTitle =
    panelView === 'root'
      ? 'Nova conversa'
      : panelView === 'contact'
        ? 'Novo contato'
        : panelView === 'group'
          ? 'Novo grupo'
          : panelView === 'friends'
            ? 'Amizades'
            : 'Entrar com código'

  return (
    <section className="chats">
      <div className="top">
        <div className="brand">Ferus</div>
      </div>

      <div className="search-wrap">
        <div className="search">
          <span><IconSearch size={18} /></span>
          <input
            placeholder="Pesquisar conversas"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="filters">
        <button className={`filter${activeFilter === 'all' ? ' active' : ''}`} onClick={() => setActiveFilter('all')}>Todos</button>
        <button className={`filter${activeFilter === 'favorites' ? ' active' : ''}`} onClick={() => setActiveFilter('favorites')}>Favoritos</button>
      </div>

      <div className="chat-list">
        {!me && <div className="empty">Entre para ver suas conversas</div>}
        {me && filtered.length === 0 && <div className="empty">Nenhuma conversa ainda</div>}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`chat${selected?.id === c.id ? ' selected' : ''}`}
            onClick={() => onSelect(c)}
            onContextMenu={(e) => handleContextMenu(e, c)}
          >
            <div className="photo">
              {c.avatarUrl ? <img src={c.avatarUrl} alt="" /> : c.label[0]?.toUpperCase()}
            </div>
            <button
              type="button"
              className={`favorite-star${c.isFavorite ? ' filled' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleFavorite(c) }}
              title={c.isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            >
              <IconStar size={16} />
            </button>
            <div className="chat-info">
              <div className="row">
                <div className="name">{c.type === 'group' ? `# ${c.label}` : `@${c.label}`}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }}>
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button"><IconArchive size={16} /> Arquivar conversa</button>
            {contextMenu.conv.type === 'group' ? (
              <button type="button"><IconBellOff size={16} /> Silenciar notificações</button>
            ) : (
              <button type="button"><IconPinOff size={16} /> Desafixar conversa</button>
            )}
            <button type="button"><IconMailUnread size={16} /> Marcar como não lida</button>
            <button type="button"><IconHeart size={16} /> Adicionar aos Favoritos</button>
            <button type="button"><IconListPlus size={16} /> Adicionar à lista</button>
            <button type="button"><IconMinusCircle size={16} /> Limpar conversa</button>
            {contextMenu.conv.type === 'group' ? (
              <button type="button" className="danger" onClick={() => leaveConversation(contextMenu.conv)}>
                <IconLogout size={16} /> Sair do grupo
              </button>
            ) : (
              <button type="button" className="danger" onClick={() => leaveConversation(contextMenu.conv)}>
                <IconTrash size={16} /> Apagar conversa
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`new-conv-panel${panelOpen ? ' open' : ''}`}>
        <div className="new-conv-header">
          <button type="button" className="icon-btn" onClick={goBack}><IconArrowLeft size={20} /></button>
          <div className="brand" style={{ fontSize: 18 }}>{panelTitle}</div>
        </div>

        {panelView === 'root' && (
          <div className="new-conv-list">
            <div className="new-conv-option" onClick={() => onPanelViewChange('contact')}>
              <div className="option-icon"><IconUser size={20} /></div>
              <span>Novo contato</span>
            </div>
            <div className="new-conv-option" onClick={() => onPanelViewChange('join')}>
              <div className="option-icon"><IconHash size={20} /></div>
              <span>Entrar com código</span>
            </div>
            <div className="new-conv-option" onClick={() => onPanelViewChange('friends')}>
              <div className="option-icon"><IconHeart size={20} /></div>
              <span>Solicitação de amizade{incoming.length > 0 ? ` (${incoming.length})` : ''}</span>
            </div>
          </div>
        )}

        {panelView === 'friends' && (
          <div className="new-conv-form">
            <label>Adicionar por email</label>
            <input
              type="email"
              placeholder="email@exemplo.com"
              value={friendEmail}
              onChange={(e) => setFriendEmail(e.target.value)}
              autoFocus
            />
            <button type="button" disabled={busy} onClick={sendFriendRequest}>Enviar solicitação</button>
            {friendInfo && <span className="invite-code">{friendInfo}</span>}
            {error && <span className="auth-error">{error}</span>}

            <label style={{ marginTop: 10 }}>Recebidas</label>
            <div className="friend-request-list">
              {incoming.length === 0 && <span className="invite-code">nenhuma solicitação pendente</span>}
              {incoming.map((req) => (
                <div key={req.id} className="friend-request-row">
                  <div className="photo" style={{ width: 40, height: 40 }}>
                    {req.from_profile.username[0]?.toUpperCase()}
                  </div>
                  <div className="friend-request-info">
                    <div className="name">@{req.from_profile.username}</div>
                    <div className="preview">{req.from_profile.email}</div>
                  </div>
                  <button type="button" disabled={busy} onClick={() => acceptRequest(req)}>Aceitar</button>
                  <button type="button" disabled={busy} className="decline" onClick={() => declineRequest(req)}>Recusar</button>
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 28, height: 28 }}
                      onClick={() => setOpenMenuId(openMenuId === req.id ? null : req.id)}
                    >
                      <IconMore size={16} />
                    </button>
                    {openMenuId === req.id && (
                      <div className="request-menu">
                        <button type="button" disabled={busy} onClick={() => blockUser(req)}>Bloquear</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <label style={{ marginTop: 10 }}>Enviadas</label>
            <div className="friend-request-list">
              {outgoing.length === 0 && <span className="invite-code">nenhuma solicitação enviada</span>}
              {outgoing.map((req) => (
                <div key={req.id} className="friend-request-row">
                  <div className="photo" style={{ width: 40, height: 40 }}>
                    {req.to_profile.username[0]?.toUpperCase()}
                  </div>
                  <div className="friend-request-info">
                    <div className="name">@{req.to_profile.username}</div>
                    <div className="preview">{req.status === 'declined' ? 'pedido recusado' : 'aguardando resposta'}</div>
                  </div>
                  {req.status === 'declined' && (
                    <button type="button" disabled={busy} onClick={() => retryRequest(req)}>Tentar de novo</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {panelView === 'contact' && (
          <div className="new-conv-form">
            <label>Email da pessoa</label>
            <input
              type="email"
              placeholder="email@exemplo.com"
              value={dmEmail}
              onChange={(e) => setDmEmail(e.target.value)}
              autoFocus
            />
            <button type="button" disabled={busy} onClick={startDm}>Chamar</button>
            {inviteSent && (
              <span className="invite-code">
                essa pessoa ainda não tem conta — mandamos um convite por email
              </span>
            )}
            {error && <span className="auth-error">{error}</span>}
          </div>
        )}

        {panelView === 'join' && (
          <div className="new-conv-form">
            <label>Código de convite</label>
            <input
              placeholder="código"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              autoFocus
            />
            <button type="button" disabled={busy} onClick={joinByCode}>Entrar</button>
            {error && <span className="auth-error">{error}</span>}
          </div>
        )}
      </div>

      <div className={`new-conv-panel${accountOpen ? ' open' : ''}`}>
        <div className="new-conv-header">
          <button type="button" className="icon-btn" onClick={accountGoBack}><IconArrowLeft size={20} /></button>
          <div className="brand" style={{ fontSize: 18 }}>{accountTitle}</div>
        </div>

        {accountView === 'root' && me && (
          <>
            <div className="account-status-wrap" onClick={() => setAccountView('profile')}>
              <span className="account-status-bubble">{me.status || "What's happening?"}</span>
            </div>
            <div className="account-avatar-wrap">
              <div className="account-avatar" style={{ overflow: 'hidden' }}>
                {me.avatar_url ? <img src={me.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <IconUser size={40} />}
              </div>
            </div>
            <div className="new-conv-list">
              <div className="new-conv-option" onClick={() => setAccountView('profile')}>
                <div className="option-icon"><IconUser size={20} /></div>
                <div>
                  <div>Perfil</div>
                  <div className="option-subtitle">Nome, foto do perfil, nome de usuário</div>
                </div>
              </div>
              <div className="new-conv-option" onClick={() => setAccountView('account')}>
                <div className="option-icon"><IconKey size={20} /></div>
                <div>
                  <div>Conta</div>
                  <div className="option-subtitle">Notificações de segurança, dados da conta</div>
                </div>
              </div>
              <div className="new-conv-option" onClick={() => setAccountView('privacy')}>
                <div className="option-icon"><IconLock size={20} /></div>
                <div>
                  <div>Privacidade</div>
                  <div className="option-subtitle">Contatos bloqueados, mensagens temporárias</div>
                </div>
              </div>
            </div>
          </>
        )}

        {accountView === 'profile' && me && (
          <div className="new-conv-form">
            <div className="account-avatar-wrap">
              <div className="account-avatar" onClick={() => avatarInputRef.current?.click()} style={{ cursor: 'pointer', overflow: 'hidden' }}>
                {me.avatar_url ? <img src={me.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <IconUser size={40} />}
              </div>
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={uploadAvatar} />
            <button type="button" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()}>
              {avatarUploading ? 'enviando...' : 'Trocar foto'}
            </button>

            <label style={{ marginTop: 10 }}>Nome</label>
            <input
              placeholder="seu nome de exibição"
              value={displayNameDraft}
              onChange={(e) => setDisplayNameDraft(e.target.value)}
            />
            <button type="button" disabled={accountSaving} onClick={saveDisplayName}>Salvar nome</button>

            <label style={{ marginTop: 10 }}>Nome de usuário</label>
            <input
              value={usernameDraft}
              onChange={(e) => setUsernameDraft(e.target.value)}
            />
            <button type="button" disabled={accountSaving} onClick={saveUsername}>Salvar usuário</button>

            <label style={{ marginTop: 10 }}>Status</label>
            <input
              placeholder="What's happening?"
              value={statusDraft}
              onChange={(e) => setStatusDraft(e.target.value)}
            />
            <button type="button" disabled={accountSaving} onClick={saveStatus}>Salvar status</button>
            {accountError && <span className="auth-error">{accountError}</span>}
          </div>
        )}

        {accountView === 'account' && me && (
          <div className="new-conv-form">
            <label>Email</label>
            <input value={me.email} disabled />
            <span className="invite-code">notificações de segurança e mais dados da conta chegam em breve</span>
          </div>
        )}

        {accountView === 'privacy' && (
          <div className="new-conv-list">
            <div className="new-conv-option" onClick={openBlocked}>
              <div className="option-icon"><IconLock size={20} /></div>
              <span>Contatos bloqueados</span>
            </div>
            <div className="new-conv-option">
              <div className="option-icon"><IconLock size={20} /></div>
              <span>Mensagens temporárias (em breve)</span>
            </div>
            <div className="new-conv-option" onClick={() => setAccountView('terms')}>
              <div className="option-icon"><IconKey size={20} /></div>
              <span>Termo de uso</span>
            </div>
          </div>
        )}

        {accountView === 'terms' && (
          <div className="new-conv-form terms-text">
            <p>
              O Ferus é fornecido "como está". Não nos responsabilizamos por uso indevido do
              app por parte dos usuários, incluindo o conteúdo das mensagens trocadas.
            </p>
            <p>
              Imagens e vídeos transmitidos ao vivo não são salvos no nosso banco de dados —
              existem apenas enquanto estão sendo compartilhados em tempo real.
            </p>
            <p>
              O texto das mensagens enviadas fica salvo no banco de dados junto com o
              remetente, por tempo indeterminado.
            </p>
            <p>
              Quebra de sigilo dessas informações só ocorre mediante requisição jurídica
              (ordem judicial ou solicitação de autoridade competente).
            </p>
          </div>
        )}

        {accountView === 'blocked' && (
          <div className="new-conv-form">
            {blocked.length === 0 && <span className="invite-code">ninguém bloqueado</span>}
            <div className="friend-request-list">
              {blocked.map((b) => (
                <div key={b.id} className="friend-request-row">
                  <div className="photo" style={{ width: 40, height: 40 }}>{b.username[0]?.toUpperCase()}</div>
                  <div className="friend-request-info">
                    <div className="name">@{b.username}</div>
                    <div className="preview">{b.email}</div>
                  </div>
                  <button type="button" onClick={() => unblock(b.id)}>Desbloquear</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {me && (
          <button type="button" className="account-signout" onClick={() => supabase.auth.signOut()}>Sair</button>
        )}
      </div>

      <div className={`new-conv-panel${groupsOpen ? ' open' : ''}`}>
        <div className="new-conv-header">
          <button
            type="button"
            className="icon-btn"
            onClick={() => (groupsView === 'create' ? setGroupsView('root') : onGroupsOpenChange(false))}
          >
            <IconArrowLeft size={20} />
          </button>
          <div className="brand" style={{ fontSize: 18 }}>Ferus - Grupos</div>
        </div>

        {groupsView === 'root' && (
          <>
            <div className="new-conv-list">
              <div className="new-conv-option" onClick={() => setGroupsView('create')}>
                <div className="option-icon"><IconGroup size={20} /></div>
                <span>Criar grupo</span>
              </div>
              <div className="new-conv-option" style={{ opacity: 0.5, cursor: 'default' }}>
                <div className="option-icon"><IconHeart size={20} /></div>
                <span>Criar comunidade (em breve)</span>
              </div>
            </div>
            <label style={{ padding: '0 22px', fontSize: '.7rem', color: '#8696a0', textTransform: 'uppercase' }}>
              Meus grupos
            </label>
            <div className="chat-list">
              {myGroups.length === 0 && <div className="empty">Nenhum grupo ainda</div>}
              {myGroups.map((g) => (
                <div
                  key={g.id}
                  className="chat"
                  onClick={() => {
                    onSelect({ id: g.id, type: 'group', name: g.name, created_by: '', created_at: '' } as Conversation)
                    onGroupsOpenChange(false)
                  }}
                >
                  <div className="photo">{g.name[0]?.toUpperCase()}</div>
                  <div className="chat-info">
                    <div className="row">
                      <div className="name"># {g.name}{g.role === 'admin' ? ' (adm)' : g.role === 'moderator' ? ' (mod)' : ''}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {groupsView === 'create' && (
          <div className="new-conv-form">
            <label>Nome do grupo</label>
            <input
              placeholder="nome do grupo"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              autoFocus
            />
            <label style={{ marginTop: 10 }}>Descrição</label>
            <input
              placeholder="descrição (opcional)"
              value={newGroupDesc}
              onChange={(e) => setNewGroupDesc(e.target.value)}
            />
            <button type="button" disabled={groupsBusy} onClick={createGroup2}>Criar</button>
            {groupsError && <span className="auth-error">{groupsError}</span>}
          </div>
        )}
      </div>
    </section>
  )
}
