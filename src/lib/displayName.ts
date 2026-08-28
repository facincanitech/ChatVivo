export function displayName(p: { username: string; display_name?: string | null } | null | undefined): string {
  if (!p) return '...'
  return p.display_name?.trim() || p.username
}
