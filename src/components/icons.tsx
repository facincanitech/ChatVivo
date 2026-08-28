type IconProps = { size?: number }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconChat({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M4 5h16v11H9l-5 4V5z" />
    </svg>
  )
}

export function IconPlus({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function IconGroup({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" />
      <path d="M15 14.5c2.8.3 4.5 2 4.5 5.5" />
    </svg>
  )
}

export function IconStar({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
    </svg>
  )
}

export function IconSearch({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

export function IconUser({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  )
}

export function IconHeart({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M12 20s-7-4.4-9.5-9C.8 7.8 2.4 4 6 4c2 0 3.3 1 4 2.3C10.7 5 12 4 14 4c3.6 0 5.2 3.8 3.5 7-2.5 4.6-9.5 9-9.5 9z" />
    </svg>
  )
}

export function IconSend({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <line x1="21" y1="3" x2="10" y2="14" />
      <polygon points="21 3 14 21 10 14 3 10 21 3" />
    </svg>
  )
}

export function IconAttach({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M17 7.5 9 15.5a3 3 0 1 0 4.2 4.2l8-8a5 5 0 1 0-7-7l-8 8" />
    </svg>
  )
}

export function IconSmile({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 13.5c1 1.3 2.3 2 4 2s3-.7 4-2" />
      <line x1="9" y1="9.5" x2="9" y2="9.5" />
      <line x1="15" y1="9.5" x2="15" y2="9.5" />
    </svg>
  )
}

export function IconHash({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <line x1="9" y1="4" x2="7" y2="20" />
      <line x1="17" y1="4" x2="15" y2="20" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="3" y1="15" x2="19" y2="15" />
    </svg>
  )
}

export function IconArrowLeft({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

export function IconCheck({ size = 14 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function IconCheckDouble({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <polyline points="18 6 7 17 2 12" />
      <polyline points="22 6 11 17" />
    </svg>
  )
}

export function IconMore({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  )
}

export function IconArchive({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  )
}

export function IconPinOff({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <line x1="3" y1="3" x2="21" y2="21" />
      <path d="M9 4h6l-1 6 3 3v2H6v-2l3-3z" />
      <line x1="12" y1="15" x2="12" y2="21" />
    </svg>
  )
}

export function IconMailUnread({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}

export function IconListPlus({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <line x1="3" y1="6" x2="14" y2="6" />
      <line x1="3" y1="12" x2="14" y2="12" />
      <line x1="3" y1="18" x2="10" y2="18" />
      <line x1="18" y1="14" x2="18" y2="20" />
      <line x1="15" y1="17" x2="21" y2="17" />
    </svg>
  )
}

export function IconMinusCircle({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

export function IconTrash({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <polyline points="4 7 20 7" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
      <path d="M9 7V4h6v3" />
    </svg>
  )
}

export function IconBellOff({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M6 10a6 6 0 0 1 10-4.4M18 10c0 5 2 6 2 6H8" />
      <path d="M4 4l16 16" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function IconLogout({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export function IconLock({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export function IconBell({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M6 10a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}
