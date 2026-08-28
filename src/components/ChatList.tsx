import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errors'
import type { Conversation, PanelView, Profile } from '../types'

type Props = {
  me: Profile | null
  selected: Conversation | null
  onSelect: (c: Conversation) => void
  panelOpen: boolean
  panelView: PanelView
  onPanelOpenChange: (open: boolean) => void
  onPanelViewChange: (view: PanelView) => void
}

type ConvWithLabel = Conversation & { label: string }
type FriendRequest = {
  id: string
  from_id: string
  from_profile: { id: string; username: string; email: string }
}

export function ChatList({
  me,
  selected,
  onSelect,
  panelOpen,
  panelView,
  onPanelOpenChange,
  onPanelViewChange,
}: Props) {
  const [conversations, setConversations] = useState<ConvWithLabel[]>([])
  const [query, setQuery] = useState('')
  const [dmEmail, setDmEmail] = useState('')
  const [groupName, setGroupName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [lastInvite, setLastInvite] = useState<string | null>(null)
  const [inviteSent, setInviteSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [friendEmail, setFriendEmail] = useState('')
  const [friendInfo, setFriendInfo] = useState<string | null>(null)
  const [incoming, setIncoming] = useState<FriendRequest[]>([])

  async function loadConversations() {
    if (!me) {
      setConversations([])
      return
    }
    const { data: memberRows } = await supabase
      .from('conversation_members')
      .select('conversation:conversations(*)')
      .eq('user_id', me.id)

    const convs = (memberRows || [])
      .map((row) => row.conversation as unknown as Conversation)
      .filter(Boolean)

    if (convs.length === 0) {
      setConversations([])
      return
    }

    const ids = convs.map((c) => c.id)
    const { data: allMembers } = await supabase
      .from('conversation_members')
      .select('conversation_id, profile:profiles(id, username)')
      .in('conversation_id', ids)

    const labeled: ConvWithLabel[] = convs
      .map((c) => {
        if (c.type === 'group') return { ...c, label: c.name || 'grupo' }
        const other = (allMembers || []).find(
          (m) => m.conversation_id === c.id && (m.profile as unknown as Profile)?.id !== me.id,
        )
        const p = other?.profile as unknown as Profile | undefined
        return { ...c, label: p?.username || 'conversa' }
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

  useEffect(() => {
    loadConversations()
    loadIncomingRequests()
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
        { event: 'INSERT', schema: 'public', table: 'friend_requests', filter: `to_id=eq.${me.id}` },
        () => loadIncomingRequests(),
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

  async function createGroup() {
    if (!me) return
    setError(null)
    setBusy(true)
    try {
      const name = groupName.trim()
      if (!name) return

      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({ type: 'group', name, created_by: me.id })
        .select()
        .single()
      if (convErr) throw convErr

      const { error: memberErr } = await supabase
        .from('conversation_members')
        .insert({ conversation_id: conv.id, user_id: me.id })
      if (memberErr) throw memberErr

      const { data: invite, error: inviteErr } = await supabase
        .from('invites')
        .insert({ conversation_id: conv.id, created_by: me.id })
        .select()
        .single()
      if (inviteErr) throw inviteErr

      setLastInvite(invite.code)
      setGroupName('')
      await loadConversations()
      onSelect(conv as Conversation)
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
      if (reqErr && !reqErr.message.includes('duplicate')) throw reqErr

      setFriendEmail('')
      setFriendInfo('Solicitação enviada')
    } catch (err) {
      setError(getErrorMessage(err))
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

  function goBack() {
    if (panelView === 'root') closePanel()
    else {
      onPanelViewChange('root')
      setError(null)
    }
  }

  const filtered = conversations.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))

  const panelTitle =
    panelView === 'root'
      ? 'Nova conversa'
      : panelView === 'contact'
        ? 'Novo contato'
        : panelView === 'group'
          ? 'Novo grupo'
          : panelView === 'friends'
            ? 'Solicitação de amizade'
            : 'Entrar com código'

  return (
    <section className="chats">
      <div className="top">
        <div className="brand">ChatVivo</div>
      </div>

      <div className="search-wrap">
        <div className="search">
          <span>🔍</span>
          <input
            placeholder="Pesquisar conversas"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="filters">
        <button className="filter active">Todas</button>
        <button className="filter">Grupos</button>
      </div>

      <div className="chat-list">
        {!me && <div className="empty">Entre para ver suas conversas</div>}
        {me && filtered.length === 0 && <div className="empty">Nenhuma conversa ainda</div>}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`chat${selected?.id === c.id ? ' selected' : ''}`}
            onClick={() => onSelect(c)}
          >
            <div className="photo">{c.label[0]?.toUpperCase()}</div>
            <div className="chat-info">
              <div className="row">
                <div className="name">{c.type === 'group' ? `# ${c.label}` : c.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={`new-conv-panel${panelOpen ? ' open' : ''}`}>
        <div className="new-conv-header">
          <button type="button" className="icon-btn" onClick={goBack}>←</button>
          <div className="brand" style={{ fontSize: 18 }}>{panelTitle}</div>
        </div>

        {panelView === 'root' && (
          <div className="new-conv-list">
            <div className="new-conv-option" onClick={() => onPanelViewChange('group')}>
              <div className="option-icon">＋</div>
              <span>Novo grupo</span>
            </div>
            <div className="new-conv-option" onClick={() => onPanelViewChange('contact')}>
              <div className="option-icon">☺</div>
              <span>Novo contato</span>
            </div>
            <div className="new-conv-option" onClick={() => onPanelViewChange('join')}>
              <div className="option-icon">#</div>
              <span>Entrar com código</span>
            </div>
            <div className="new-conv-option" onClick={() => onPanelViewChange('friends')}>
              <div className="option-icon">♥</div>
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
                    <div className="name">{req.from_profile.username}</div>
                    <div className="preview">{req.from_profile.email}</div>
                  </div>
                  <button type="button" disabled={busy} onClick={() => acceptRequest(req)}>Aceitar</button>
                  <button type="button" disabled={busy} className="decline" onClick={() => declineRequest(req)}>Recusar</button>
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

        {panelView === 'group' && (
          <div className="new-conv-form">
            <label>Nome do grupo</label>
            <input
              placeholder="nome do grupo"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              autoFocus
            />
            <button type="button" disabled={busy} onClick={createGroup}>Criar</button>
            {lastInvite && <span className="invite-code">código: <strong>{lastInvite}</strong></span>}
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
    </section>
  )
}
