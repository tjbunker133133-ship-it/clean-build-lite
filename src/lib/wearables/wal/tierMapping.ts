/**
 * Tier 2 vs Tier 3 mapping for WAL capabilities.
 */

export type WalTierSlot = 'TIER2_NOW' | 'TIER2_DEFER' | 'TIER3_FUTURE' | 'TIER1_FROZEN'

export type WalTierEntry = {
  component: string
  tier: WalTierSlot
  notes: string
}

export const WAL_TIER_MAPPING: WalTierEntry[] = [
  {
    component: 'wal/types.ts — WearableSignal normalization',
    tier: 'TIER2_NOW',
    notes: 'Pure data contract',
  },
  {
    component: 'wal/escalationStateMachine.ts',
    tier: 'TIER2_NOW',
    notes: 'Human-in-the-loop escalation; no autonomous SOS',
  },
  {
    component: 'wal/adapters/androidHealthConnectAdapter.ts',
    tier: 'TIER2_NOW',
    notes: 'Wraps existing read-only Health Connect',
  },
  {
    component: 'wal/adapters/notificationMirrorAdapter.ts',
    tier: 'TIER2_NOW',
    notes: 'Uses companionNotification / SW path for projections',
  },
  {
    component: 'wal/walRuntime.ts',
    tier: 'TIER2_DEFER',
    notes: 'Opt-in runtime — not mounted in App until field validation passes',
  },
  {
    component: 'wal/adapters/iosHealthKitAdapter.ts',
    tier: 'TIER2_DEFER',
    notes: 'Stub until native plugin',
  },
  {
    component: 'wal/adapters/smartRingAdapter.ts',
    tier: 'TIER3_FUTURE',
    notes: 'Vendor SDK slot',
  },
  {
    component: 'wal/adapters/smartGlassesAdapter.ts',
    tier: 'TIER3_FUTURE',
    notes: 'Display/audio projection only',
  },
  {
    component: 'interpretationLayer affirmations / coaching',
    tier: 'TIER3_FUTURE',
    notes: 'Training mode only; not medical diagnostic',
  },
  {
    component: 'SOSPanel slide-hold dispatch',
    tier: 'TIER1_FROZEN',
    notes: 'WAL must call via approved hook only — do not modify hold timing',
  },
  {
    component: 'buildRescuePacket / postRescuePush',
    tier: 'TIER1_FROZEN',
    notes: 'Reuse interface; WAL supplies escalation_confirmed gate only',
  },
  {
    component: 'MissionSyncContext / FieldStatusRail',
    tier: 'TIER2_NOW',
    notes: 'Mission state stays on phone; wearables project alerts only',
  },
]

export type WalRefactorPhase = {
  phase: number
  title: string
  scope: string
  risk: 'LOW' | 'MEDIUM' | 'HIGH'
  reversible: boolean
}

/** Minimal safe rollout — no full rewrite. */
export const WAL_REFACTOR_PLAN: WalRefactorPhase[] = [
  {
    phase: 1,
    title: 'WAL library (this PR)',
    scope: 'Types, adapters, state machine, tests — no App mount',
    risk: 'LOW',
    reversible: true,
  },
  {
    phase: 2,
    title: 'WearablesPanel readout',
    scope: 'Mode selector + escalation snapshot display + cancel/confirm buttons (dev/field flag)',
    risk: 'LOW',
    reversible: true,
  },
  {
    phase: 3,
    title: 'Opt-in walRuntime.start()',
    scope: 'WearablesPanel or Preflight toggle; Health Connect poll feeds WAL',
    risk: 'MEDIUM',
    reversible: true,
  },
  {
    phase: 4,
    title: 'SOS dispatch hook wiring',
    scope: 'Explicit product approval; reuse buildRescuePacket after escalation_confirmed',
    risk: 'HIGH',
    reversible: true,
  },
  {
    phase: 5,
    title: 'Native adapters',
    scope: 'HealthKit, Wear OS complication — separate plugins',
    risk: 'MEDIUM',
    reversible: true,
  },
]
