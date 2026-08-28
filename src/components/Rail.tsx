import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { IconChat, IconGroup, IconPlus, IconStar, IconUser } from './icons'
import type { Profile } from '../types'

type Props = {
  me: Profile | null
  onRequireAuth: () => void
  onNewConversation: () => void
}

export function Rail({ me, onRequireAuth, onNewConversation }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)

  function handleAvatarClick() {
    if (!me) {
      onRequireAuth()
      return
    }
    setMenuOpen((v) => !v)
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
            <button type="button" onClick={() => supabase.auth.signOut()}>Sair</button>
          </div>
        )}
      </div>
    </aside>
  )
}
