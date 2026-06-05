import { useEffect, useMemo, useState } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { getCorridorOfflineSummary } from '../lib/corridorPrefetch'
import { useCorridorOffline } from '../hooks/useCorridorOffline'
import { useNavigationMonitor } from '../hooks/useNavigationMonitor'
import {
  buildMemberConnectionStatus,
  buildObserverConnectionStatus,
  buildRelayHealthSupplement,
  isFieldSessionBackgrounded,
} from '../lib/missionSync/fieldConnectionStatus'
import { linkRecoveryStatusLabel } from '../lib/missionSync/relayRecovery'
import { getDeviceProfile } from '../runtime/deviceProfile'
import {
  isFieldWakeLockHeld,
  isFieldWakeLockSupported,
  isFieldWakeLockWanted,
  subscribeFieldWakeLock,
} from '../runtime/fieldWakeLock'
import { fieldStatusRailBottomCss, HUD_Z_STATUS_RAIL } from './hudLayout'
import { touchFontSm } from './tokens'
import { getRuntimeActivityLevel } from '../runtime/runtimeActivityPolicy'

type RowTone = 'mesh' | 'observer' | 'ready' | 'warn' | 'nav'

const ROW_PRIORITY: Record<RowTone, number> = {
  nav: 0,
  warn: 1,
  mesh: 2,
  observer: 3,
  ready: 4,
}

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
  const [backgrounded, setBackgrounded] = useState(isFieldSessionBackgrounded)
  const [wakeHeld, setWakeHeld] = useState(isFieldWakeLockHeld())
  const [expanded, setExpanded] = useState(false)

  useEffect(() => subscribeFieldWakeLock(setWakeHeld), [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => setBackgrounded(isFieldSessionBackgrounded())
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const rows = useMemo(() => {
    const list: StatusRow[] = []
    const profile = getDeviceProfile()
    const inMission = sync.role !== 'idle'

    if (inMission && !profile.isStandalone) {
      list.push({
        id: 'browser-tab',
        label: 'Browser tab — Add to Home Screen for full-screen field mode',
        tone: 'warn',
      })
    }

    if (inMission && backgrounded) {
      list.push({
        id: 'background',
        label: 'App in background — mesh and voice may pause',
        tone: 'warn',
      })
    }

    if (inMission) {
      const recoveryLabel = linkRecoveryStatusLabel({
        linkRecoveryPending: sync.linkRecoveryPending,
        relayLinkState: sync.relayLinkState,
      })
      if (recoveryLabel) {
        list.push({
          id: 'link-recovery',
          label: recoveryLabel,
          tone: sync.relayLinkState === 'unavailable' ? 'warn' : 'warn',
        })
      }
      const relayHealth = buildRelayHealthSupplement(sync.relayLinkState)
      if (relayHealth && !sync.linkRecoveryPending && sync.peers.length === 0 && sync.teamCommsReady) {
        list.push({
          id: 'relay-health',
          label: relayHealth,
          tone: sync.relayLinkState === 'unavailable' ? 'warn' : 'warn',
        })
      }
    }

    if (inMission && isFieldWakeLockWanted()) {
      list.push({
        id: 'wake-lock',
        label: wakeHeld
          ? 'Screen awake for mission'
          : 'Display sleep possible — informational only',
        live: wakeHeld,
        tone: wakeHeld ? 'ready' : 'warn',
      })
    } else if (inMission && isFieldWakeLockSupported()) {
      list.push({
        id: 'wake-lock',
        label: 'Wake lock unsupported — display may sleep',
        tone: 'warn',
      })
    }

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

    if (
      sync.role === 'member' &&
      (sync.watchLinkShared || sync.pendingObserverOfferEncoded) &&
      sync.observerCount === 0
    ) {
      list.push({
        id: 'watch-wait',
        label: 'Watch link · waiting',
        tone: 'observer',
      })
    }

    const showMesh = sync.supported && sync.role !== 'idle'
    if (showMesh) {
      const isObserver = sync.role === 'observer'
      const observerCallsigns = sync.watcherRoster.map((w) =>
        w.live ? w.callsign : `${w.callsign} (relay)`,
      )
      const fieldMemberCount = sync.peers.filter((p) => p.linkRole === 'member').length

      if (isObserver) {
        const observerStatus = buildObserverConnectionStatus({
          phase: sync.phase,
          monitorLive: sync.monitorLive,
          monitorTargetCallsign: sync.monitorTargetCallsign,
          teamCommsReady: sync.teamCommsReady,
          peerCount: sync.peers.length,
          monitorTransport: sync.monitorTransport,
        })
        list.push({
          id: 'mesh',
          label: observerStatus.label,
          live: observerStatus.live,
          tone: 'observer',
        })
        if (observerStatus.supplement) {
          list.push({
            id: 'mesh-transport',
            label: observerStatus.supplement,
            tone: 'observer',
            live: observerStatus.live,
          })
        }
      } else {
        const memberStatus = buildMemberConnectionStatus({
          phase: sync.phase,
          peerCount: sync.peers.length,
          fieldMemberCount,
          observerCallsigns,
          teamCommsReady: sync.teamCommsReady,
          mapReady: sync.teamCorridorStatus === 'ready',
        })
        list.push({
          id: 'mesh',
          label: memberStatus.label,
          live: memberStatus.live,
          tone: 'mesh',
        })
        if (memberStatus.supplement) {
          list.push({
            id: 'mesh-transport',
            label: memberStatus.supplement,
            tone: 'warn',
            live: memberStatus.live,
          })
        }
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
    sync.watcherRoster,
    sync.peers,
    sync.phase,
    sync.pendingObserverOfferEncoded,
    sync.role,
    sync.supported,
    sync.teamCorridorStatus,
    sync.teamCommsReady,
    sync.linkRecoveryPending,
    sync.relayLinkState,
    sync.watchLinkShared,
    backgrounded,
    wakeHeld,
  ])

  const visibleRows = useMemo(() => {
    const activity = getRuntimeActivityLevel()
    const sorted = [...rows].sort((a, b) => ROW_PRIORITY[a.tone] - ROW_PRIORITY[b.tone])
    if (activity === 'BACKGROUND') {
      return sorted.filter(
        (r) =>
          r.tone === 'nav' ||
          r.tone === 'warn' ||
          r.id === 'background' ||
          r.id === 'offline-miss' ||
          r.id === 'link-recovery',
      )
    }
    if (activity === 'IDLE') {
      return sorted.filter((r) => r.tone !== 'ready' || r.live === true)
    }
    return sorted
  }, [rows])

  if (visibleRows.length === 0) return null

  const primary = visibleRows[0]!
  const secondary = visibleRows.slice(1)
  const hasMore = secondary.length > 0

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: fieldStatusRailBottomCss(),
        zIndex: HUD_Z_STATUS_RAIL,
        pointerEvents: 'auto',
        maxWidth: 'min(78vw, 300px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: expanded ? 5 : 0,
          padding: expanded ? '8px 11px' : '6px 10px',
          borderRadius: 10,
          background: 'rgba(8, 12, 14, 0.94)',
          border: '1px solid rgba(94, 234, 212, 0.28)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
        }}
      >
        <button
          type="button"
          onClick={() => hasMore && setExpanded((v) => !v)}
          aria-expanded={expanded}
          disabled={!hasMore}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: 0,
            margin: 0,
            border: 'none',
            background: 'transparent',
            cursor: hasMore ? 'pointer' : 'default',
            textAlign: 'left',
            width: '100%',
          }}
        >
          <StatusRowLine
            row={{
              ...primary,
              label: hasMore && !expanded ? `${primary.label} · +${secondary.length} more` : primary.label,
            }}
            fontSm={fontSm}
          />
          {hasMore ? (
            <span
              aria-hidden
              style={{
                marginTop: Math.max(2, fontSm * 0.2),
                fontSize: fontSm - 1,
                color: '#94a3b8',
                flexShrink: 0,
              }}
            >
              {expanded ? '▾' : '▸'}
            </span>
          ) : null}
        </button>
        {expanded
          ? secondary.map((row) => <StatusRowLine key={row.id} row={row} fontSm={fontSm} />)
          : null}
      </div>
    </div>
  )
}

function StatusRowLine({
  row,
  fontSm,
}: {
  row: StatusRow
  fontSm: number
}) {
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
