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
      .select('id, username, email, status, last_seen_at')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data as Profile))
  }, [session])

  useEffect(() => {
    if (!session) return
    const heartbeat = () => {
      supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', session.user.id).then()
    }
    heartbeat()
    const interval = setInterval(heartbeat, 60000)
    document.addEventListener('visibilitychange', heartbeat)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', heartbeat)
    }
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
    <div className={`app${selected ? ' chat-open' : ''}`}>
      <Rail
        me={profile}
        onRequireAuth={() => requireAuth(() => {})}
        onNewConversation={openNewConversation}
        onStatusChange={(status) => setProfile((p) => (p ? { ...p, status } : p))}
      />
      <ChatList
        me={profile}
        selected={selected}
        onSelect={setSelected}
        panelOpen={panelOpen}
        panelView={panelView}
        onPanelOpenChange={setPanelOpen}
        onPanelViewChange={setPanelView}
      />
      <MainPanel me={profile} conversation={selected} onBack={() => setSelected(null)} />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  )
}

export default App
