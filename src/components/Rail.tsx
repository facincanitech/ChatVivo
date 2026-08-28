import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errors'
import { IconChat, IconGroup, IconPlus, IconStar, IconUser } from './icons'
import type { Profile } from '../types'

type Props = {
  me: Profile | null
  onRequireAuth: () => void
  onNewConversation: () => void
  onProfileChange: (patch: Partial<Profile>) => void
}

export function Rail({ me, onRequireAuth, onNewConversation, onProfileChange }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [usernameDraft, setUsernameDraft] = useState('')
  const [statusDraft, setStatusDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleAvatarClick() {
    if (!me) {
      onRequireAuth()
      return
    }
    setUsernameDraft(me.username)
    setStatusDraft(me.status || '')
    setError(null)
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

  return (
    <aside className="rail">
      <div className="logo"><IconChat size={22} /></div>
      <button title="Nova conversa" onClick={onNewConversation}><IconPlus /></button>
      <button title="Comunidades (em breve)"><IconGroup /></button>
      <button title="Status (em breve)"><IconStar /></button>
      <div className="spacer" />
      <div style={{ position: 'relative' }}>
        <div className="avatar-sm" onClick={handleAvatarClick} title={me ? `@${me.username} — conta` : 'Entrar'}>
          <IconUser size={18} />
        </div>
        {menuOpen && me && (
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
            <button type="button" onClick={() => supabase.auth.signOut()}>Sair</button>
          </div>
        )}
      </div>
    </aside>
  )
}
