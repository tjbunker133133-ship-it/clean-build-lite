import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import {
  getPermissionSnapshot,
  type PermissionStateLike,
} from '../lib/devicePermissions'
import {
  evaluateInMissionReadiness,
  evaluatePreMissionReadiness,
  readinessBandColor,
  type MissionReadinessCheck,
} from '../lib/missionSync/missionReadiness'
import { getDeviceProfile } from '../runtime/deviceProfile'
import {
  isFieldWakeLockHeld,
  isFieldWakeLockSupported,
  isFieldWakeLockWanted,
  subscribeFieldWakeLock,
} from '../runtime/fieldWakeLock'
import { touchFontSm } from './tokens'

type Props = {
  /** Pre-mission gate vs active mission continuity checks. */
  mode: 'pre-mission' | 'in-mission'
}

function checkColor(severity: MissionReadinessCheck['severity']): string {
  if (severity === 'ok') return '#94a3b8'
  if (severity === 'warn') return '#fde68a'
  return '#fecaca'
}

export default function MissionReadinessStrip({ mode }: Props) {
  const sync = useMissionSync()
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [micPerm, setMicPerm] = useState<PermissionStateLike>('unknown')
  const [notifPerm, setNotifPerm] = useState<PermissionStateLike>('unknown')
  const [wakeHeld, setWakeHeld] = useState(isFieldWakeLockHeld())
  const [recheck, setRecheck] = useState(0)

  const refreshPerms = useCallback(async () => {
    const snap = await getPermissionSnapshot()
    setMicPerm(snap.microphone)
    setNotifPerm(snap.notifications)
    setRecheck((n) => n + 1)
  }, [])

  useEffect(() => {
    void refreshPerms()
    const onOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOnline)
    }
  }, [refreshPerms])

  useEffect(() => subscribeFieldWakeLock(setWakeHeld), [])

  const profile = getDeviceProfile()
  const inMission = sync.role !== 'idle'

  const report = useMemo(() => {
    if (mode === 'pre-mission' || !inMission) {
      return evaluatePreMissionReadiness({
        webrtcSupported: sync.supported,
        isStandalone: profile.isStandalone,
        micPermission: micPerm,
        notificationPermission: notifPerm,
        wakeLockSupported: isFieldWakeLockSupported(),
        online,
      })
    }
    const observerCallsigns = sync.peers
      .filter((p) => p.linkRole === 'observer')
      .map((p) => p.callsign?.trim() || 'Watcher')
    return evaluateInMissionReadiness({
      role: sync.role,
      phase: sync.phase,
      peerCount: sync.peers.length,
      fieldMemberCount: sync.peers.filter((p) => p.linkRole === 'member').length,
      observerCallsigns,
      teamCommsReady: sync.teamCommsReady,
      mapReady: sync.teamCorridorStatus === 'ready',
      monitorLive: sync.monitorLive,
      monitorTargetCallsign: sync.monitorTargetCallsign,
      monitorTransport: sync.monitorTransport,
      isStandalone: profile.isStandalone,
      wakeLockSupported: isFieldWakeLockSupported(),
      wakeLockHeld: wakeHeld,
      wakeLockWanted: isFieldWakeLockWanted(),
      linkRecoveryPending: sync.linkRecoveryPending,
      relayLinkState: sync.relayLinkState,
      online,
    })
  }, [
    mode,
    inMission,
    sync,
    profile.isStandalone,
    micPerm,
    notifPerm,
    online,
    wakeHeld,
    recheck,
  ])

  const fontSm = touchFontSm(profile.interactionMode === 'mobile')
  const bandColor = readinessBandColor(report.band)

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${bandColor}55`,
        background: 'rgba(8, 12, 14, 0.85)',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ color: bandColor, fontWeight: 800, fontSize: 11, letterSpacing: '0.08em' }}>
          MISSION READINESS · {report.bandLabel.toUpperCase()}
        </div>
        <button
          type="button"
          onClick={() => void refreshPerms()}
          style={{
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid #334155',
            background: 'rgba(15, 23, 42, 0.8)',
            color: '#94a3b8',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Recheck
        </button>
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 4,
        }}
      >
        {report.checks.map((check) => (
          <li
            key={check.id}
            style={{
              fontSize: fontSm,
              lineHeight: 1.35,
              color: checkColor(check.severity),
            }}
          >
            <strong style={{ color: '#cbd5e1' }}>{check.label}</strong>
            {check.optional ? ' (optional)' : ''}: {check.detail}
          </li>
        ))}
      </ul>
    </div>
  )
}
