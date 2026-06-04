import { useMemo } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { topBarContentHeightPx } from './hudLayout'
import { touchFontSm } from './tokens'
import { getDeviceProfile } from '../runtime/deviceProfile'

/**
 * Field host only — shows who is watching (callsign), no device ids or contact info.
 */
export default function WatcherPill() {
  const sync = useMissionSync()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)

  const { label, live, waiting } = useMemo(() => {
    if (sync.role !== 'member' || !sync.supported) {
      return { label: null, live: false, waiting: false }
    }

    const observers = sync.peers.filter((p) => p.linkRole === 'observer')
    if (observers.length > 0) {
      const names = observers.map((p) => p.callsign?.trim() || 'Watcher').slice(0, 3)
      const extra = observers.length > 3 ? ` +${observers.length - 3}` : ''
      return {
        label: `Watching · ${names.join(', ')}${extra}`,
        live: true,
        waiting: false,
      }
    }

    if (
      sync.pendingObserverOfferEncoded &&
      sync.observerSignalingAvailable &&
      sync.phase !== 'idle'
    ) {
      return { label: 'Watch link ready — waiting for tap', live: false, waiting: true }
    }

    return { label: null, live: false, waiting: false }
  }, [
    sync.role,
    sync.supported,
    sync.peers,
    sync.pendingObserverOfferEncoded,
    sync.observerSignalingAvailable,
    sync.phase,
  ])

  if (!label) return null

  return (
    <div
      aria-live="polite"
      style={{
        position: 'absolute',
        top: `calc(env(safe-area-inset-top, 0px) + ${topBarContentHeightPx() + 6}px)`,
        right: 12,
        zIndex: 207,
        pointerEvents: 'none',
        maxWidth: 'min(72vw, 280px)',
      }}
    >
      <div
        style={{
          padding: '5px 12px',
          borderRadius: 999,
          background: live
            ? 'rgba(30, 58, 95, 0.94)'
            : 'rgba(45, 42, 18, 0.92)',
          border: live
            ? '1px solid rgba(125, 211, 252, 0.55)'
            : '1px solid rgba(251, 191, 36, 0.45)',
          color: live ? '#e0f2fe' : '#fde68a',
          fontSize: fontSm,
          fontWeight: 800,
          letterSpacing: '0.06em',
          lineHeight: 1.25,
          textAlign: 'right',
          boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={label}
      >
        {live ? '● ' : waiting ? '◌ ' : ''}
        {label}
      </div>
    </div>
  )
}
