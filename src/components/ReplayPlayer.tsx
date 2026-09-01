import { useEffect, useState } from 'react'

export type ReplayEvent = { t: number; text: string }

export function ReplayPlayer({ events }: { events: ReplayEvent[] }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
    if (events.length < 2) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const start = events[0].t
    events.forEach((ev, i) => {
      timers.push(setTimeout(() => setIndex(i), ev.t - start))
    })
    return () => timers.forEach(clearTimeout)
  }, [events])

  return <p style={{ minHeight: '2.5em', fontStyle: 'italic', color: 'var(--text-secondary)' }}>{events[index]?.text}</p>
}
