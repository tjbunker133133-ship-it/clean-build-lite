import { useMemo } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { topBarContentHeightPx } from './hudLayout'
import { touchFontSm } from './tokens'
import { getDeviceProfile } from '../runtime/deviceProfile'

/**
 * Field host — appears after sharing live map; shows when a watcher is connected.
 */
export default function WatcherPill() {
  const sync = useMissionSync()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)

  const pill = useMemo(() => {
    if (sync.role !== 'member' || !sync.supported) return null
    if (!sync.watchLinkShared && !sync.pendingObserverOfferEncoded) return null

    const observers = sync.peers.filter((p) => p.linkRole === 'observer')
    if (observers.length > 0) {
      const names = observers.map((p) => p.callsign?.trim() || 'Watcher').slice(0, 2)
      const extra = observers.length > 2 ? ` +${observers.length - 2}` : ''
      return {
        label: `Watcher live · ${names.join(', ')}${extra}`,
        live: true,
      }
    }

    return {
      label: 'Watch link sent — waiting',
      live: false,
    }
  }, [
    sync.role,
    sync.supported,
    sync.watchLinkShared,
    sync.pendingObserverOfferEncoded,
    sync.peers,
  ])

  if (!pill) return null

  return (
    <div
      aria-live="polite"
      style={{
        position: 'absolute',
        top: `calc(env(safe-area-inset-top, 0px) + ${topBarContentHeightPx() + 6}px)`,
        right: 12,
        zIndex: 207,
        pointerEvents: 'none',
        maxWidth: 'min(70vw, 260px)',
      }}
    >
      <div
        style={{
          padding: '4px 10px',
          borderRadius: 999,
          background: pill.live ? 'rgba(30, 58, 95, 0.88)' : 'rgba(30, 41, 59, 0.82)',
          border: pill.live
            ? '1px solid rgba(125, 211, 252, 0.45)'
            : '1px solid rgba(100, 116, 139, 0.4)',
          color: pill.live ? '#bae6fd' : '#94a3b8',
          fontSize: Math.max(10, fontSm - 1),
          fontWeight: 700,
          letterSpacing: '0.04em',
          lineHeight: 1.2,
          textAlign: 'right',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: pill.live ? 1 : 0.85,
        }}
        title={pill.label}
      >
        {pill.live ? '● ' : '◌ '}
        {pill.label}
      </div>
    </div>
  )
}
