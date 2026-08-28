import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Conversation, Profile } from '../types'

type Props = {
  me: Profile
  onOpen: (conversation: Conversation) => void
}

export function Conversations({ me, onOpen }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dmUsername, setDmUsername] = useState('')
  const [groupName, setGroupName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [lastInvite, setLastInvite] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadConversations() {
    const { data, error: err } = await supabase
      .from('conversation_members')
      .select('conversation:conversations(*)')
      .eq('user_id', me.id)
    if (err) {
      setError(err.message)
      return
    }
    const list = (data || [])
      .map((row) => row.conversation as unknown as Conversation)
      .filter(Boolean)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    setConversations(list)
  }

  useEffect(() => {
    loadConversations()
  }, [me.id])

  async function startDm() {
    setError(null)
    setBusy(true)
    try {
      const uname = dmUsername.trim()
      if (!uname) return
      const { data: target, error: findErr } = await supabase
        .from('profiles')
        .select('id, username')
        .eq('username', uname)
        .maybeSingle()
      if (findErr) throw findErr
      if (!target) throw new Error('Usuário não encontrado')
      if (target.id === me.id) throw new Error('Esse é você')

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
          { conversation_id: conv.id, user_id: target.id },
        ])
      if (membersErr) throw membersErr

      setDmUsername('')
      await loadConversations()
      onOpen(conv as Conversation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    } finally {
      setBusy(false)
    }
  }

  async function createGroup() {
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
      onOpen(conv as Conversation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    } finally {
      setBusy(false)
    }
  }

  async function joinByCode() {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="conversations-screen">
      <header className="conversations-header">
        <h1>ChatVivo</h1>
        <span>{me.username}</span>
        <button type="button" onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>

      {error && <p className="auth-error">{error}</p>}

      <ul className="conversation-list">
        {conversations.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onOpen(c)}>
              {c.type === 'group' ? `# ${c.name}` : 'conversa direta'}
            </button>
          </li>
        ))}
        {conversations.length === 0 && <li className="empty">Nenhuma conversa ainda</li>}
      </ul>

      <div className="conversation-actions">
        <div className="action-row">
          <input
            placeholder="username pra chamar em DM"
            value={dmUsername}
            onChange={(e) => setDmUsername(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={startDm}>Chamar</button>
        </div>

        <div className="action-row">
          <input
            placeholder="nome do novo grupo"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={createGroup}>Criar grupo</button>
        </div>

        <div className="action-row">
          <input
            placeholder="código de convite"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={joinByCode}>Entrar</button>
        </div>

        {lastInvite && (
          <p className="invite-code">Código do grupo: <strong>{lastInvite}</strong></p>
        )}
      </div>
    </div>
  )
}
