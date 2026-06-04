import type { MissionSyncConnectionPhase, MissionSyncRole } from './types'

/** Relay sync freshness — aligned with monitor live window. */
export const RELAY_FRESH_MS = 45_000

/** Max time in link-recovery before declaring incomplete recovery. */
export const LINK_RECOVERY_TIMEOUT_MS = 90_000

export type RelayLinkState = 'active' | 'degraded' | 'unavailable'

export function isRelayFresh(relayLastAtMs: number, nowMs: number = Date.now()): boolean {
  return relayLastAtMs > 0 && nowMs - relayLastAtMs < RELAY_FRESH_MS
}

/** Relay health when mesh peers are absent. */
export function evaluateRelayLinkState(args: {
  relayLastAtMs: number
  peerCount: number
  missionRelayActive: boolean
  observerSignalingAvailable: boolean
  online: boolean
  nowMs?: number
}): RelayLinkState {
  if (args.peerCount > 0) return 'active'
  if (isRelayFresh(args.relayLastAtMs, args.nowMs)) return 'active'
  if (args.relayLastAtMs === 0) {
    return args.missionRelayActive || args.observerSignalingAvailable ? 'active' : 'unavailable'
  }
  if (args.missionRelayActive || args.observerSignalingAvailable) {
    return args.online ? 'degraded' : 'unavailable'
  }
  return 'unavailable'
}

export type PeerDisconnectRecovery = {
  phase: MissionSyncConnectionPhase
  linkRecoveryPending: boolean
  monitorTransport?: 'relay'
  notifyLevel?: 'info'
  notifyMessage?: string
}

/** Pure decision for mesh peer drop — mirrors MissionSyncContext disconnect handling. */
export function resolvePeerDisconnectRecovery(args: {
  isObserver: boolean
  isFieldMember: boolean
  relayLastAtMs: number
  missionRelayActive: boolean
  observerSignalingAvailable: boolean
  nowMs?: number
}): PeerDisconnectRecovery {
  const now = args.nowMs ?? Date.now()
  const relayFresh = isRelayFresh(args.relayLastAtMs, now)

  if (args.isObserver && relayFresh) {
    return {
      phase: 'connected',
      linkRecoveryPending: false,
      monitorTransport: 'relay',
    }
  }
  if (args.isObserver && args.observerSignalingAvailable) {
    return { phase: 'connecting', linkRecoveryPending: true }
  }
  if (
    args.isFieldMember &&
    args.missionRelayActive &&
    (relayFresh || args.observerSignalingAvailable)
  ) {
    return {
      phase: 'connected',
      linkRecoveryPending: false,
      notifyLevel: 'info',
      notifyMessage:
        'Direct mesh link dropped — mission sync continues over internet relay when online.',
    }
  }
  return { phase: 'awaiting-joiner', linkRecoveryPending: true }
}

export type LinkRecoveryTimeoutOutcome = {
  linkRecoveryPending: false
  relayLinkState: RelayLinkState
  phase: MissionSyncConnectionPhase
  notifyMessage: string
}

/** Recovery attempt exceeded — honest degraded/unavailable outcome. */
export function resolveLinkRecoveryTimeout(args: {
  relayLastAtMs: number
  peerCount: number
  missionRelayActive: boolean
  observerSignalingAvailable: boolean
  online: boolean
  role: MissionSyncRole
  nowMs?: number
}): LinkRecoveryTimeoutOutcome {
  const relayLinkState = evaluateRelayLinkState({
    relayLastAtMs: args.relayLastAtMs,
    peerCount: args.peerCount,
    missionRelayActive: args.missionRelayActive,
    observerSignalingAvailable: args.observerSignalingAvailable,
    online: args.online,
    nowMs: args.nowMs,
  })

  if (args.role === 'observer') {
    if (relayLinkState === 'active') {
      return {
        linkRecoveryPending: false,
        relayLinkState: 'active',
        phase: 'connected',
        notifyMessage: 'Monitor link restored over internet relay.',
      }
    }
    return {
      linkRecoveryPending: false,
      relayLinkState,
      phase: 'failed',
      notifyMessage:
        relayLinkState === 'degraded'
          ? 'Monitor recovery incomplete — relay quiet. Check cell/Wi‑Fi or ask field lead to resend monitor bundle.'
          : 'Monitor link unavailable — check network or paste a fresh monitor bundle.',
    }
  }

  if (relayLinkState === 'active') {
    return {
      linkRecoveryPending: false,
      relayLinkState: 'active',
      phase: 'connected',
      notifyMessage: 'Team link restored over internet relay.',
    }
  }

  return {
    linkRecoveryPending: false,
    relayLinkState,
    phase: 'awaiting-joiner',
    notifyMessage:
      relayLinkState === 'degraded'
        ? 'Mesh recovery incomplete — relay quiet. Tap Reconnect mesh or re-enter mission code.'
        : 'Team link unavailable — tap Reconnect mesh when back in range.',
  }
}

/** Concise operator label for FieldStatusRail / readiness surfaces. */
export function linkRecoveryStatusLabel(args: {
  linkRecoveryPending: boolean
  relayLinkState: RelayLinkState
}): string | null {
  if (args.linkRecoveryPending) return 'Reconnecting mesh or relay…'
  if (args.relayLinkState === 'degraded') return 'Relay degraded — last sync quiet'
  if (args.relayLinkState === 'unavailable') return 'Relay unavailable — reconnect required'
  return null
}

export function relayLinkStateDetail(state: RelayLinkState): string | null {
  switch (state) {
    case 'degraded':
      return 'Internet relay quiet — comms may resume when field sends updates'
    case 'unavailable':
      return 'No mesh peers and relay unavailable — reconnect to restore comms'
    default:
      return null
  }
}
