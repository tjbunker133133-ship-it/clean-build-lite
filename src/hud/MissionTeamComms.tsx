import { useEffect, useMemo, useState } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { BURST_MAX_CHARS } from '../lib/missionSync/comms'
import {
  formatBurstLine,
  listMessageableTeammates,
  TEAM_QUICK_MESSAGES,
} from '../lib/missionSync/teamComms'
import { getDeviceProfile } from '../runtime/deviceProfile'
import MissionVoiceRecordButton from './MissionVoiceRecordButton'
import { touchGapSm, touchMinTarget } from './tokens'

function btnStyle(primary = false, active = false): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: 8,
    border: active
      ? '1px solid rgba(251, 191, 36, 0.65)'
      : primary
        ? '1px solid rgba(94, 234, 212, 0.55)'
        : '1px solid #334155',
    background: active
      ? 'rgba(69, 52, 8, 0.55)'
      : primary
        ? 'rgba(4, 48, 42, 0.85)'
        : 'rgba(15, 23, 42, 0.75)',
    color: active ? '#fde68a' : primary ? '#a7f3d0' : '#cbd5e1',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: touchMinTarget(false),
  }
}

type Props = {
  isObserver: boolean
}

export default function MissionTeamComms({ isObserver }: Props) {
  const sync = useMissionSync()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const [text, setText] = useState('')
  const [targetCallsign, setTargetCallsign] = useState('')

  const teammates = useMemo(
    () => listMessageableTeammates(sync.peers, sync.teamPresence, sync.deviceId),
    [sync.peers, sync.teamPresence, sync.deviceId],
  )

  useEffect(() => {
    if (sync.activeCommsTarget?.callsign) {
      setTargetCallsign(sync.activeCommsTarget.callsign)
    }
  }, [sync.activeCommsTarget?.callsign])

  const thread = useMemo(() => sync.teamBursts.slice(0, 8), [sync.teamBursts])

  const selected = teammates.find((t) => t.callsign === targetCallsign)
  const canSendToTarget = !targetCallsign || (selected?.meshLinked ?? false)

  const readyLabel = sync.teamCommsReady
    ? isObserver
      ? 'Receiving field team messages (mesh or relay).'
      : 'Works on local mesh without cell service when teammates are linked.'
    : isObserver
      ? 'Connect to the field mission to hear team messages.'
      : 'Link a teammate (mission code or bundle) to enable mesh messages.'

  const send = (body: string, to?: string) => {
    if (to && !teammates.find((t) => t.callsign === to)?.meshLinked) {
      return
    }
    sync.sendTeamBurst(body, to)
    setText('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
      <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.45, fontSize: '0.88em' }}>{readyLabel}</p>
      {sync.missionCommsPrefs.handsFree ? (
        <p style={{ color: '#64748b', margin: 0, fontSize: '0.82em' }}>
          Hands-free confirm enabled — say accept to send after voice compose.
        </p>
      ) : null}
      {sync.missionCommsFlowPhase !== 'idle' ? (
        <p style={{ color: '#64748b', margin: 0, fontSize: '0.82em' }}>
          Voice flow active — follow prompts or use Send / Cancel bar at bottom.
        </p>
      ) : null}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82em', color: '#64748b' }}>
        <input
          type="checkbox"
          checked={sync.missionCommsPrefs.inboundConfirm}
          onChange={(e) => sync.setMissionCommsPrefs({ inboundConfirm: e.target.checked })}
        />
        Vibrate on arrival · say accept to hear message
      </label>

      {!isObserver ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            style={btnStyle(true, !targetCallsign)}
            disabled={!sync.teamCommsReady}
            onClick={() => {
              setTargetCallsign('')
              sync.clearActiveCommsTarget()
            }}
          >
            Whole mission
          </button>
          {teammates.map((t) => (
            <button
              key={t.deviceId}
              type="button"
              style={btnStyle(false, targetCallsign === t.callsign)}
              disabled={!sync.teamCommsReady && !t.onMap}
              title={
                t.meshLinked
                  ? 'Mesh linked — tap map marker to message'
                  : 'On map — link mission to send'
              }
              onClick={() => {
                setTargetCallsign(t.callsign)
                sync.openCommsForTeammate(t.deviceId, t.callsign)
              }}
            >
              {t.callsign}
              {t.onMap ? ' 📍' : ''}
              {!t.meshLinked ? ' (link)' : ''}
            </button>
          ))}
        </div>
      ) : null}

      {targetCallsign && !canSendToTarget ? (
        <p style={{ color: '#fbbf24', margin: 0, fontSize: '0.85em', lineHeight: 1.4 }}>
          {targetCallsign} is on your map but not mesh-linked — use Mission Link above to finish joining.
        </p>
      ) : null}

      {thread.length > 0 ? (
        <ul
          style={{
            margin: 0,
            padding: '8px 10px',
            listStyle: 'none',
            borderRadius: 8,
            border: '1px solid #334155',
            background: 'rgba(15, 23, 42, 0.65)',
            maxHeight: 140,
            overflowY: 'auto',
          }}
        >
          {thread.map((b) => (
            <li
              key={`${b.deviceId}-${b.sentAt}`}
              style={{
                color: '#e2e8f0',
                fontSize: '0.85em',
                lineHeight: 1.4,
                padding: '4px 0',
                borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
              }}
            >
              {formatBurstLine(b, sync.deviceId)}
            </li>
          ))}
        </ul>
      ) : null}

      {!isObserver ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TEAM_QUICK_MESSAGES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                style={btnStyle()}
                disabled={!sync.teamCommsReady || !canSendToTarget}
                onClick={() => send(phrase, targetCallsign.trim() || undefined)}
              >
                {phrase}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <MissionVoiceRecordButton
              toCallsign={targetCallsign.trim() || undefined}
              disabled={!sync.teamCommsReady || !canSendToTarget}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                targetCallsign ? `Message ${targetCallsign}…` : 'Message whole mission…'
              }
              maxLength={BURST_MAX_CHARS}
              disabled={!sync.teamCommsReady || !canSendToTarget}
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#f8fafc',
              }}
            />
            <button
              type="button"
              style={btnStyle(true)}
              disabled={!sync.teamCommsReady || !canSendToTarget || !text.trim()}
              onClick={() => send(text, targetCallsign.trim() || undefined)}
            >
              Send
            </button>
          </div>
          <button
            type="button"
            style={btnStyle(true)}
            disabled={!sync.teamCommsReady}
            onClick={() => sync.sendTeamCheckIn()}
          >
            Send check-in OK
          </button>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.8em', lineHeight: 1.4 }}>
            Tap Send for instant mesh delivery · Voice commands use confirm bar at bottom
          </p>
        </>
      ) : (
        <p style={{ color: '#64748b', margin: 0, fontSize: '0.85em' }}>
          Watchers hear field team messages automatically. Field members send from their device.
        </p>
      )}
    </div>
  )
}
