import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { IconChat, IconGroup, IconPlus, IconStar, IconUser } from './icons'
import type { Profile } from '../types'

type Props = {
  me: Profile | null
  onRequireAuth: () => void
  onNewConversation: () => void
  onOpenAccount: () => void
}

export function Rail({ me, onRequireAuth, onNewConversation, onOpenAccount }: Props) {
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (!me) {
      setPendingCount(0)
      return
    }

    async function load() {
      if (!me) return
      const { count } = await supabase
        .from('friend_requests')
        .select('id', { count: 'exact', head: true })
        .eq('to_id', me.id)
        .eq('status', 'pending')
      setPendingCount(count || 0)
    }

    load()

    const channel = supabase
      .channel(`pending-requests:${me.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests', filter: `to_id=eq.${me.id}` },
        () => load(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [me?.id])

  function handleAvatarClick() {
    if (!me) {
      onRequireAuth()
      return
    }
    onOpenAccount()
  }

  return (
    <aside className="rail">
      <div className="logo"><IconChat size={22} /></div>
      <div style={{ position: 'relative' }}>
        <button title="Nova conversa" onClick={onNewConversation}><IconPlus /></button>
        {pendingCount > 0 && (
          <span className="rail-badge" title={`${pendingCount} solicitação(ões) de amizade`}>
            <IconStar size={11} />
          </span>
        )}
      </div>
      <button title="Comunidades (em breve)"><IconGroup /></button>
      <button title="Status (em breve)"><IconStar /></button>
      <div className="spacer" />
      <div
        className="avatar-sm"
        onClick={handleAvatarClick}
        title={me ? `@${me.username} — conta` : 'Entrar'}
      >
        <IconUser size={18} />
      </div>
    </aside>
  )
}
