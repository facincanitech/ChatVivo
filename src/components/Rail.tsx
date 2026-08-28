import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { IconChat, IconGroup, IconPlus, IconStar, IconUser } from './icons'
import type { Profile } from '../types'

type Props = {
  me: Profile | null
  onRequireAuth: () => void
  onNewConversation: () => void
  onStatusChange: (status: string) => void
}

export function Rail({ me, onRequireAuth, onNewConversation, onStatusChange }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [statusDraft, setStatusDraft] = useState('')
  const [savingStatus, setSavingStatus] = useState(false)

  function handleAvatarClick() {
    if (!me) {
      onRequireAuth()
      return
    }
    setStatusDraft(me.status || '')
    setMenuOpen((v) => !v)
  }

  async function saveStatus() {
    if (!me) return
    setSavingStatus(true)
    const status = statusDraft.trim()
    await supabase.from('profiles').update({ status }).eq('id', me.id)
    onStatusChange(status)
    setSavingStatus(false)
  }

  return (
    <aside className="rail">
      <div className="logo"><IconChat size={22} /></div>
      <button className="active" title="Conversas"><IconChat /></button>
      <button title="Nova conversa" onClick={onNewConversation}><IconPlus /></button>
      <button title="Comunidades (em breve)"><IconGroup /></button>
      <button title="Status (em breve)"><IconStar /></button>
      <div className="spacer" />
      <div style={{ position: 'relative' }}>
        <div className="avatar-sm" onClick={handleAvatarClick} title={me ? `${me.username} — conta` : 'Entrar'}>
          <IconUser size={18} />
        </div>
        {menuOpen && me && (
          <div className="profile-menu">
            <div style={{ padding: '4px 10px', fontSize: '.8rem', color: '#8696a0' }}>{me.username}</div>
            <div style={{ padding: '4px 10px', display: 'flex', gap: 6 }}>
              <input
                placeholder="seu status..."
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value)}
                style={{ flex: 1, minWidth: 0, background: '#111b21', border: '1px solid #34434b', borderRadius: 4, color: 'inherit', padding: '4px 6px', fontSize: '.75rem' }}
              />
              <button type="button" disabled={savingStatus} onClick={saveStatus} style={{ fontSize: '.7rem' }}>ok</button>
            </div>
            <button type="button" onClick={() => supabase.auth.signOut()}>Sair</button>
          </div>
        )}
      </div>
    </aside>
  )
}
