import { playNudgeSound } from './nudge'

export type WinkId = 'heart' | 'laugh' | 'kiss' | 'confetti' | 'shock' | 'fire' | 'splash'

type WinkEffect = 'mark' | 'flash' | 'bounce' | 'shake' | 'burst'

type WinkDef = { id: WinkId; emoji: string; label: string; effect: WinkEffect; color?: string; particleEmoji?: string }

export const WINKS: WinkDef[] = [
  { id: 'heart', emoji: '❤️', label: 'Coração', effect: 'burst' },
  { id: 'laugh', emoji: '😂', label: 'Risada', effect: 'bounce' },
  { id: 'kiss', emoji: '😘', label: 'Beijo', effect: 'mark', color: 'rgba(219,39,119,.55)' },
  { id: 'confetti', emoji: '🎉', label: 'Confete', effect: 'burst' },
  { id: 'shock', emoji: '😱', label: 'Susto', effect: 'shake' },
  { id: 'fire', emoji: '🔥', label: 'Fogo', effect: 'flash', color: 'rgba(255,111,0,.5)' },
  { id: 'splash', emoji: '🪣', label: 'Baldaço', effect: 'flash', color: 'rgba(56,139,253,.5)', particleEmoji: '💧' },
]

const CORNERS = [
  { x: '-60vw', y: '-60vh', r: -50 },
  { x: '60vw', y: '-60vh', r: 50 },
  { x: '-60vw', y: '60vh', r: -30 },
  { x: '60vw', y: '60vh', r: 30 },
]

function spawnFlyInCharacter(emoji: string) {
  const char = document.createElement('div')
  char.className = 'wink-character'
  char.textContent = emoji
  const from = CORNERS[Math.floor(Math.random() * CORNERS.length)]
  char.style.setProperty('--from-x', from.x)
  char.style.setProperty('--from-y', from.y)
  char.style.setProperty('--from-r', `${from.r}deg`)
  document.body.appendChild(char)
  setTimeout(() => char.remove(), 1400)
}

function spawnBounceCharacter(emoji: string) {
  const char = document.createElement('div')
  char.className = 'wink-character wink-bounce'
  char.textContent = emoji
  document.body.appendChild(char)
  setTimeout(() => char.remove(), 2200)
}

function spawnMark(color: string) {
  const mark = document.createElement('div')
  mark.className = 'wink-mark'
  mark.style.background = `radial-gradient(circle, ${color}, transparent 70%)`
  document.body.appendChild(mark)
  setTimeout(() => mark.remove(), 2100)
}

function spawnParticles(emoji: string, count = 16) {
  const overlay = document.createElement('div')
  overlay.className = 'wink-overlay'
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span')
    span.textContent = emoji
    span.className = 'wink-particle'
    span.style.left = `${Math.random() * 96}%`
    span.style.animationDelay = `${Math.random() * 0.7}s`
    span.style.fontSize = `${22 + Math.random() * 30}px`
    overlay.appendChild(span)
  }
  document.body.appendChild(overlay)
  setTimeout(() => overlay.remove(), 2500)
}

export function playWinkEffect(winkId: string) {
  const wink = WINKS.find((w) => w.id === winkId)
  if (!wink) return

  switch (wink.effect) {
    case 'mark':
      spawnFlyInCharacter(wink.emoji)
      setTimeout(() => spawnMark(wink.color || 'rgba(219,39,119,.5)'), 650)
      break
    case 'flash':
      spawnFlyInCharacter(wink.emoji)
      setTimeout(() => {
        spawnMark(wink.color || 'rgba(255,255,255,.4)')
        spawnParticles(wink.particleEmoji || wink.emoji, 12)
      }, 600)
      break
    case 'bounce':
      spawnBounceCharacter(wink.emoji)
      break
    case 'shake': {
      spawnFlyInCharacter(wink.emoji)
      const el = document.querySelector('.app')
      if (el) {
        el.classList.remove('nudging')
        void (el as HTMLElement).offsetWidth
        el.classList.add('nudging')
        setTimeout(() => el.classList.remove('nudging'), 500)
      }
      break
    }
    case 'burst':
    default:
      spawnParticles(wink.emoji)
      break
  }

  playNudgeSound()
}
