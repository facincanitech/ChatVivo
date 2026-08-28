import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { Rail } from './components/Rail'
import { ChatList } from './components/ChatList'
import { MainPanel } from './components/MainPanel'
import { AuthModal } from './components/AuthModal'
import type { Conversation, PanelView, Profile } from './types'
import './App.css'

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelView, setPanelView] = useState<PanelView>('root')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setSelected(null)
      } else {
        setAuthOpen(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('id, username, email')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data as Profile))
  }, [session])

  function requireAuth(action: () => void) {
    if (session === undefined) return
    if (!session) {
      setAuthOpen(true)
      return
    }
    action()
  }

  function openNewConversation() {
    requireAuth(() => {
      setPanelView('root')
      setPanelOpen(true)
    })
  }

  return (
    <div className="app">
      <Rail me={profile} onRequireAuth={() => requireAuth(() => {})} onNewConversation={openNewConversation} />
      <ChatList
        me={profile}
        selected={selected}
        onSelect={setSelected}
        panelOpen={panelOpen}
        panelView={panelView}
        onPanelOpenChange={setPanelOpen}
        onPanelViewChange={setPanelView}
      />
      <MainPanel me={profile} conversation={selected} />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  )
}

export default App
