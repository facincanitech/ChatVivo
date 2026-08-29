const PALETTE = [
  '#e5484d', '#f76b15', '#f5a623', '#ffc53d', '#30a46c',
  '#12a594', '#0ea5e9', '#3e63dd', '#8e4ec6', '#d6409f', '#e54666',
]

export function colorFromId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}
