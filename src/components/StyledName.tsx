export const NAME_FONTS = [
  { id: 'default', label: 'Padrão', family: 'inherit' },
  { id: 'poppins', label: 'Poppins', family: "'Poppins', sans-serif" },
  { id: 'bebas', label: 'Bebas Neue', family: "'Bebas Neue', cursive" },
  { id: 'pacifico', label: 'Pacifico', family: "'Pacifico', cursive" },
  { id: 'pixel', label: 'Press Start 2P', family: "'Press Start 2P', monospace" },
  { id: 'righteous', label: 'Righteous', family: "'Righteous', cursive" },
  { id: 'caveat', label: 'Caveat', family: "'Caveat', cursive" },
]

export const NAME_EFFECTS: { id: 'solid' | 'gradient' | 'neon' | 'prism'; label: string }[] = [
  { id: 'solid', label: 'Sólido' },
  { id: 'gradient', label: 'Gradiente' },
  { id: 'neon', label: 'Neon' },
  { id: 'prism', label: 'Prism' },
]

type Props = {
  name: string
  font?: string | null
  effect?: 'solid' | 'gradient' | 'neon' | 'prism' | null
  color?: string | null
  className?: string
}

export function StyledName({ name, font, effect, color, className }: Props) {
  const fontDef = NAME_FONTS.find((f) => f.id === font)
  const style: React.CSSProperties = fontDef && fontDef.id !== 'default' ? { fontFamily: fontDef.family } : {}

  if (effect === 'neon' && color) {
    style.color = color
    style.textShadow = `0 0 4px ${color}, 0 0 10px ${color}, 0 0 18px ${color}`
  } else if (effect === 'gradient' && color) {
    style.backgroundImage = color
  } else if (effect === 'solid' && color) {
    style.color = color
  }

  const effectClass = effect === 'gradient' ? ' name-effect-gradient' : effect === 'prism' ? ' name-effect-prism' : ''

  return (
    <span className={`styled-name${effectClass}${className ? ` ${className}` : ''}`} style={style}>
      {name}
    </span>
  )
}
