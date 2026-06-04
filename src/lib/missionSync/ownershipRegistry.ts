/**
 * Tier 2 mission-sync ownership registry — developer/runtime contract.
 * MissionSyncContext orchestrates; modules below own behavior.
 * DO NOT add domain logic to MissionSyncContext when a module exists.
 */

export type OwnershipDomain =
  | 'orchestration'
  | 'mesh-transport'
  | 'relay-transport'
  | 'signaling-transport'
  | 'lifecycle'
  | 'recovery'
  | 'restore'
  | 'voice-comms'
  | 'team-comms'
  | 'derived-readout'
  | 'persistence'
  | 'native-bridge'

export type OwnershipEntry = {
  domain: OwnershipDomain
  /** Authoritative module for this domain. */
  owner: string
  /** What MissionSyncContext may do — wire callbacks, setState at edges only. */
  orchestratorRole: string
  /** Modules/surfaces that must NOT absorb this logic. */
  doNotAddLogicTo: string[]
  summary: string
}

/** Where responsibilities live — read this before editing MissionSyncContext. */
export const MISSION_SYNC_OWNERSHIP: OwnershipEntry[] = [
  {
    domain: 'orchestration',
    owner: 'src/context/MissionSyncContext.tsx',
    orchestratorRole: 'Session lifecycle, React state, coordinator wiring, notify/toast edges',
    doNotAddLogicTo: ['src/hud/*', 'src/layers/*'],
    summary: 'Single orchestrator — do not split into parallel providers or event buses.',
  },
  {
    domain: 'mesh-transport',
    owner: 'src/lib/missionSync/coordinator.ts',
    orchestratorRole: 'Instantiate coordinator, attach callbacks, call send/reconnect',
    doNotAddLogicTo: ['MissionSyncContext onSnapshot body', 'HUD panels'],
    summary: 'WebRTC mesh peer connections, ICE, data channel, peer callbacks.',
  },
  {
    domain: 'relay-transport',
    owner: 'src/lib/missionSync/observerMonitorChannel.ts',
    orchestratorRole: 'setOutboundRelay, handleRelayWire ingest, relayLastAtRef updates',
    doNotAddLogicTo: ['coordinator.ts', 'FieldStatusRail'],
    summary: 'Supabase internet relay publish/subscribe — fallback when mesh peers drop.',
  },
  {
    domain: 'signaling-transport',
    owner: 'src/lib/missionSync/missionJoinSignaling.ts',
    orchestratorRole: 'Join/monitor offer-answer flow triggers only',
    doNotAddLogicTo: ['relayRecovery.ts', 'coordinator.ts'],
    summary: 'Wi‑Fi code room + observer signaling for bundle exchange before WebRTC.',
  },
  {
    domain: 'lifecycle',
    owner: 'src/runtime/fieldLifecycle.ts',
    orchestratorRole: 'visibility telemetry hooks, background readout inputs',
    doNotAddLogicTo: ['MissionSyncContext mesh logic', 'VoicePanel SR internals'],
    summary: 'visibilitychange, install surface, native lifecycle audit — platform portable.',
  },
  {
    domain: 'recovery',
    owner: 'src/lib/missionSync/relayRecovery.ts',
    orchestratorRole: 'begin/complete recovery, timer effect, relayLinkState tick',
    doNotAddLogicTo: ['coordinator.ts', 'missionReadiness.ts'],
    summary: 'Relay freshness, link recovery timeout, degraded vs unavailable semantics.',
  },
  {
    domain: 'restore',
    owner: 'src/lib/missionSync/missionRestoreContract.ts',
    orchestratorRole: 'Boot effect: evaluate outcome, coordinator restore, notify guidance',
    doNotAddLogicTo: ['persist.ts', 'HUD panels'],
    summary: 'What survives refresh, device mismatch, observer wait vs paste.',
  },
  {
    domain: 'voice-comms',
    owner: 'src/hud/VoicePanel.tsx',
    orchestratorRole: 'Mission voice bridge registration only',
    doNotAddLogicTo: ['MissionSyncContext', 'coordinator.ts'],
    summary: 'Speech recognition, wake-word, SR lifecycle — NOT mission mesh.',
  },
  {
    domain: 'team-comms',
    owner: 'src/lib/missionSync/comms.ts',
    orchestratorRole: 'sendTeamCheckIn/Burst dispatch, inbound ingest callbacks',
    doNotAddLogicTo: ['VoicePanel', 'FieldStatusRail'],
    summary: 'Check-in/burst build, stale filters, chirp/TTS hooks at edges.',
  },
  {
    domain: 'derived-readout',
    owner: 'src/lib/missionSync/missionSyncDerived.ts',
    orchestratorRole: 'Import helpers for useMemo — no inline re-derivation in value builder',
    doNotAddLogicTo: ['FieldStatusRail compute', 'MissionLinkPanel'],
    summary: 'observerCount, monitorLive, teamCommsReady, filtered comms, QR fit flags.',
  },
  {
    domain: 'persistence',
    owner: 'src/lib/missionSync/persist.ts',
    orchestratorRole: 'saveMissionSession on session edges, load on boot',
    doNotAddLogicTo: ['MissionSyncContext merge logic', 'coordinator.ts'],
    summary: 'Device id + session JSON — corrupt load returns null.',
  },
  {
    domain: 'native-bridge',
    owner: 'src/lib/missionSync/nativeLink.ts',
    orchestratorRole: 'Native payload bridge install, discovery/advertise calls',
    doNotAddLogicTo: ['coordinator.ts', 'fieldLifecycle.ts'],
    summary: 'Capacitor Nearby/LAN plugins — browser falls back to web stubs.',
  },
]

export type ContinuityContractRef = {
  id: string
  module: string
  covers: string
}

/** Pointers to continuity/runtime contracts — not duplicated here. */
export const MISSION_CONTINUITY_CONTRACTS: ContinuityContractRef[] = [
  { id: 'relay-recovery', module: 'relayRecovery.ts', covers: 'RELAY_FRESH_MS, timeout, degraded/unavailable' },
  { id: 'mission-restore', module: 'missionRestoreContract.ts', covers: 'refresh/rejoin/device mismatch outcomes' },
  { id: 'field-connection', module: 'fieldConnectionStatus.ts', covers: 'operator connection labels' },
  { id: 'mission-readiness', module: 'missionReadiness.ts', covers: 'pre/in-mission readiness bands' },
  { id: 'operational-telemetry', module: 'operationalTelemetry.ts', covers: 'lifecycle/transport events, no PII' },
  { id: 'lifecycle-audit', module: 'fieldLifecycle.ts', covers: 'native portability surface audit' },
  { id: 'context-churn', module: 'contextChurnAudit.ts', covers: 'MissionSyncContext re-render hotspots' },
]

export function getOwnershipForDomain(domain: OwnershipDomain): OwnershipEntry | undefined {
  return MISSION_SYNC_OWNERSHIP.find((e) => e.domain === domain)
}

export function assertOwnershipRegistryComplete(): { ok: boolean; missing: OwnershipDomain[] } {
  const required: OwnershipDomain[] = [
    'orchestration',
    'mesh-transport',
    'relay-transport',
    'recovery',
    'restore',
    'lifecycle',
    'derived-readout',
  ]
  const present = new Set(MISSION_SYNC_OWNERSHIP.map((e) => e.domain))
  const missing = required.filter((d) => !present.has(d))
  return { ok: missing.length === 0, missing }
}
