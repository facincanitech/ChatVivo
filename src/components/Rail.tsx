import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errors'
import { IconChat, IconGroup, IconLock, IconPlus, IconStar, IconUser } from './icons'
import type { Profile } from '../types'

type Props = {
  me: Profile | null
  onRequireAuth: () => void
  onNewConversation: () => void
  onProfileChange: (patch: Partial<Profile>) => void
}

type BlockedUser = { id: string; username: string; email: string }

export function Rail({ me, onRequireAuth, onNewConversation, onProfileChange }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [usernameDraft, setUsernameDraft] = useState('')
  const [statusDraft, setStatusDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [showBlocked, setShowBlocked] = useState(false)
  const [blocked, setBlocked] = useState<BlockedUser[]>([])

  useEffect(() => {
    if (!me) {
      setPendingCount(0)
      return
    }

    async function load() {
      if (!me) return
      const { count } = await supabase
        .from('friend_requests')
        .select('id', { count: 'exact', head: true })
        .eq('to_id', me.id)
        .eq('status', 'pending')
      setPendingCount(count || 0)
    }

    load()

    const channel = supabase
      .channel(`pending-requests:${me.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests', filter: `to_id=eq.${me.id}` },
        () => load(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [me?.id])

  function handleAvatarClick() {
    if (!me) {
      onRequireAuth()
      return
    }
    setUsernameDraft(me.username)
    setStatusDraft(me.status || '')
    setError(null)
    setShowBlocked(false)
    setMenuOpen((v) => !v)
  }

  async function saveUsername() {
    if (!me) return
    const username = usernameDraft.trim()
    if (!username || username === me.username) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.from('profiles').update({ username }).eq('id', me.id)
    if (err) setError(err.message.includes('duplicate') ? 'Esse nome já está em uso' : getErrorMessage(err))
    else onProfileChange({ username })
    setSaving(false)
  }

  async function saveStatus() {
    if (!me) return
    setSaving(true)
    const status = statusDraft.trim()
    await supabase.from('profiles').update({ status }).eq('id', me.id)
    onProfileChange({ status })
    setSaving(false)
  }

  async function openBlocked() {
    if (!me) return
    setShowBlocked(true)
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
  }

  return (
    <aside className="rail">
      <div className="logo"><IconChat size={22} /></div>
      <div style={{ position: 'relative' }}>
        <button title="Nova conversa" onClick={onNewConversation}><IconPlus /></button>
        {pendingCount > 0 && (
          <span className="rail-badge" title={`${pendingCount} solicitação(ões) de amizade`}>
            <IconStar size={11} />
          </span>
        )}
      </div>
      <button title="Comunidades (em breve)"><IconGroup /></button>
      <button title="Status (em breve)"><IconStar /></button>
      <div className="spacer" />
      <div style={{ position: 'relative' }}>
        <div className="avatar-sm" onClick={handleAvatarClick} title={me ? `@${me.username} — conta` : 'Entrar'}>
          <IconUser size={18} />
        </div>
        {menuOpen && me && !showBlocked && (
          <div className="profile-menu">
            <div style={{ padding: '4px 10px', fontSize: '.8rem', color: '#8696a0' }}>@{me.username}</div>
            <div style={{ padding: '4px 10px', display: 'flex', gap: 6 }}>
              <input
                placeholder="nome de usuário"
                value={usernameDraft}
                onChange={(e) => setUsernameDraft(e.target.value)}
                style={{ flex: 1, minWidth: 0, background: '#111b21', border: '1px solid #34434b', borderRadius: 4, color: 'inherit', padding: '4px 6px', fontSize: '.75rem' }}
              />
              <button type="button" disabled={saving} onClick={saveUsername} style={{ fontSize: '.7rem' }}>ok</button>
            </div>
            <div style={{ padding: '4px 10px', display: 'flex', gap: 6 }}>
              <input
                placeholder="seu status..."
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value)}
                style={{ flex: 1, minWidth: 0, background: '#111b21', border: '1px solid #34434b', borderRadius: 4, color: 'inherit', padding: '4px 6px', fontSize: '.75rem' }}
              />
              <button type="button" disabled={saving} onClick={saveStatus} style={{ fontSize: '.7rem' }}>ok</button>
            </div>
            {error && <div style={{ padding: '2px 10px', color: '#f5b8ba', fontSize: '.7rem' }}>{error}</div>}
            <button type="button" onClick={openBlocked}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconLock size={14} /> Bloqueados</span>
            </button>
            <button type="button" onClick={() => supabase.auth.signOut()}>Sair</button>
          </div>
        )}
        {menuOpen && me && showBlocked && (
          <div className="profile-menu blocked-menu">
            <div style={{ padding: '4px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '.8rem', color: '#8696a0' }}>Bloqueados</span>
              <button type="button" onClick={() => setShowBlocked(false)} style={{ fontSize: '.7rem' }}>voltar</button>
            </div>
            {blocked.length === 0 && (
              <div style={{ padding: '4px 10px', fontSize: '.75rem', color: '#71818a' }}>ninguém bloqueado</div>
            )}
            {blocked.map((b) => (
              <div key={b.id} style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: '.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{b.username}</span>
                <button type="button" onClick={() => unblock(b.id)} style={{ fontSize: '.7rem' }}>desbloquear</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
