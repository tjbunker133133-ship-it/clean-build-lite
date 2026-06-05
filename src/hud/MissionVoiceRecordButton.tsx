import { useCallback, useRef, useState } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { parseTeamMessageVoice } from '../lib/missionSync/teamComms'
import { captureMissionVoiceTranscript, stopMissionVoiceCapture } from '../lib/missionSync/missionVoiceMessage'
import { touchMinTarget } from './tokens'

type Props = {
  toCallsign?: string
  disabled?: boolean
  compact?: boolean
}

/**
 * Optional hold-to-speak — STT then sender confirm (say accept). Disable in Mission Link prefs.
 */
export default function MissionVoiceRecordButton({ toCallsign, disabled, compact }: Props) {
  const sync = useMissionSync()
  const [recording, setRecording] = useState(false)
  const sessionRef = useRef<Promise<string | null> | null>(null)
  const busyRef = useRef(false)
  const showHold = sync.missionCommsPrefs.holdButton

  const label = recording
    ? 'Release when done'
    : compact
      ? 'Hold to speak'
      : toCallsign
        ? `Hold → ${toCallsign}`
        : 'Hold to speak to mission'

  const endRecord = useCallback(async () => {
    stopMissionVoiceCapture()
    setRecording(false)
    const pending = sessionRef.current
    sessionRef.current = null
    if (!pending) {
      busyRef.current = false
      return
    }
    const raw = await pending
    busyRef.current = false
    if (!raw) return

    const parsed = parseTeamMessageVoice(raw.toLowerCase(), raw)
    const text = parsed?.text ?? raw
    const to = toCallsign?.trim() || parsed?.callsign
    sync.queueOutboundConfirm(text, to)
    sync.clearActiveCommsTarget()
  }, [sync, toCallsign])

  const start = useCallback(async () => {
    if (disabled || busyRef.current || recording) return
    busyRef.current = true
    setRecording(true)
    sessionRef.current = captureMissionVoiceTranscript()
  }, [disabled, recording])

  const cancel = useCallback(() => {
    stopMissionVoiceCapture()
    sessionRef.current = null
    setRecording(false)
    busyRef.current = false
  }, [])

  if (!showHold) return null

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault()
        void start()
      }}
      onPointerUp={() => void endRecord()}
      onPointerLeave={() => {
        if (recording) void endRecord()
      }}
      onPointerCancel={() => cancel()}
      style={{
        padding: compact ? '8px 12px' : '10px 14px',
        borderRadius: 8,
        border: recording
          ? '1px solid rgba(248, 113, 113, 0.65)'
          : '1px solid rgba(167, 139, 250, 0.55)',
        background: recording ? 'rgba(69, 10, 10, 0.55)' : 'rgba(46, 16, 72, 0.75)',
        color: recording ? '#fecaca' : '#e9d5ff',
        fontSize: 12,
        fontWeight: 800,
        cursor: disabled ? 'not-allowed' : 'pointer',
        minHeight: touchMinTarget(false),
        opacity: disabled ? 0.5 : 1,
        touchAction: 'none',
      }}
    >
      {label}
    </button>
  )
}
