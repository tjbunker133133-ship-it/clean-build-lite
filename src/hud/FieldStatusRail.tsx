import { useMemo } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { getCorridorOfflineSummary } from '../lib/corridorPrefetch'
import { useCorridorOffline } from '../hooks/useCorridorOffline'
import { useNavigationMonitor } from '../hooks/useNavigationMonitor'
import { monitorTransportLabel } from '../lib/missionSync/monitorUx'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { fieldStatusRailBottomCss } from './hudLayout'
import { touchFontSm } from './tokens'

type RowTone = 'mesh' | 'observer' | 'ready' | 'warn' | 'nav'

type StatusRow = {
  id: string
  label: string
  live?: boolean
  tone: RowTone
}

function compactNavAdvisory(text: string): string {
  if (text.includes('exceeded path')) return 'Off route · path deviation'
  if (text.includes('corridor band')) return 'Off route · outside corridor'
  if (text.includes('far from next waypoint')) return 'Off route · far from path'
  if (text.includes('offline map edge')) return 'Near offline map edge'
  if (text.includes('Near corridor edge')) return 'Near offline map edge'
  return text.length > 40 ? `${text.slice(0, 38)}…` : text
}

/**
 * Single bottom-left status card: navigation, mesh, and offline map (no overlapping pills).
 */
export default function FieldStatusRail() {
  const sync = useMissionSync()
  const corridor = useCorridorOffline()
  const nav = useNavigationMonitor()
  const offlineMap = getCorridorOfflineSummary()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)

  const rows = useMemo(() => {
    const list: StatusRow[] = []

    const navAdvisory =
      nav.arrivalCandidate != null
        ? null
        : nav.offRouteAdvisory ??
          (corridor.approachingEdge ? 'Approaching offline map edge' : nav.corridorAlert)

    if (navAdvisory) {
      list.push({
        id: 'nav',
        label: compactNavAdvisory(navAdvisory),
        tone: 'nav',
      })
    }

    const showMesh = sync.supported && sync.role !== 'idle'
    if (showMesh) {
      const isObserver = sync.role === 'observer'
      const meshConnected = sync.phase === 'connected' && sync.peers.length > 0
      const mapReady = sync.teamCorridorStatus === 'ready'
      let meshLabel: string
      let meshLive = false

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

      list.push({
        id: 'mesh',
        label: meshLabel,
        live: meshLive,
        tone: isObserver ? 'observer' : 'mesh',
      })

      if (isObserver && meshLive && sync.monitorTransport !== 'idle') {
        list.push({
          id: 'mesh-transport',
          label: monitorTransportLabel(sync.monitorTransport),
          tone: 'observer',
        })
      }
    }

    if (corridor.prefetching) {
      list.push({ id: 'offline-prefetch', label: 'Caching offline map…', tone: 'warn' })
    } else if (offlineMap.ready) {
      list.push({
        id: 'offline-ready',
        label: `Offline map · ${offlineMap.tilesLoaded} tiles`,
        live: true,
        tone: 'ready',
      })
    } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
      list.push({ id: 'offline-miss', label: 'Offline · no tiles cached', tone: 'warn' })
    }

    return list
  }, [
    corridor.approachingEdge,
    corridor.prefetching,
    nav.arrivalCandidate,
    nav.corridorAlert,
    nav.offRouteAdvisory,
    offlineMap.ready,
    offlineMap.tilesLoaded,
    sync.monitorLive,
    sync.monitorTargetCallsign,
    sync.monitorTransport,
    sync.observerCount,
    sync.peers.length,
    sync.phase,
    sync.role,
    sync.supported,
    sync.teamCorridorStatus,
  ])

  if (rows.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: fieldStatusRailBottomCss(),
        zIndex: 204,
        pointerEvents: 'none',
        maxWidth: 'min(78vw, 300px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          padding: '8px 11px',
          borderRadius: 10,
          background: 'rgba(8, 12, 14, 0.94)',
          border: '1px solid rgba(94, 234, 212, 0.28)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
        }}
      >
        {rows.map((row) => (
          <StatusRowLine key={row.id} row={row} fontSm={fontSm} />
        ))}
      </div>
    </div>
  )
}

function StatusRowLine({ row, fontSm }: { row: StatusRow; fontSm: number }) {
  const dotColor =
    row.tone === 'nav'
      ? '#fbbf24'
      : row.tone === 'warn'
        ? '#fbbf24'
        : row.tone === 'ready'
          ? '#7dffa8'
          : row.tone === 'observer'
            ? row.live
              ? '#7dd3fc'
              : '#94a3b8'
            : row.live
              ? '#7dffa8'
              : '#94a3b8'

  const textColor =
    row.tone === 'nav'
      ? '#fde68a'
      : row.tone === 'warn'
        ? '#fde68a'
        : row.tone === 'ready'
          ? '#a7f3d0'
          : row.tone === 'observer'
            ? row.live
              ? '#bae6fd'
              : '#cbd5e1'
            : row.live
              ? '#86efac'
              : '#cbd5e1'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        lineHeight: 1.3,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          marginTop: Math.max(4, fontSm * 0.35),
          flexShrink: 0,
          background: dotColor,
          boxShadow: row.live ? `0 0 6px ${dotColor}88` : undefined,
        }}
      />
      <span
        style={{
          fontSize: fontSm,
          fontWeight: row.tone === 'nav' ? 800 : 700,
          letterSpacing: '0.04em',
          color: textColor,
        }}
      >
        {row.label}
      </span>
    </div>
  )
}
