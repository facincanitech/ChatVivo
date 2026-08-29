export type NotificationKind = 'nudge' | 'wink'

export type NotificationItem = {
  id: string
  kind: NotificationKind
  text: string
  at: number
  read: boolean
}

const KEY = 'ferus-notifications'
const MAX = 40
const EVENT = 'ferus-notifications-changed'

export function getNotifications(): NotificationItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(items: NotificationItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)))
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT))
}

export function addNotification(kind: NotificationKind, text: string) {
  const items = getNotifications()
  items.unshift({ id: crypto.randomUUID(), kind, text, at: Date.now(), read: false })
  save(items)
}

export function markAllRead() {
  save(getNotifications().map((n) => ({ ...n, read: true })))
}

export function getUnreadCount(): number {
  return getNotifications().filter((n) => !n.read).length
}

export function onNotificationsChanged(cb: () => void) {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}
