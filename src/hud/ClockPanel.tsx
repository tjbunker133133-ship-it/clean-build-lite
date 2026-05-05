import { useEffect, useState } from 'react'
import HudPanel from './HudPanel'

function formatClock(now: Date): string {
  return now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function formatDate(now: Date): string {
  return now.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ClockPanel() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <HudPanel
      panelId="clock"
      title="Clock"
      initialPos={{ x: 700, y: 60 }}
      initialWidth={220}
      minHeight={82}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 22,
          letterSpacing: '0.06em',
          color: '#c7cec6',
          textAlign: 'center',
          fontWeight: 700,
          padding: '6px 0',
          textShadow: '0 0 12px rgba(199,206,198,0.25)',
        }}
      >
        {formatClock(time)}
      </div>
      <div
        style={{
          textAlign: 'center',
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: 10,
          letterSpacing: '0.14em',
          color: 'var(--cockpit-panel-subtle)',
          textTransform: 'uppercase',
        }}
      >
        {formatDate(time)}
      </div>
      <div
        style={{
          textAlign: 'center',
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: 9,
          letterSpacing: '0.12em',
          color: 'var(--cockpit-panel-subtle)',
          textTransform: 'uppercase',
          marginTop: 2,
        }}
      >
        Local Time
      </div>
    </HudPanel>
  )
}
