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
  const [multiTargets, setMultiTargets] = useState<string[]>([])

  const teammates = useMemo(
    () => listMessageableTeammates(sync.peers, sync.teamPresence, sync.deviceId),
    [sync.peers, sync.teamPresence, sync.deviceId],
  )

  useEffect(() => {
    if (sync.activeCommsTarget?.callsign) {
      setTargetCallsign(sync.activeCommsTarget.callsign)
    }
  }, [sync.activeCommsTarget?.callsign])

  useEffect(() => {
    if (
      targetCallsign &&
      !teammates.find((t) => t.callsign === targetCallsign && t.meshLinked)
    ) {
      setTargetCallsign('')
      sync.clearActiveCommsTarget()
    }
    setMultiTargets((prev) =>
      prev.filter((c) => teammates.find((t) => t.callsign === c && t.meshLinked)),
    )
  }, [teammates, targetCallsign, sync.clearActiveCommsTarget])

  const linkedTeammates = useMemo(
    () => teammates.filter((t) => t.meshLinked),
    [teammates],
  )
  const mapOnlyTeammates = useMemo(
    () => teammates.filter((t) => t.onMap && !t.meshLinked),
    [teammates],
  )

  const thread = useMemo(() => sync.teamBursts.slice(0, 8), [sync.teamBursts])

  const selected = linkedTeammates.find((t) => t.callsign === targetCallsign)
  const canSendToTarget =
    multiTargets.length > 0
      ? multiTargets.every((c) => linkedTeammates.some((t) => t.callsign === c))
      : !targetCallsign || Boolean(selected)

  const recipientLabel =
    multiTargets.length > 0
      ? multiTargets.join(', ')
      : targetCallsign.trim() || 'whole mission'

  const inCommsRole = sync.role === 'member' || sync.role === 'observer'

  const readyLabel = sync.teamCommsReady
    ? isObserver
      ? 'Receiving field team messages (mesh or relay).'
      : 'Works on local mesh without cell service when teammates are linked.'
    : isObserver
      ? 'Connect to the field mission to hear team messages.'
      : inCommsRole
        ? 'Mission active — messages queue until a teammate links (mission code or join bundle above).'
        : 'Link a teammate (mission code or bundle) to enable mesh messages.'

  const send = (body: string, to?: string) => {
    if (multiTargets.length > 0) {
      sync.sendTeamBurstMany(body, multiTargets)
      setText('')
      return
    }
    if (to && !linkedTeammates.some((t) => t.callsign === to)) {
      return
    }
    sync.sendTeamBurst(body, to)
    setText('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
      <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.45, fontSize: '0.88em' }}>{readyLabel}</p>
      {sync.queuedBurstCount > 0 ? (
        <p style={{ color: '#fde68a', margin: 0, fontSize: '0.82em' }}>
          {sync.queuedBurstCount} message{sync.queuedBurstCount === 1 ? '' : 's'} queued — sends when mesh or relay returns.
        </p>
      ) : null}
      {sync.linkRecoveryPending ? (
        <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.82em' }}>
          Reconnecting mission link…
        </p>
      ) : null}
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
            disabled={!inCommsRole}
            onClick={() => {
              setTargetCallsign('')
              setMultiTargets([])
              sync.clearActiveCommsTarget()
            }}
          >
            Whole mission
          </button>
          {linkedTeammates.map((t) => (
            <button
              key={t.deviceId}
              type="button"
              style={btnStyle(
                false,
                targetCallsign === t.callsign || multiTargets.includes(t.callsign),
              )}
              disabled={!inCommsRole}
              title="Tap to select · Shift+tap for multi-select"
              onClick={(e) => {
                if (e.shiftKey) {
                  setTargetCallsign('')
                  setMultiTargets((prev) =>
                    prev.includes(t.callsign)
                      ? prev.filter((c) => c !== t.callsign)
                      : [...prev, t.callsign],
                  )
                  return
                }
                setMultiTargets([])
                setTargetCallsign(t.callsign)
                sync.openCommsForTeammate(t.deviceId, t.callsign)
              }}
            >
              {t.callsign}
              {t.onMap ? ' 📍' : ''}
            </button>
          ))}
          {mapOnlyTeammates.length > 0 ? (
            <span style={{ fontSize: '0.78em', color: '#64748b', lineHeight: 1.35 }}>
              On map only (link mission to send): {mapOnlyTeammates.map((t) => t.callsign).join(', ')}
            </span>
          ) : null}
        </div>
      ) : null}

      {multiTargets.length > 0 ? (
        <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.82em' }}>
          Sending to: {multiTargets.join(', ')} (Shift+tap teammates to adjust)
        </p>
      ) : null}

      {targetCallsign && !canSendToTarget && multiTargets.length === 0 ? (
        <p style={{ color: '#fbbf24', margin: 0, fontSize: '0.85em', lineHeight: 1.4 }}>
          {targetCallsign} is on your map but not mesh-linked — use Mission Link above to finish joining.
        </p>
      ) : null}

      {thread.length > 0 ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            style={{ ...btnStyle(), padding: '4px 10px', minHeight: 32 }}
            onClick={() => sync.clearMissionLog()}
          >
            Clear mission log
          </button>
        </div>
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
                disabled={!inCommsRole || !canSendToTarget}
                onClick={() => send(phrase, targetCallsign.trim() || undefined)}
              >
                {phrase}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <MissionVoiceRecordButton
              toCallsign={targetCallsign.trim() || undefined}
              disabled={!inCommsRole || !canSendToTarget}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                multiTargets.length > 0
                  ? `Message ${recipientLabel}…`
                  : targetCallsign
                    ? `Message ${targetCallsign}…`
                    : 'Message whole mission…'
              }
              maxLength={BURST_MAX_CHARS}
              disabled={!inCommsRole || !canSendToTarget}
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
              disabled={!inCommsRole || !canSendToTarget || !text.trim()}
              onClick={() =>
                send(text, multiTargets.length > 0 ? undefined : targetCallsign.trim() || undefined)
              }
            >
              Send
            </button>
          </div>
          <button
            type="button"
            style={btnStyle(true)}
            disabled={!inCommsRole}
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
