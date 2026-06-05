import type { PermissionStateLike } from '../devicePermissions'
import type { MissionSyncConnectionPhase, MissionSyncRole } from './types'
import type { MissionMonitorTransport } from './monitorLive'
import {
  buildMemberConnectionStatus,
  buildObserverConnectionStatus,
  buildRelayHealthSupplement,
  isFieldSessionBackgrounded,
} from './fieldConnectionStatus'
import type { RelayLinkState } from './relayRecovery'
import { linkRecoveryStatusLabel } from './relayRecovery'

export type ReadinessSeverity = 'ok' | 'warn' | 'fail'

export type MissionReadinessCheck = {
  id: string
  label: string
  detail: string
  severity: ReadinessSeverity
  /** Non-blocking advisory (e.g. push notifications). */
  optional?: boolean
}

export type MissionReadinessBand = 'field-ready' | 'degraded' | 'no-go'

export type MissionReadinessReport = {
  band: MissionReadinessBand
  bandLabel: string
  checks: MissionReadinessCheck[]
  /** Informational — mission may still start when degraded unless unsupported. */
  advisoryOnly: boolean
}

function micSeverity(state: PermissionStateLike): ReadinessSeverity {
  if (state === 'granted') return 'ok'
  if (state === 'prompt' || state === 'unknown') return 'warn'
  if (state === 'unsupported') return 'warn'
  return 'fail'
}

function notifSeverity(state: PermissionStateLike): ReadinessSeverity {
  if (state === 'granted') return 'ok'
  if (state === 'unsupported') return 'ok'
  return 'warn'
}

export function evaluatePreMissionReadiness(args: {
  webrtcSupported: boolean
  isStandalone: boolean
  micPermission: PermissionStateLike
  notificationPermission: PermissionStateLike
  wakeLockSupported: boolean
  online: boolean
}): MissionReadinessReport {
  const checks: MissionReadinessCheck[] = []

  checks.push({
    id: 'install',
    label: 'Install mode',
    detail: args.isStandalone
      ? 'Home Screen / installed app'
      : 'Browser tab — add to Home Screen for full-screen field mode',
    severity: args.isStandalone ? 'ok' : 'warn',
  })

  checks.push({
    id: 'mic',
    label: 'Microphone',
    detail:
      args.micPermission === 'granted'
        ? 'Granted — voice comms available'
        : args.micPermission === 'denied'
          ? 'Blocked — use typed team messages only'
          : args.micPermission === 'unsupported'
            ? 'Unavailable on this browser'
            : 'Prompt when you first use voice',
    severity: micSeverity(args.micPermission),
  })

  checks.push({
    id: 'notifications',
    label: 'Alerts',
    detail:
      args.notificationPermission === 'granted'
        ? 'Notifications enabled'
        : args.notificationPermission === 'unsupported'
          ? 'Not available here (optional)'
          : 'Optional — enable for mission alerts',
    severity: notifSeverity(args.notificationPermission),
    optional: true,
  })

  checks.push({
    id: 'wake-lock',
    label: 'Screen awake',
    detail: args.wakeLockSupported
      ? 'Wake lock supported during mission'
      : 'Wake lock unsupported — OS may sleep the display',
    severity: args.wakeLockSupported ? 'ok' : 'warn',
  })

  checks.push({
    id: 'network',
    label: 'Network',
    detail: args.online
      ? 'Online — relay fallback available when configured'
      : 'Offline — local mesh only after teammates link',
    severity: args.online ? 'ok' : 'warn',
  })

  checks.push({
    id: 'lifecycle',
    label: 'Mobile lifecycle',
    detail:
      'Lock screen and background tabs may pause mesh, voice, and wake lock — keep HUD in foreground when coordinating',
    severity: 'warn',
  })

  if (!args.webrtcSupported) {
    checks.unshift({
      id: 'webrtc',
      label: 'Mission link',
      detail: 'WebRTC unavailable — mission mesh cannot start in this browser',
      severity: 'fail',
    })
  }

  return finalizeReport(checks, !args.webrtcSupported)
}

