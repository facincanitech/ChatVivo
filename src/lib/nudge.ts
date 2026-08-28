let audioCtx: AudioContext | null = null

function getContext() {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

export function playNudgeSound() {
  try {
    const ctx = getContext()
    const now = ctx.currentTime
    ;[0, 0.12].forEach((offset) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.15, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.1)
    })
  } catch {
    // audio not available (autoplay policy, unsupported browser) — fail silently
  }
}

export function triggerNudgeShake() {
  const el = document.querySelector('.app')
  if (!el) return
  el.classList.remove('nudging')
  // force reflow so the animation restarts if triggered twice in a row
  void (el as HTMLElement).offsetWidth
  el.classList.add('nudging')
  setTimeout(() => el.classList.remove('nudging'), 500)
}
