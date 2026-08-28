import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { Login } from './screens/Login'
import { Conversations } from './screens/Conversations'
import { Chat } from './screens/Chat'
import type { Conversation, Profile } from './types'
import './App.css'

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [openConversation, setOpenConversation] = useState<Conversation | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setOpenConversation(null)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('id, username')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data as Profile))
  }, [session])

  if (session === undefined) return null
  if (!session) return <Login />
  if (!profile) return <div className="auth-screen"><p>carregando...</p></div>

  if (openConversation) {
    return (
      <Chat
        me={profile}
        conversation={openConversation}
        onBack={() => setOpenConversation(null)}
      />
    )
  }

  return <Conversations me={profile} onOpen={setOpenConversation} />
}

export default App
