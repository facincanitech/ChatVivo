function relativeLuminance(hex: string): number {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16) / 255
  const g = parseInt(c.substring(2, 4), 16) / 255
  const b = parseInt(c.substring(4, 6), 16) / 255
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// aproxima o contraste ideal pegando a primeira cor hex de dentro de um gradiente/cor
export function pickTextColor(bg: string | null | undefined): string | null {
  if (!bg) return null
  const match = bg.match(/#[0-9a-fA-F]{6}/)
  const hex = match ? match[0] : bg.startsWith('#') && bg.length === 7 ? bg : null
  if (!hex) return null
  return relativeLuminance(hex) > 0.5 ? '#12161c' : '#ffffff'
}
