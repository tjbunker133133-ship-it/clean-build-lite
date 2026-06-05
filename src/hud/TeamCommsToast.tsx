import type { CSSProperties, ReactNode } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { formatBurstLine } from '../lib/missionSync/teamComms'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { teamCommsToastBottomCss, HUD_Z_TEAM_COMMS } from './hudLayout'
import { touchFontSm } from './tokens'

/**
 * Team message alerts — inbound (listen) and outbound (confirm send). Sits above status rail.
 */
export default function TeamCommsToast() {
  const sync = useMissionSync()
  const outbound = sync.pendingOutboundConfirm
  const pendingIn = sync.pendingInboundBurst
  const inbound = pendingIn ?? sync.lastInboundTeamBurst
  const fontSm = touchFontSm(getDeviceProfile().interactionMode === 'mobile')

  if (sync.role === 'idle') return null
  if (!outbound && !inbound) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: teamCommsToastBottomCss(),
        zIndex: HUD_Z_TEAM_COMMS,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {outbound ? (
        <CommsCard
          fontSm={fontSm}
          tone="outbound"
          title={`SEND TO ${outbound.label.toUpperCase()}`}
          body={outbound.body}
        >
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => sync.confirmOutboundMessage()}
              style={acceptBtn}
            >
              Send
            </button>
            <button type="button" onClick={() => sync.cancelOutboundMessage()} style={skipBtn}>
              Cancel
            </button>
          </div>
        </CommsCard>
      ) : null}

      {inbound && !outbound ? (
        <CommsCard
          fontSm={fontSm}
          tone={pendingIn ? 'inbound-pending' : 'inbound'}
          title={pendingIn ? 'INCOMING MESSAGE' : 'TEAM MESSAGE'}
          body={formatBurstLine(inbound, sync.deviceId)}
        >
          {pendingIn ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" onClick={() => sync.confirmInboundMessage()} style={acceptBtn}>
                Listen
              </button>
              <button type="button" onClick={() => sync.skipInboundMessage()} style={skipBtn}>
                Skip
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => sync.dismissTeamCommsAlert()}
              style={{ ...skipBtn, marginTop: 8 }}
            >
              Dismiss
            </button>
          )}
        </CommsCard>
      ) : null}
    </div>
  )
}

const acceptBtn: CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid rgba(74, 222, 128, 0.55)',
  background: 'rgba(4, 48, 42, 0.9)',
  color: '#86efac',
  fontWeight: 800,
  cursor: 'pointer',
}

const skipBtn: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #334155',
  background: 'rgba(15, 23, 42, 0.85)',
  color: '#94a3b8',
  fontWeight: 700,
  cursor: 'pointer',
}

function CommsCard({
  fontSm,
  tone,
  title,
  body,
  children,
}: {
  fontSm: number
  tone: 'outbound' | 'inbound-pending' | 'inbound'
  title: string
  body: string
  children: ReactNode
}) {
  const border =
    tone === 'outbound'
      ? '1px solid rgba(94, 234, 212, 0.55)'
      : tone === 'inbound-pending'
        ? '1px solid rgba(251, 191, 36, 0.65)'
        : '1px solid rgba(94, 234, 212, 0.35)'
  const bg =
    tone === 'outbound'
      ? 'rgba(4, 48, 42, 0.94)'
      : tone === 'inbound-pending'
        ? 'rgba(45, 42, 18, 0.94)'
        : 'rgba(8, 18, 24, 0.92)'
  const accent =
    tone === 'inbound-pending' ? '#fde68a' : tone === 'outbound' ? '#5eead4' : '#94a3b8'

  return (
    <div
      style={{
        pointerEvents: 'auto',
        maxWidth: 420,
        width: '100%',
        margin: '0 auto',
        padding: '10px 14px',
        borderRadius: 10,
        border,
        background: bg,
        color: '#ecfdf5',
        fontSize: fontSm,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
    >
      <span
        style={{
          display: 'block',
          color: accent,
          letterSpacing: '0.08em',
          marginBottom: 4,
          fontWeight: 800,
          fontSize: Math.max(10, fontSm - 1),
        }}
      >
        {title}
      </span>
      {body}
      {children}
    </div>
  )
}
