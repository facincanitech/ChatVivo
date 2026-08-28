import { useEffect, useRef, useState } from 'react'
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
  const [accountOpen, setAccountOpen] = useState(false)

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
      if (window.location.hash || window.location.search) {
        window.history.replaceState(null, '', window.location.pathname)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('id, username, email, status, last_seen_at, display_name, avatar_url, is_idle')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data as Profile))
  }, [session])

  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    if (!session) return
    const IDLE_THRESHOLD_MS = 120000

    function markActive() {
      lastActivityRef.current = Date.now()
    }
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    activityEvents.forEach((ev) => window.addEventListener(ev, markActive, { passive: true }))

    const heartbeat = () => {
      const isIdle = Date.now() - lastActivityRef.current > IDLE_THRESHOLD_MS
      supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString(), is_idle: isIdle })
        .eq('id', session.user.id)
        .then()
    }
    heartbeat()
    const interval = setInterval(heartbeat, 30000)
    document.addEventListener('visibilitychange', heartbeat)
    return () => {
      clearInterval(interval)
      activityEvents.forEach((ev) => window.removeEventListener(ev, markActive))
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
      setAccountOpen(false)
      setPanelView('root')
      setPanelOpen(true)
    })
  }

  function openAccount() {
    requireAuth(() => {
      setPanelOpen(false)
      setAccountOpen(true)
    })
  }

  return (
    <div className={`app${selected ? ' chat-open' : ''}`}>
      <Rail
        me={profile}
        onRequireAuth={() => requireAuth(() => {})}
        onNewConversation={openNewConversation}
        onOpenAccount={openAccount}
      />
      <ChatList
        me={profile}
        selected={selected}
        onSelect={setSelected}
        panelOpen={panelOpen}
        panelView={panelView}
        onPanelOpenChange={setPanelOpen}
        onPanelViewChange={setPanelView}
        accountOpen={accountOpen}
        onAccountOpenChange={setAccountOpen}
        onProfileChange={(patch) => setProfile((p) => (p ? { ...p, ...patch } : p))}
      />
      <MainPanel
        me={profile}
        conversation={selected}
        onBack={() => setSelected(null)}
        onConversationUpdate={(patch) => setSelected((c) => (c ? { ...c, ...patch } : c))}
      />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  )
}

export default App
