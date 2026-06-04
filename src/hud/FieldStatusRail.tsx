import { useMissionSync } from '../context/MissionSyncContext'
import { getCorridorOfflineSummary } from '../lib/corridorPrefetch'
import { useCorridorOffline } from '../hooks/useCorridorOffline'
import { monitorTransportLabel } from '../lib/missionSync/monitorUx'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { fieldStatusRailBottomCss } from './hudLayout'
import { touchFontSm } from './tokens'

/**
 * Compact mission + offline map status — bottom-left so the top bar stays clean.
 */
export default function FieldStatusRail() {
  const sync = useMissionSync()
  const corridor = useCorridorOffline()
  const offlineMap = getCorridorOfflineSummary()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)

  const offlineMapLabel = corridor.prefetching
    ? 'Offline map caching…'
    : offlineMap.ready
      ? `Offline map · ${offlineMap.tilesLoaded} tiles`
      : typeof navigator !== 'undefined' && !navigator.onLine
        ? 'Offline — no tiles cached'
        : null

  const showMesh = sync.supported && sync.role !== 'idle'
  if (!showMesh && !offlineMapLabel) return null

  let meshLabel: string | null = null
  let meshLive = false
  let meshObserver = false

  if (showMesh) {
    const isObserver = sync.role === 'observer'
    meshObserver = isObserver
    const meshConnected = sync.phase === 'connected' && sync.peers.length > 0
    const mapReady = sync.teamCorridorStatus === 'ready'

    if (isObserver) {
      meshLive = sync.monitorLive
      meshLabel = meshLive
        ? `Monitor · ${sync.monitorTargetCallsign}`
        : sync.phase === 'awaiting-host-answer' || sync.phase === 'connecting'
          ? 'Monitor connecting'
          : 'Monitor standby'
    } else if (meshConnected) {
      meshLive = true
      meshLabel = `Mesh ${sync.peers.length}${sync.observerCount > 0 ? ` · ${sync.observerCount} obs` : ''}${mapReady ? ' · map' : ''}`
    } else if (sync.phase === 'awaiting-host-answer') {
      meshLabel = 'Mesh pending'
    } else {
      meshLabel = sync.observerCount > 0 ? `Mesh on · ${sync.observerCount} obs` : 'Mesh on'
    }
  }

  const meshSublabel =
    meshObserver && meshLive && sync.monitorTransport !== 'idle'
      ? monitorTransportLabel(sync.monitorTransport)
      : null

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: fieldStatusRailBottomCss(),
        zIndex: 204,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6,
        maxWidth: 'min(72vw, 280px)',
      }}
    >
      {meshLabel ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
          <StatusPill
            label={meshLabel}
            live={meshLive}
            tone={meshObserver ? 'observer' : 'mesh'}
            fontSm={fontSm}
          />
          {meshSublabel ? (
            <span
              style={{
                fontSize: Math.max(10, fontSm - 2),
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: '#94a3b8',
                paddingLeft: 4,
              }}
            >
              {meshSublabel}
            </span>
          ) : null}
        </div>
      ) : null}
      {offlineMapLabel ? (
        <StatusPill
          label={offlineMapLabel}
          live={offlineMap.ready}
          tone={offlineMap.ready ? 'ready' : 'warn'}
          fontSm={fontSm}
        />
      ) : null}
    </div>
  )
}

function StatusPill({
  label,
  live,
  tone,
  fontSm,
}: {
  label: string
  live: boolean
  tone: 'mesh' | 'observer' | 'ready' | 'warn'
  fontSm: number
}) {
  const bg =
    tone === 'observer'
      ? live
        ? 'rgba(30, 58, 95, 0.94)'
        : 'rgba(30, 41, 59, 0.9)'
      : tone === 'ready'
        ? 'rgba(4, 48, 42, 0.94)'
        : tone === 'warn'
          ? 'rgba(40, 32, 8, 0.94)'
          : live
            ? 'rgba(4, 48, 42, 0.92)'
            : 'rgba(30, 41, 59, 0.9)'

  const border =
    tone === 'observer'
      ? live
        ? 'rgba(125, 211, 252, 0.55)'
        : '#475569'
      : tone === 'ready'
        ? 'rgba(94, 234, 212, 0.5)'
        : tone === 'warn'
          ? 'rgba(251, 191, 36, 0.5)'
          : live
            ? 'rgba(94, 234, 212, 0.5)'
            : '#475569'

  const color =
    tone === 'observer'
      ? live
        ? '#bae6fd'
        : '#cbd5e1'
      : tone === 'ready'
        ? '#a7f3d0'
        : tone === 'warn'
          ? '#fde68a'
          : live
            ? '#86efac'
            : '#cbd5e1'

  return (
    <div
      style={{
        padding: '5px 11px',
        borderRadius: 8,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontSize: fontSm,
        fontWeight: 800,
        letterSpacing: '0.05em',
        lineHeight: 1.25,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      {label}
    </div>
  )
}
