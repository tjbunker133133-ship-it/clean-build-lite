import { useMissionSync } from '../context/MissionSyncContext'
import { touchFontSm } from './tokens'
import { getDeviceProfile } from '../runtime/deviceProfile'

export default function MissionSyncStatusChip() {
  const sync = useMissionSync()
  const fontSm = touchFontSm(getDeviceProfile().interactionMode === 'mobile')

  if (!sync.supported || sync.role === 'idle') return null

  const connected = sync.phase === 'connected' && sync.peers.length > 0
  const label = connected
    ? `MESH ${sync.peers.length}`
    : sync.phase === 'awaiting-host-answer'
      ? 'MESH PENDING'
      : sync.role === 'member'
        ? 'MESH ON'
        : 'MESH'

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(env(safe-area-inset-top, 0px) + 96px)',
        right: 12,
        zIndex: 208,
        pointerEvents: 'none',
        padding: '5px 10px',
        borderRadius: 999,
        background: connected ? 'rgba(4, 48, 42, 0.9)' : 'rgba(30, 41, 59, 0.88)',
        border: connected ? '1px solid rgba(94, 234, 212, 0.5)' : '1px solid #475569',
        color: connected ? '#86efac' : '#cbd5e1',
        fontSize: fontSm,
        fontWeight: 800,
        letterSpacing: '0.08em',
      }}
    >
      {label}
    </div>
  )
}
