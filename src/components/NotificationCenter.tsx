import { useEffect, useState } from 'react'
import { IconBell, IconHeart, IconStar } from './icons'
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  onNotificationsChanged,
  type NotificationItem,
} from '../lib/notifications'
import { checkForUpdate } from '../lib/updateCheck'
import { APP_VERSION, APK_DOWNLOAD_URL } from '../version'

function formatAgo(at: number): string {
  const diff = Date.now() - at
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min}min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)

  useEffect(() => {
    function refresh() {
      setItems(getNotifications())
      setUnread(getUnreadCount())
    }
    refresh()
    return onNotificationsChanged(refresh)
  }, [])

  useEffect(() => {
    checkForUpdate(APP_VERSION).then((info) => {
      if (info.available) setUpdateVersion(info.version || null)
    })
  }, [])

  function toggle() {
    setOpen((v) => {
      const next = !v
      if (next) markAllRead()
      return next
    })
  }

  const hasBadge = unread > 0 || !!updateVersion

  return (
    <div style={{ position: 'relative' }}>
      <button title="Notificações" onClick={toggle}>
        <IconStar />
      </button>
      {hasBadge && <span className="rail-badge" />}
      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-panel">
            {updateVersion && (
              <a
                className="notif-item notif-update"
                href={APK_DOWNLOAD_URL}
              >
                <span className="notif-update-bang">!</span>
                <span>Nova versão disponível (v{updateVersion}) — baixar atualização</span>
              </a>
            )}
            {items.length === 0 && !updateVersion && (
              <p className="notif-empty">nenhuma notificação ainda</p>
            )}
            {items.map((n) => (
              <div key={n.id} className="notif-item">
                {n.kind === 'wink' ? <IconHeart size={15} /> : <IconBell size={15} />}
                <span>{n.text}</span>
                <span className="notif-time">{formatAgo(n.at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
