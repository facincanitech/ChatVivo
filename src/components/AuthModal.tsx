import { useState } from 'react'
import { supabase } from '../lib/supabase'

type Props = {
  onClose: () => void
}

export function AuthModal({ onClose }: Props) {
  const [error, setError] = useState<string | null>(null)

  async function handleGoogle() {
    setError(null)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    })
    if (oauthError) setError(oauthError.message)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Entrar no Ferus</h2>
        <p>Você precisa de uma conta pra fazer isso.</p>
        <button type="button" className="google-btn" onClick={handleGoogle}>
          Entrar com Google
        </button>
        {error && <p className="auth-error">{error}</p>}
        <button type="button" className="modal-close" onClick={onClose}>fechar</button>
      </div>
    </div>
  )
}
