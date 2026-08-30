import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { App as CapacitorApp } from '@capacitor/app'
import { supabase } from './lib/supabase'
import { Rail } from './components/Rail'
import { ChatList } from './components/ChatList'
import { MainPanel } from './components/MainPanel'
import { CommunityView } from './components/CommunityView'
import { AuthModal } from './components/AuthModal'
import type { Community, Conversation, PanelView, Profile } from './types'
import { APP_VERSION } from './version'
import { playNudgeSound, triggerNudgeShake } from './lib/nudge'
import { playWinkEffect, playCustomWinkEffect } from './lib/winks'
import { saveCustomWink, type CustomWink } from './lib/customWinks'
import { addNotification } from './lib/notifications'
import { registerPushNotifications } from './lib/pushNotifications'
import { promptDisableBatteryOptimization } from './lib/batteryOpt'
import { displayName } from './lib/displayName'
import './App.css'

type Theme = 'dark' | 'light' | 'contrast'

function App() {
  useEffect(() => {
    document.title = `Flux v${APP_VERSION}`
  }, [])

  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('ferus-theme')
      if (saved === 'dark' || saved === 'light' || saved === 'contrast') return saved
    } catch {
      // ignore
    }
    return 'light'
  })

  useEffect(() => {
    if (theme === 'dark') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('ferus-theme', theme)
    } catch {
      // ignore
    }
  }, [theme])

  useEffect(() => {
    const listenerPromise = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      const hashIndex = url.indexOf('#')
      if (hashIndex === -1) return
      const params = new URLSearchParams(url.slice(hashIndex + 1))
      const access_token = params.get('access_token')
      const refresh_token = params.get('refresh_token')
      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token })
      }
    })
    return () => {
      listenerPromise.then((l) => l.remove())
    }
  }, [])

  useEffect(() => {
    let hiddenAt: number | null = null
    function onVisibility() {
      if (document.hidden) {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt && Date.now() - hiddenAt > 60000) {
        window.location.reload()
      }
      hiddenAt = null
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const navStateRef = useRef({ panelOpen: false, accountOpen: false, groupsOpen: false, selectedCommunity: false, selected: false })

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null)
  const [communityTab, setCommunityTab] = useState<'home' | 'info'>('home')
  const [authOpen, setAuthOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelView, setPanelView] = useState<PanelView>('root')
  const [accountOpen, setAccountOpen] = useState(false)
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    navStateRef.current = { panelOpen, accountOpen, groupsOpen, selectedCommunity: !!selectedCommunity, selected: !!selected }
  }, [panelOpen, accountOpen, groupsOpen, selectedCommunity, selected])

  useEffect(() => {
    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      const s = navStateRef.current
      if (s.panelOpen) setPanelOpen(false)
      else if (s.accountOpen) setAccountOpen(false)
      else if (s.groupsOpen) setGroupsOpen(false)
      else if (s.selectedCommunity) setSelectedCommunity(null)
      else if (s.selected) setSelected(null)
      else CapacitorApp.exitApp()
    })
    return () => {
      listenerPromise.then((l) => l.remove())
    }
  }, [])
  const [nudgers, setNudgers] = useState<{ fromId: string; conversationId: string; at: number }[]>([])

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
      .select('id, username, email, status, last_seen_at, display_name, avatar_url, is_idle, age, city')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data as Profile))
  }, [session])

  useEffect(() => {
    if (!profile) return
    registerPushNotifications(profile.id).catch(() => {})
    promptDisableBatteryOptimization().catch(() => {})
  }, [profile?.id])

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

  useEffect(() => {
    if (!profile) {
      setBlockedIds(new Set())
      return
    }

    async function load() {
      if (!profile) return
      const { data } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', profile.id)
      setBlockedIds(new Set((data || []).map((r) => r.blocked_id as string)))
    }

    load()

    const channel = supabase
      .channel(`blocks:${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'blocks', filter: `blocker_id=eq.${profile.id}` },
        () => load(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set())
  const mutedIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    mutedIdsRef.current = mutedIds
  }, [mutedIds])

  useEffect(() => {
    if (!profile) {
      setMutedIds(new Set())
      return
    }

    async function load() {
      if (!profile) return
      const { data } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', profile.id)
        .eq('muted', true)
      setMutedIds(new Set((data || []).map((r) => r.conversation_id as string)))
    }

    load()

    const channel = supabase
      .channel(`muted:${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${profile.id}` },
        () => load(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  async function notifyFrom(userId: string, verb: string) {
    const { data } = await supabase.from('profiles').select('username, display_name').eq('id', userId).single()
    const name = data ? displayName(data) : 'Alguém'
    addNotification(verb === 'chamou sua atenção' ? 'nudge' : 'wink', `${name} ${verb}`)
  }

  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel(`nudge:${profile.id}`)
      .on('broadcast', { event: 'nudge' }, ({ payload }) => {
        const { userId, conversationId } = payload as { userId: string; conversationId?: string }
        if (conversationId && mutedIdsRef.current.has(conversationId)) return
        triggerNudgeShake()
        playNudgeSound()
        notifyFrom(userId, 'chamou sua atenção')
        if (!conversationId) return
        setNudgers((prev) => {
          if (prev.some((n) => n.conversationId === conversationId)) return prev
          return [...prev, { fromId: userId, conversationId, at: Date.now() }]
        })
        setTimeout(() => {
          setNudgers((prev) => prev.filter((n) => n.conversationId !== conversationId))
        }, 600000)
      })
      .on('broadcast', { event: 'wink' }, ({ payload }) => {
        const { userId, conversationId, winkId } = payload as { userId: string; conversationId?: string; winkId?: string }
        if (conversationId && mutedIdsRef.current.has(conversationId)) return
        if (winkId) playWinkEffect(winkId)
        notifyFrom(userId, 'mandou um wink')
      })
      .on('broadcast', { event: 'customWink' }, ({ payload }) => {
        const { userId, conversationId, label, imageData, soundData } = payload as {
          userId: string
          conversationId?: string
          label: string
          imageData: string
          soundData: string | null
        }
        if (conversationId && mutedIdsRef.current.has(conversationId)) return
        playCustomWinkEffect(imageData, soundData)
        const wink: CustomWink = { id: crypto.randomUUID(), label, imageData, soundData, fromUser: userId }
        saveCustomWink(wink).catch(() => {})
        notifyFrom(userId, `mandou um wink (${label})`)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!selected) return
    setNudgers((prev) => prev.filter((n) => n.conversationId !== selected.id))
  }, [selected?.id])

  async function openNudger() {
    if (nudgers.length === 0) {
      goHome()
      return
    }
    const target = nudgers[0]
    setNudgers((prev) => prev.filter((n) => n.conversationId !== target.conversationId))
    const { data } = await supabase.from('conversations').select('*').eq('id', target.conversationId).single()
    if (data) setSelected(data as Conversation)
  }

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
      setGroupsOpen(false)
      setPanelView('root')
      setPanelOpen(true)
    })
  }

  function openAccount() {
    requireAuth(() => {
      setPanelOpen(false)
      setGroupsOpen(false)
      setAccountOpen(true)
    })
  }

  function openGroups() {
    requireAuth(() => {
      setPanelOpen(false)
      setAccountOpen(false)
      setGroupsOpen(true)
    })
  }

  function goHome() {
    setSelected(null)
    setSelectedCommunity(null)
    setPanelOpen(false)
    setAccountOpen(false)
    setGroupsOpen(false)
  }

  const anyPanelOpen = panelOpen || accountOpen || groupsOpen

  return (
    <div className={`app${selected || selectedCommunity ? ' chat-open' : ''}${anyPanelOpen ? ' panel-open' : ''}`}>
      <Rail
        me={profile}
        onRequireAuth={() => requireAuth(() => {})}
        onNewConversation={openNewConversation}
        onOpenAccount={openAccount}
        onOpenGroups={openGroups}
        onGoHome={openNudger}
        nudgeCount={nudgers.length}
      />
      <ChatList
        me={profile}
        selected={selected}
        onSelect={(c) => { setSelectedCommunity(null); setSelected(c) }}
        onSelectCommunity={(c) => { setSelected(null); setCommunityTab('home'); setSelectedCommunity(c) }}
        selectedCommunity={selectedCommunity}
        communityTab={communityTab}
        onCommunityTabChange={setCommunityTab}
        onCommunityBack={() => setSelectedCommunity(null)}
        panelOpen={panelOpen}
        panelView={panelView}
        onPanelOpenChange={setPanelOpen}
        onPanelViewChange={setPanelView}
        accountOpen={accountOpen}
        onAccountOpenChange={setAccountOpen}
        groupsOpen={groupsOpen}
        onGroupsOpenChange={setGroupsOpen}
        onProfileChange={(patch) => setProfile((p) => (p ? { ...p, ...patch } : p))}
        theme={theme}
        onThemeChange={setTheme}
        blockedIds={blockedIds}
      />
      {selectedCommunity && profile ? (
        <CommunityView
          me={profile}
          community={selectedCommunity}
          activeTab={communityTab}
          onTabChange={setCommunityTab}
          onCommunityUpdate={(patch) => setSelectedCommunity((c) => (c ? { ...c, ...patch } : c))}
          onDeleted={() => setSelectedCommunity(null)}
          onBack={() => setSelectedCommunity(null)}
        />
      ) : (
        <MainPanel
          me={profile}
          conversation={selected}
          blockedIds={blockedIds}
          onBack={() => setSelected(null)}
          onConversationUpdate={(patch) => setSelected((c) => (c ? { ...c, ...patch } : c))}
          onOpenCommunity={(c) => { setSelected(null); setCommunityTab('home'); setSelectedCommunity(c) }}
        />
      )}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  )
}

export default App
