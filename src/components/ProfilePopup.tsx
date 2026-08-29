import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/displayName'
import { colorFromId } from '../lib/avatarColor'
import { formatPresence } from '../lib/presence'
import { IconArrowLeft, IconMore, IconPlus, IconUser } from './icons'
import type { Community, Profile } from '../types'

type ProfileData = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  status: string | null
  last_seen_at: string | null
  email: string
}

type ListPerson = { id: string; username: string; display_name: string | null; avatar_url: string | null }

type View = 'profile' | 'friends' | 'communities'

type Props = {
  me: Profile
  userId: string
  onClose: () => void
  onOpenCommunity: (c: Community) => void
  blockedIds: Set<string>
  onBlock: (userId: string) => void
}

export function ProfilePopup({ me, userId, onClose, onOpenCommunity, blockedIds, onBlock }: Props) {
  const [stack, setStack] = useState<string[]>([userId])
  const [view, setView] = useState<View>('profile')
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [friendCount, setFriendCount] = useState(0)
  const [communityCount, setCommunityCount] = useState(0)
  const [friends, setFriends] = useState<ListPerson[]>([])
  const [communities, setCommunities] = useState<Community[]>([])
  const [friendState, setFriendState] = useState<'idle' | 'sent' | 'friends'>('idle')
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  const currentId = stack[stack.length - 1]
  const isRoot = stack.length === 1

  useEffect(() => {
    setView('profile')
    setMenuOpen(false)
    setLoading(true)

    async function load() {
      const { data: p } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, status, last_seen_at, email')
        .eq('id', currentId)
        .single()
      setProfile((p as ProfileData) || null)

      const [{ count: fCount }, { count: cCount }] = await Promise.all([
        supabase
          .from('friend_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'accepted')
          .or(`from_id.eq.${currentId},to_id.eq.${currentId}`),
        supabase
          .from('community_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('user_id', currentId),
      ])
      setFriendCount(fCount || 0)
      setCommunityCount(cCount || 0)

      const { data: req } = await supabase
        .from('friend_requests')
        .select('status, from_id')
        .or(`and(from_id.eq.${me.id},to_id.eq.${currentId}),and(from_id.eq.${currentId},to_id.eq.${me.id})`)
        .maybeSingle()
      if (req?.status === 'accepted') setFriendState('friends')
      else if (req?.status === 'pending' && req.from_id === me.id) setFriendState('sent')
      else setFriendState('idle')

      setLoading(false)
    }
    load()
  }, [currentId, me.id])

  async function loadFriends() {
    setView('friends')
    const { data } = await supabase
      .from('friend_requests')
      .select(
        'from_id, to_id, from_profile:profiles!friend_requests_from_id_fkey(id, username, display_name, avatar_url), to_profile:profiles!friend_requests_to_id_fkey(id, username, display_name, avatar_url)',
      )
      .eq('status', 'accepted')
      .or(`from_id.eq.${currentId},to_id.eq.${currentId}`)
    setFriends(
      (data || []).map((row: any) => (row.from_id === currentId ? row.to_profile : row.from_profile)),
    )
  }

  async function loadCommunities() {
    setView('communities')
    const { data } = await supabase
      .from('community_members')
      .select('community:communities(*)')
      .eq('user_id', currentId)
    setCommunities((data || []).map((row: any) => row.community).filter(Boolean))
  }

  async function sendFriendRequest() {
    await supabase.from('friend_requests').insert({ from_id: me.id, to_id: currentId })
    setFriendState('sent')
  }

  function openPerson(id: string) {
    setStack((prev) => [...prev, id])
  }

  function goBack() {
    if (view !== 'profile') {
      setView('profile')
      return
    }
    if (stack.length > 1) {
      setStack((prev) => prev.slice(0, -1))
      return
    }
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card profile-popup" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn profile-popup-back" onClick={goBack}>
          <IconArrowLeft size={20} />
        </button>
        {view === 'profile' && currentId !== me.id && (
          <button type="button" className="icon-btn" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => setMenuOpen((v) => !v)}>
            <IconMore size={18} />
          </button>
        )}
        {menuOpen && (
          <div className="request-menu" style={{ top: 40, right: 8 }}>
            {blockedIds.has(currentId) ? (
              <span style={{ padding: '6px 8px', fontSize: '.75rem', color: '#8696a0' }}>bloqueado</span>
            ) : (
              <button type="button" onClick={() => { onBlock(currentId); setMenuOpen(false) }}>Bloquear</button>
            )}
          </div>
        )}

        {loading && <p style={{ padding: '30px 0' }}>carregando...</p>}

        {!loading && profile && view === 'profile' && (
          <>
            <div className="account-avatar-wrap">
              <div className="account-avatar" style={{ overflow: 'hidden' }}>
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <IconUser size={40} />
                )}
              </div>
            </div>
            <h2>{displayName(profile)}</h2>
            {isRoot && <p style={{ fontSize: '.75rem', color: '#8696a0' }}>{profile.email}</p>}
            <p>{profile.status || 'sem status'}</p>
            <p style={{ fontSize: '.75rem' }}>{formatPresence(profile.last_seen_at)}</p>

            <div className="profile-popup-stats">
              <button type="button" onClick={loadFriends}>
                <strong>{friendCount}</strong> amigos
              </button>
              <button type="button" onClick={loadCommunities}>
                <strong>{communityCount}</strong> comunidades
              </button>
            </div>

            {currentId !== me.id && (
              friendState === 'friends' ? (
                <p style={{ fontSize: '.75rem', color: '#a9e7d8' }}>✓ Amigos</p>
              ) : friendState === 'sent' ? (
                <p style={{ fontSize: '.75rem', color: '#a9e7d8' }}>solicitação de amizade enviada</p>
              ) : (
                <button type="button" className="google-btn" onClick={sendFriendRequest}>
                  <IconPlus size={14} /> Amigar
                </button>
              )
            )}
          </>
        )}

        {!loading && view === 'friends' && (
          <>
            <h2>Amigos</h2>
            <div className="profile-popup-grid">
              {friends.length === 0 && <p style={{ color: '#8696a0', fontSize: '.85rem' }}>nenhum amigo</p>}
              {friends.map((f) => (
                <div key={f.id} className="profile-popup-grid-item" onClick={() => openPerson(f.id)}>
                  <div className="photo" style={{ width: 56, height: 56 }}>
                    {f.avatar_url ? <img src={f.avatar_url} alt="" /> : (f.username[0] || '?').toUpperCase()}
                  </div>
                  <span>{displayName(f)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && view === 'communities' && (
          <>
            <h2>Comunidades</h2>
            <div className="profile-popup-grid">
              {communities.length === 0 && <p style={{ color: '#8696a0', fontSize: '.85rem' }}>nenhuma comunidade</p>}
              {communities.map((c) => (
                <div key={c.id} className="profile-popup-grid-item" onClick={() => { onOpenCommunity(c); onClose() }}>
                  <div className="photo" style={{ width: 56, height: 56, ...(c.image_url ? {} : { background: colorFromId(c.id), color: '#fff' }) }}>
                    {c.image_url ? <img src={c.image_url} alt="" /> : 'C'}
                  </div>
                  <span>{c.name}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <button type="button" className="modal-close" onClick={onClose}>fechar</button>
      </div>
    </div>
  )
}
