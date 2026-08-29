import { playNudgeSound } from './nudge'

export type WinkId = 'heart' | 'laugh' | 'kiss' | 'confetti' | 'shock' | 'fire'

export const WINKS: { id: WinkId; emoji: string; label: string }[] = [
  { id: 'heart', emoji: '❤️', label: 'Coração' },
  { id: 'laugh', emoji: '😂', label: 'Risada' },
  { id: 'kiss', emoji: '😘', label: 'Beijo' },
  { id: 'confetti', emoji: '🎉', label: 'Confete' },
  { id: 'shock', emoji: '😱', label: 'Susto' },
  { id: 'fire', emoji: '🔥', label: 'Fogo' },
]

export function playWinkEffect(winkId: string) {
  const wink = WINKS.find((w) => w.id === winkId)
  if (!wink) return

  const overlay = document.createElement('div')
  overlay.className = 'wink-overlay'
  const count = 18
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span')
    span.textContent = wink.emoji
    span.className = 'wink-particle'
    span.style.left = `${Math.random() * 96}%`
    span.style.animationDelay = `${Math.random() * 0.7}s`
    span.style.fontSize = `${22 + Math.random() * 30}px`
    overlay.appendChild(span)
  }
  document.body.appendChild(overlay)
  setTimeout(() => overlay.remove(), 2500)

  if (winkId === 'shock') {
    const el = document.querySelector('.app')
    if (el) {
      el.classList.remove('nudging')
      void (el as HTMLElement).offsetWidth
      el.classList.add('nudging')
      setTimeout(() => el.classList.remove('nudging'), 500)
    }
  }

  playNudgeSound()
}
