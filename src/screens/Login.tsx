import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function Login() {
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
    <div className="auth-screen">
      <h1>ChatVivo</h1>
      <button type="button" className="google-btn" onClick={handleGoogle}>
        Entrar com Google
      </button>
      {error && <p className="auth-error">{error}</p>}
    </div>
  )
}
