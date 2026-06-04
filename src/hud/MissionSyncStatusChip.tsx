import { useMissionSync } from '../context/MissionSyncContext'
import { monitorTransportLabel } from '../lib/missionSync/monitorUx'
import { touchFontSm } from './tokens'
import { getDeviceProfile } from '../runtime/deviceProfile'

export default function MissionSyncStatusChip() {
  const sync = useMissionSync()
  const fontSm = touchFontSm(getDeviceProfile().interactionMode === 'mobile')

  if (!sync.supported || sync.role === 'idle') return null

  const isObserver = sync.role === 'observer'
  const meshConnected = sync.phase === 'connected' && sync.peers.length > 0
  const mapReady = sync.teamCorridorStatus === 'ready'

  let label: string
  let live = false

  if (isObserver) {
    live = sync.monitorLive
    if (live) {
      label = `MONITOR LIVE · ${sync.monitorTargetCallsign}`
    } else if (sync.phase === 'awaiting-host-answer' || sync.phase === 'connecting') {
      label = 'MONITOR CONNECTING'
    } else {
      label = 'MONITOR'
    }
  } else if (meshConnected) {
    live = true
    label = `MESH ${sync.peers.length}${sync.observerCount > 0 ? ` · ${sync.observerCount} OBS` : ''}${mapReady ? ' · MAP' : ''}`
  } else if (sync.phase === 'awaiting-host-answer') {
    label = 'MESH PENDING'
  } else {
    label = sync.observerCount > 0 ? `MESH ON · ${sync.observerCount} OBS` : 'MESH ON'
  }

  const sublabel =
    isObserver && live && sync.monitorTransport !== 'idle'
      ? monitorTransportLabel(sync.monitorTransport)
      : null

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(env(safe-area-inset-top, 0px) + 96px)',
        right: 12,
        zIndex: 208,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
      }}
    >
      <div
        style={{
          padding: '5px 10px',
          borderRadius: 999,
          background: live
            ? isObserver
              ? 'rgba(30, 58, 95, 0.92)'
              : 'rgba(4, 48, 42, 0.9)'
            : 'rgba(30, 41, 59, 0.88)',
          border: live
            ? isObserver
              ? '1px solid rgba(125, 211, 252, 0.55)'
              : '1px solid rgba(94, 234, 212, 0.5)'
            : '1px solid #475569',
          color: live ? (isObserver ? '#bae6fd' : '#86efac') : '#cbd5e1',
          fontSize: fontSm,
          fontWeight: 800,
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
      {sublabel ? (
        <div
          style={{
            padding: '3px 8px',
            borderRadius: 999,
            background: 'rgba(8, 12, 18, 0.78)',
            border: '1px solid #334155',
            color: '#94a3b8',
            fontSize: Math.max(9, fontSm - 2),
            fontWeight: 700,
            letterSpacing: '0.06em',
          }}
        >
          {sublabel}
        </div>
      ) : null}
    </div>
  )
}
