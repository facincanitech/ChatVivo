export function formatPresence(lastSeenAt: string | null | undefined): string {
  if (!lastSeenAt) return 'offline'
  const diffMs = Date.now() - new Date(lastSeenAt).getTime()
  if (diffMs < 90_000) return 'online'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `visto por último há ${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `visto por último há ${hours}h`
  const days = Math.floor(hours / 24)
  return `visto por último há ${days}d`
}
