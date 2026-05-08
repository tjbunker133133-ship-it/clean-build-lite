import { useEffect, useState } from 'react'
import HudPanel from './HudPanel'
import { usePanelData } from '../context/PanelDataContext'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm } from './tokens'

function formatClock(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone,
  }).format(now)
}

function formatDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(now)
}

export default function ClockPanel() {
  const { locationTimeZone, panelsLocationBlocked } = usePanelData()
  const fallbackTz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC' : 'UTC'
  const activeTz = locationTimeZone ?? fallbackTz
  const [, setTick] = useState(0)

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  const now = new Date()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)

  return (
    <HudPanel
      panelId="clock"
      title="Clock"
      initialPos={{ x: 700, y: 60 }}
      initialWidth={220}
      minHeight={82}
    >
      {panelsLocationBlocked && (
        <div
          style={{
            fontSize: fontSm,
            color: '#f0b4bf',
            textAlign: 'center',
            marginBottom: 6,
            lineHeight: 1.35,
          }}
        >
          Enable location to use weather and elevation features
        </div>
      )}
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
        {formatClock(now, activeTz)}
      </div>
      <div
        style={{
          textAlign: 'center',
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: fontSm,
          letterSpacing: '0.14em',
          color: 'var(--cockpit-panel-subtle)',
          textTransform: 'uppercase',
        }}
      >
        {formatDate(now, activeTz)}
      </div>
      <div
        style={{
          textAlign: 'center',
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: isMobile ? 14 : 9,
          letterSpacing: '0.12em',
          color: 'var(--cockpit-panel-subtle)',
          textTransform: 'uppercase',
          marginTop: 2,
        }}
      >
        {locationTimeZone ? 'Location solar time' : 'Device timezone'}
      </div>
    </HudPanel>
  )
}