export function evaluateInMissionReadiness(args: {
  role: MissionSyncRole
  phase: MissionSyncConnectionPhase
  peerCount: number
  fieldMemberCount: number
  observerCallsigns: string[]
  teamCommsReady: boolean
  mapReady: boolean
  monitorLive: boolean
  monitorTargetCallsign: string
  monitorTransport: MissionMonitorTransport
  isStandalone: boolean
  wakeLockSupported: boolean
  wakeLockHeld: boolean
  wakeLockWanted: boolean
  linkRecoveryPending: boolean
  relayLinkState: RelayLinkState
  online: boolean
}): MissionReadinessReport {
  const checks: MissionReadinessCheck[] = []

  if (args.role === 'observer') {
    const conn = buildObserverConnectionStatus({
      phase: args.phase,
      monitorLive: args.monitorLive,
      monitorTargetCallsign: args.monitorTargetCallsign,
      teamCommsReady: args.teamCommsReady,
      peerCount: args.peerCount,
      monitorTransport: args.monitorTransport,
    })
    checks.push({
      id: 'connection',
      label: 'Monitor link',
      detail: conn.supplement ? `${conn.label} · ${conn.supplement}` : conn.label,
      severity: conn.live ? 'ok' : args.teamCommsReady ? 'warn' : 'fail',
    })
  } else if (args.role === 'member') {
    const conn = buildMemberConnectionStatus({
      phase: args.phase,
      peerCount: args.peerCount,
      fieldMemberCount: args.fieldMemberCount,
      observerCallsigns: args.observerCallsigns,
      teamCommsReady: args.teamCommsReady,
      mapReady: args.mapReady,
    })
    checks.push({
      id: 'connection',
      label: 'Team link',
      detail: conn.supplement ? `${conn.label} · ${conn.supplement}` : conn.label,
      severity: conn.live ? 'ok' : args.teamCommsReady ? 'warn' : 'fail',
    })
  }

  const recoveryLabel = linkRecoveryStatusLabel({
    linkRecoveryPending: args.linkRecoveryPending,
    relayLinkState: args.relayLinkState,
  })
  if (recoveryLabel) {
    checks.push({
      id: 'recovery',
      label: 'Link recovery',
      detail: recoveryLabel,
      severity: args.relayLinkState === 'unavailable' ? 'fail' : 'warn',
    })
  }

  const relayHealth = buildRelayHealthSupplement(args.relayLinkState)
  if (relayHealth && !args.linkRecoveryPending && args.peerCount === 0) {
    checks.push({
      id: 'relay-health',
      label: 'Internet relay',
      detail: relayHealth,
      severity: args.relayLinkState === 'unavailable' ? 'fail' : 'warn',
    })
  }

  if (!args.online && args.peerCount === 0) {
    checks.push({
      id: 'offline',
      label: 'Offline',
      detail: 'No network and no local mesh peers — comms paused until link returns',
      severity: 'fail',
    })
  }

  checks.push({
    id: 'install',
    label: 'Install mode',
    detail: args.isStandalone ? 'Installed app' : 'Browser tab — degraded session behavior',
    severity: args.isStandalone ? 'ok' : 'warn',
  })

  if (args.wakeLockWanted) {
    checks.push({
      id: 'wake-lock',
      label: 'Screen awake',
      detail: args.wakeLockHeld
        ? 'Wake lock active'
        : args.wakeLockSupported
          ? 'Wake lock inactive — display may sleep (informational)'
          : 'Wake lock unsupported on this device',
      severity: args.wakeLockHeld ? 'ok' : 'warn',
    })
  }

  if (isFieldSessionBackgrounded()) {
    checks.push({
      id: 'background',
      label: 'Background',
      detail: 'App backgrounded — mesh and voice may pause until foreground',
      severity: 'warn',
    })
  }

  checks.push({
    id: 'lifecycle',
    label: 'Mobile lifecycle',
    detail: 'Lock screen may suspend comms even with wake lock — keep device awake for coordination',
    severity: 'warn',
  })

  return finalizeReport(checks, false)
}

function finalizeReport(checks: MissionReadinessCheck[], hardBlock: boolean): MissionReadinessReport {
  const blockingFails = checks.filter((c) => c.severity === 'fail' && !c.optional)
  const warns = checks.filter((c) => c.severity === 'warn' && !c.optional)

  let band: MissionReadinessBand = 'field-ready'
  let bandLabel = 'Field ready'

  if (hardBlock || blockingFails.length > 0) {
    band = 'no-go'
    bandLabel = 'Not ready'
  } else if (warns.length > 0) {
    band = 'degraded'
    bandLabel = 'Degraded — review before field use'
  }

  return {
    band,
    bandLabel,
    checks,
    advisoryOnly: !hardBlock && blockingFails.length === 0,
  }
}

export function readinessBandColor(band: MissionReadinessBand): string {
  if (band === 'field-ready') return '#7dff8a'
  if (band === 'degraded') return '#ffd166'
  return '#ff6b87'
}
