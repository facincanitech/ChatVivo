import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errors'
import type { Conversation, Profile } from '../types'

type Props = {
  me: Profile | null
  selected: Conversation | null
  onSelect: (c: Conversation) => void
  requireAuth: (action: () => void) => void
}

type ConvWithLabel = Conversation & { label: string }

export function ChatList({ me, selected, onSelect, requireAuth }: Props) {
  const [conversations, setConversations] = useState<ConvWithLabel[]>([])
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [dmEmail, setDmEmail] = useState('')
  const [groupName, setGroupName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [lastInvite, setLastInvite] = useState<string | null>(null)
  const [inviteSent, setInviteSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  useEffect(() => {
    loadConversations()
    if (!me) return
    const channel = supabase
      .channel(`member-updates:${me.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${me.id}` },
        () => loadConversations(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [me?.id])

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
      setMenuOpen(false)
      await loadConversations()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function handleNewClick() {
    requireAuth(() => setMenuOpen((v) => !v))
  }

  const filtered = conversations.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))

  return (
    <section className="chats">
      <div className="top">
        <div className="brand">ChatVivo</div>
        <div className="top-actions">
          <button className="icon-btn" title="Nova conversa" onClick={handleNewClick}>＋</button>
        </div>
      </div>

      <div className="search-wrap">
        <div className="search">
          <span>⌕</span>
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

      {menuOpen && (
        <div className="new-conv-menu">
          <label>Chamar em DM (email)</label>
          <input
            type="email"
            placeholder="email da pessoa"
            value={dmEmail}
            onChange={(e) => setDmEmail(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={startDm}>Chamar</button>
          {inviteSent && (
            <span className="invite-code">
              essa pessoa ainda não tem conta — mandamos um convite por email
            </span>
          )}

          <label>Criar grupo</label>
          <input
            placeholder="nome do grupo"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={createGroup}>Criar</button>
          {lastInvite && <span className="invite-code">código: <strong>{lastInvite}</strong></span>}

          <label>Entrar com código</label>
          <input
            placeholder="código de convite"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={joinByCode}>Entrar</button>

          {error && <span className="auth-error">{error}</span>}
        </div>
      )}
    </section>
  )
}
