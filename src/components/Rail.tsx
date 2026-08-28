import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

type Props = {
  me: Profile | null
  onRequireAuth: () => void
}

export function Rail({ me, onRequireAuth }: Props) {
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
      <div className="logo">◉</div>
      <button className="active" title="Conversas">▣</button>
      <button title="Chamadas (em breve)">⌕</button>
      <button title="Comunidades (em breve)">◌</button>
      <button title="Status (em breve)">◉</button>
      <div className="spacer" />
      <div style={{ position: 'relative' }}>
        <div className="avatar-sm" onClick={handleAvatarClick} title={me ? me.username : 'Entrar'}>
          {me ? me.username[0]?.toUpperCase() : '?'}
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
