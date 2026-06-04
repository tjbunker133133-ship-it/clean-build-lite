import { useMissionSync } from '../context/MissionSyncContext'
import { formatBurstLine } from '../lib/missionSync/teamComms'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm } from './tokens'

/**
 * Inbound mission message — accept before TTS, or latest alert.
 */
export default function TeamCommsToast() {
  const sync = useMissionSync()
  const pending = sync.pendingInboundBurst
  const burst = pending ?? sync.lastInboundTeamBurst
  const fontSm = touchFontSm(getDeviceProfile().interactionMode === 'mobile')

  if (!burst || sync.role === 'idle') return null

  const line = formatBurstLine(burst, sync.deviceId)
  const needsAccept = Boolean(pending)

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        top: 'calc(env(safe-area-inset-top, 0px) + 148px)',
        zIndex: 210,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          maxWidth: 420,
          width: '100%',
          padding: '10px 14px',
          borderRadius: 10,
          border: needsAccept
            ? '1px solid rgba(251, 191, 36, 0.65)'
            : '1px solid rgba(94, 234, 212, 0.55)',
          background: needsAccept ? 'rgba(45, 42, 18, 0.94)' : 'rgba(4, 48, 42, 0.94)',
          color: '#ecfdf5',
          fontSize: fontSm,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        }}
      >
        <span
          style={{
            display: 'block',
            color: needsAccept ? '#fde68a' : '#5eead4',
            letterSpacing: '0.08em',
            marginBottom: 4,
            fontWeight: 800,
          }}
        >
          {needsAccept ? 'INCOMING MESSAGE' : 'TEAM MESSAGE'}
        </span>
        {line}
        {needsAccept ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => sync.confirmInboundMessage()}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(74, 222, 128, 0.55)',
                background: 'rgba(4, 48, 42, 0.9)',
                color: '#86efac',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Accept (or say accept)
            </button>
            <button
              type="button"
              onClick={() => sync.skipInboundMessage()}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: 'rgba(15, 23, 42, 0.85)',
                color: '#94a3b8',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Skip
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => sync.dismissTeamCommsAlert()}
            style={{
              marginTop: 8,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}
