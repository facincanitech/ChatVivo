import { playNudgeSound } from './nudge'

export type WinkId = 'heart' | 'laugh' | 'kiss' | 'confetti' | 'shock' | 'splash' | 'fart' | 'wolf' | 'knock'

type WinkEffect = 'mark' | 'flash' | 'bounce' | 'shake' | 'burst'

type WinkDef = { id: WinkId; emoji: string; label: string; effect: WinkEffect; color?: string; particleEmoji?: string; sounds?: string[] }

export const WINKS: WinkDef[] = [
  { id: 'heart', emoji: '❤️', label: 'Coração', effect: 'burst' },
  { id: 'laugh', emoji: '😂', label: 'Risada', effect: 'bounce' },
  { id: 'kiss', emoji: '😘', label: 'Beijo', effect: 'mark', color: 'rgba(219,39,119,.55)' },
  { id: 'confetti', emoji: '🎉', label: 'Confete', effect: 'burst' },
  { id: 'shock', emoji: '😱', label: 'Susto', effect: 'shake' },
  { id: 'splash', emoji: '🪣', label: 'Baldaço', effect: 'flash', color: 'rgba(56,139,253,.5)', particleEmoji: '💧' },
  { id: 'fart', emoji: '💨', label: 'Peido', effect: 'shake', sounds: ['wink-far1.m4a', 'wink-far2.m4a', 'wink-far3.m4a'] },
  { id: 'wolf', emoji: '👀', label: 'Fiu fiu', effect: 'bounce', sounds: ['wink-fiufiu.m4a'] },
  { id: 'knock', emoji: '🚪', label: 'Toc toc', effect: 'mark', color: 'rgba(217,119,6,.5)', sounds: ['wink-knock-knock.m4a'] },
]

function playWinkSound(wink: WinkDef) {
  let fallenBack = false
  const fallback = () => {
    if (fallenBack) return
    fallenBack = true
    playNudgeSound()
  }
  const file = wink.sounds
    ? wink.sounds[Math.floor(Math.random() * wink.sounds.length)]
    : `wink-${wink.id}.mp3`
  const audio = new Audio(`${import.meta.env.BASE_URL}sounds/${file}`)
  audio.volume = 0.8
  audio.addEventListener('error', fallback)
  audio.play().catch(fallback)
}

const CORNERS = [
  { x: '-60vw', y: '-60vh', r: -50 },
  { x: '60vw', y: '-60vh', r: 50 },
  { x: '-60vw', y: '60vh', r: -30 },
  { x: '60vw', y: '60vh', r: 30 },
]

function spawnFlyInCharacter(emoji: string, imageSrc?: string) {
  const char = document.createElement('div')
  char.className = 'wink-character'
  if (imageSrc) {
    const img = document.createElement('img')
    img.src = imageSrc
    char.appendChild(img)
  } else {
    char.textContent = emoji
  }
  const from = CORNERS[Math.floor(Math.random() * CORNERS.length)]
  char.style.setProperty('--from-x', from.x)
  char.style.setProperty('--from-y', from.y)
  char.style.setProperty('--from-r', `${from.r}deg`)
  document.body.appendChild(char)
  setTimeout(() => char.remove(), 1400)
}

export function playCustomWinkEffect(imageSrc: string, soundSrc: string | null) {
  spawnFlyInCharacter('', imageSrc)
  if (soundSrc) {
    const audio = new Audio(soundSrc)
    audio.volume = 0.8
    audio.play().catch(() => playNudgeSound())
  } else {
    playNudgeSound()
  }
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
      spawnFlyInCharacter(wink.emoji)
      setTimeout(() => spawnParticles(wink.emoji, 10), 600)
      break
  }

  playWinkSound(wink)
}
