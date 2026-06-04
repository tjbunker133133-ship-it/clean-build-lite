import { useMemo, useState } from 'react'
import { useGPS } from '../hooks/useGPS'
import { useMissionSync } from '../context/MissionSyncContext'
import { BURST_MAX_CHARS } from '../lib/missionSync/comms'
import { buildTeammateIntelLines } from '../lib/missionSync/teammateIntel'
import { listMessageableTeammates, TEAM_QUICK_MESSAGES } from '../lib/missionSync/teamComms'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { fieldStatusRailBottomCss } from './hudLayout'
import MissionVoiceRecordButton from './MissionVoiceRecordButton'
import { touchFontSm, touchMinTarget } from './tokens'

function btn(primary = false): React.CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: 8,
    border: primary ? '1px solid rgba(94, 234, 212, 0.55)' : '1px solid #334155',
    background: primary ? 'rgba(4, 48, 42, 0.9)' : 'rgba(15, 23, 42, 0.85)',
    color: primary ? '#a7f3d0' : '#cbd5e1',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: touchMinTarget(false),
  }
}

/**
 * Map-first comms — tap teammate marker: situational readout + text + voice note.
 */
export default function TeammateMessageSheet() {
  const sync = useMissionSync()
  const gps = useGPS()
  const target = sync.activeCommsTarget
  const [text, setText] = useState('')
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)

  const teammatePresence = useMemo(() => {
    if (!target) return null
    return sync.teamPresence.find((p) => p.deviceId === target.deviceId) ?? null
  }, [target, sync.teamPresence])

  const intelLines = useMemo(() => {
    if (!teammatePresence || teammatePresence.lat == null || teammatePresence.lng == null) {
      return []
    }
    return buildTeammateIntelLines(teammatePresence, {
      lat: gps.lat,
      lng: gps.lng,
    })
  }, [teammatePresence, gps.lat, gps.lng])

  const meshLinked = useMemo(() => {
    if (!target) return false
    return listMessageableTeammates(sync.peers, sync.teamPresence, sync.deviceId).some(
      (t) => t.deviceId === target.deviceId && t.meshLinked,
    )
  }, [target, sync.peers, sync.teamPresence, sync.deviceId])

  if (!target || sync.role === 'idle') return null

  const send = (body: string) => {
    if (!meshLinked) return
    sync.queueOutboundConfirm(body, target.callsign)
    setText('')
    sync.clearActiveCommsTarget()
  }

  return (
    <div
      role="dialog"
      aria-label={`Message ${target.callsign}`}
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: fieldStatusRailBottomCss(),
        zIndex: 212,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          borderRadius: 12,
          border: '1px solid rgba(94, 234, 212, 0.45)',
          background: 'rgba(8, 18, 28, 0.96)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxHeight: 'min(52vh, 420px)',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ color: '#5eead4', fontSize: fontSm, fontWeight: 800, letterSpacing: '0.08em' }}>
              TEAMMATE
            </div>
            <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 800, marginTop: 4 }}>{target.callsign}</div>
          </div>
          <button type="button" style={btn()} onClick={() => sync.clearActiveCommsTarget()}>
            Close
          </button>
        </div>

        {intelLines.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 6,
            }}
          >
            {intelLines.map((line) => (
              <div
                key={line.id}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid #334155',
                }}
              >
                <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>{line.label}</div>
                <div style={{ color: '#e2e8f0', fontSize: fontSm, fontWeight: 700 }}>{line.value}</div>
              </div>
            ))}
          </div>
        ) : null}

        {!meshLinked ? (
          <p style={{ color: '#fbbf24', margin: 0, fontSize: fontSm, lineHeight: 1.35 }}>
            GPS on map — finish mission link to send text or voice on mesh (works offline on Wi‑Fi).
          </p>
        ) : (
          <p style={{ color: '#94a3b8', margin: 0, fontSize: fontSm, lineHeight: 1.35 }}>
            Hold purple — speak, release — HUD sends text; they hear it read aloud
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {TEAM_QUICK_MESSAGES.map((phrase) => (
            <button
              key={phrase}
              type="button"
              style={btn()}
              disabled={!meshLinked || !sync.teamCommsReady}
              onClick={() => send(phrase)}
            >
              {phrase}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <MissionVoiceRecordButton
            toCallsign={target.callsign}
            disabled={!meshLinked || !sync.teamCommsReady}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Custom message…"
            maxLength={BURST_MAX_CHARS}
            disabled={!meshLinked || !sync.teamCommsReady}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#f8fafc',
              fontSize: fontSm,
            }}
          />
          <button
            type="button"
            style={btn(true)}
            disabled={!meshLinked || !sync.teamCommsReady || !text.trim()}
            onClick={() => send(text)}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
