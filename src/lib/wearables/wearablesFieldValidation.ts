/**
 * Wearables field validation contract — verified runtime inventory + smoke checklist.
 * Companion surfaces only; no watch-native HUD. See docs/WEARABLES_TIER2.md.
 */

export type WearableSurfaceClass =
  | 'OPERATIONAL'
  | 'EXPERIMENTAL'
  | 'REDUNDANT'
  | 'UNUSED'
  | 'PREVIEW_TIER3'

export type WearableSurfaceEntry = {
  id: string
  surface: string
  module: string
  wiredTo: string[]
  classification: WearableSurfaceClass
  notes: string
}

/** Verified wiring as of structural audit — not speculative. */
export const WEARABLE_SURFACE_INVENTORY: WearableSurfaceEntry[] = [
  {
    id: 'wearables-panel',
    surface: 'Wearables HUD panel',
    module: 'src/hud/WearablesPanel.tsx',
    wiredTo: ['App.tsx lazy mount', 'CockpitContext panelId wearables', 'useHudCommands wearables panel'],
    classification: 'OPERATIONAL',
    notes: 'Default minimized in cockpit. Setup, test alert, Health Connect, device guide.',
  },
  {
    id: 'companion-test-notif',
    surface: 'Companion test notification',
    module: 'src/lib/wearables/companionNotification.ts',
    wiredTo: ['WearablesPanel Send test alert', 'serviceWorker.showNotification or Notification API'],
    classification: 'OPERATIONAL',
    notes: 'Tag signal-one-wearables-test. Not SOS. Watch mirrors via OS if paired.',
  },
  {
    id: 'health-connect',
    surface: 'Health Connect read-only vitals',
    module: 'src/lib/wearables/healthConnectClient.ts',
    wiredTo: [
      'plugins/capacitor-hud-health-connect',
      'wearablesHealthCache.ts',
      'WearablesPanel link/refresh',
    ],
    classification: 'OPERATIONAL',
    notes: 'Android Capacitor APK only. HR + steps advisory. Does not touch SOS/deadman/GPS.',
  },
  {
    id: 'wearables-status',
    surface: 'Device category guide + platform status',
    module: 'src/lib/wearables/wearablesStatus.ts',
    wiredTo: ['WearablesPanel DEVICE GUIDE', 'wearablesHealthCache for ring readiness'],
    classification: 'OPERATIONAL',
    notes: 'Static guidance; smartwatch has no separate watch app in this build.',
  },
  {
    id: 'alert-watch-push',
    surface: 'Contact rescue push (alertWatch token)',
    module: 'src/lib/push/alertWatchToken.ts',
    wiredTo: [
      'buildRescuePacket.ts',
      'postRescuePush.ts',
      'AlertPushStrip',
      'WearablesPanel share invite',
      'AlertWatchBootstrap',
      'public/sw-push-handler.js',
    ],
    classification: 'OPERATIONAL',
    notes: 'Contacts subscribe on phone; push may mirror to paired watch. Not mission team comms.',
  },
  {
    id: 'voice-biometric',
    surface: 'Voice “biometric” readout',
    module: 'src/hooks/useHudCommands.ts',
    wiredTo: ['healthConnectClient cache', 'environmentalVoice buildBiometricVoiceMessage'],
    classification: 'OPERATIONAL',
    notes: 'Battery + optional Health Connect line. Phone speaker only.',
  },
  {
    id: 'alert-push-strip',
    surface: 'Preflight push invite strip',
    module: 'src/hud/AlertPushStrip.tsx',
    wiredTo: ['PreflightPanel', 'webPushClient', 'alertWatchToken'],
    classification: 'REDUNDANT',
    notes: 'Duplicates WearablesPanel share/copy push actions — intentional Preflight shortcut.',
  },
  {
    id: 'smart-glasses-guide',
    surface: 'Smart glasses category',
    module: 'src/lib/wearables/wearablesStatus.ts',
    wiredTo: ['WearablesPanel guide only'],
    classification: 'PREVIEW_TIER3',
    notes: 'Explicitly planned Tier 3 AR — no device link.',
  },
  {
    id: 'deadman-wrist-guide',
    surface: 'Deadman on wrist category',
    module: 'src/lib/wearables/wearablesStatus.ts',
    wiredTo: ['WearablesPanel guide only'],
    classification: 'PREVIEW_TIER3',
    notes: 'Intentionally off until legal review.',
  },
  {
    id: 'mission-watch-comms',
    surface: 'Mission team burst → watch notification',
    module: '(not implemented)',
    wiredTo: [],
    classification: 'UNUSED',
    notes: 'Team comms use TeamCommsToast + TTS on phone only. No system notification path.',
  },
  {
    id: 'field-status-rail',
    surface: 'Mission connection glance rail',
    module: 'src/hud/FieldStatusRail.tsx',
    wiredTo: ['NavigationHud', 'MissionSyncContext'],
    classification: 'OPERATIONAL',
    notes: 'Phone HUD only — not wearables module but primary glance surface when phone unlocked.',
  },
]

export type WearableSmokeStep = {
  id: string
  area: 'connection' | 'lifecycle' | 'comms' | 'ux' | 'vitals' | 'push'
  scenario: string
  steps: string[]
  passCriteria: string
}

export const WEARABLE_FIELD_SMOKE_CHECKLIST: WearableSmokeStep[] = [
  {
    id: 'conn-mesh',
    area: 'connection',
    scenario: 'Mesh connected (field member)',
    steps: [
      'Start mission, link teammate on LAN or code.',
      'Glance FieldStatusRail on phone — Mesh N teammates live.',
    ],
    passCriteria: 'Rail shows live mesh; no false relay-only when peers present.',
  },
  {
    id: 'conn-relay-only',
    area: 'connection',
    scenario: 'Relay-only (no local peers)',
    steps: [
      'Field member online, zero mesh peers, Supabase relay configured.',
      'Confirm FieldStatusRail or MissionReadiness shows Relay-only.',
    ],
    passCriteria: 'Relay-only label honest; comms still ready when teamCommsReady.',
  },
  {
    id: 'conn-degraded',
    area: 'connection',
    scenario: 'Relay degraded after recovery timeout',
    steps: [
      'Drop mesh, wait past link recovery window (~90s) without relay traffic.',
      'Read FieldStatusRail relay degraded / unavailable line.',
    ],
    passCriteria: 'Recovery does not hang on “Reconnecting…” indefinitely.',
  },
  {
    id: 'life-lock',
    area: 'lifecycle',
    scenario: 'Phone lock / unlock',
    steps: [
      'Active mission, lock phone 2 min, unlock.',
      'Check wake lock row and mesh phase in FieldStatusRail.',
    ],
    passCriteria: 'Mission session persists; wake lock reacquire or honest loss message.',
  },
  {
    id: 'life-background',
    area: 'lifecycle',
    scenario: 'Background tab / app switch',
    steps: ['Switch away from HUD 30s, return foreground.'],
    passCriteria: 'Background warn row clears; mesh may pause — no silent corrupt state.',
  },
  {
    id: 'life-browser-vs-installed',
    area: 'lifecycle',
    scenario: 'Browser tab vs installed PWA/APK',
    steps: ['Repeat lock test in browser tab and installed app.'],
    passCriteria: 'Wearables panel shows correct install mode; Health Connect only on APK.',
  },
  {
    id: 'push-test',
    area: 'push',
    scenario: 'Phone → watch notification mirror',
    steps: [
      'Wearables → Allow notifications → Send test alert.',
      'Confirm on phone; check paired Pixel Watch / Apple Watch within ~30s.',
    ],
    passCriteria: 'Test alert appears on phone; watch mirrors if OS settings allow.',
  },
  {
    id: 'push-contact',
    area: 'push',
    scenario: 'Contact rescue push (not SOS drill unless safe)',
    steps: [
      'Share push invite from Wearables or Preflight.',
      'Contact subscribes via AlertWatchBootstrap flow.',
    ],
    passCriteria: 'Subscriber count increments; contact device registered.',
  },
  {
    id: 'comms-inbound',
    area: 'comms',
    scenario: 'Incoming team message',
    steps: ['Teammate sends burst while HUD foreground on phone.'],
    passCriteria: 'TeamCommsToast + optional TTS on phone. Watch does NOT receive unless future push added.',
  },
  {
    id: 'vitals-hc',
    area: 'vitals',
    scenario: 'Health Connect advisory (Android APK)',
    steps: [
      'Sync ring/watch to Health Connect app.',
      'Wearables → Link Health Connect → Refresh vitals.',
      'Voice command “biometric”.',
    ],
    passCriteria: 'HR/steps in panel + voice line. No SOS/deadman/GPS change.',
  },
  {
    id: 'ux-glance',
    area: 'ux',
    scenario: 'Glance readability outdoors',
    steps: ['FieldStatusRail + MissionReadinessStrip in direct sun, one-hand phone hold.'],
    passCriteria: 'Status rows readable at arm length; no dense telemetry blocks.',
  },
]

export type WearableTierRecommendation = {
  capability: string
  tier: 'TIER2_VALID' | 'TIER2_DEFER' | 'TIER3_FUTURE' | 'REMOVE_OR_HIDE'
  rationale: string
}

export const WEARABLE_TIER2_ROLE_RECOMMENDATIONS: WearableTierRecommendation[] = [
  {
    capability: 'Mission connection truth (mesh/relay/recovery)',
    tier: 'TIER2_VALID',
    rationale: 'Phone FieldStatusRail + readiness — watch mirrors only via future optional push.',
  },
  {
    capability: 'Rescue/contact push to paired watch',
    tier: 'TIER2_VALID',
    rationale: 'Existing Web Push + OS mirror path; operator setup in Wearables/Preflight.',
  },
  {
    capability: 'Companion test notification',
    tier: 'TIER2_VALID',
    rationale: 'Validates phone→watch pipeline without SOS.',
  },
  {
    capability: 'Health Connect advisory vitals',
    tier: 'TIER2_VALID',
    rationale: 'Read-only, APK-bound, explicitly not safety-critical.',
  },
  {
    capability: 'Mission team burst watch alert',
    tier: 'TIER2_DEFER',
    rationale: 'Useful but needs scoped push contract — currently phone toast/TTS only.',
  },
  {
    capability: 'Watch complications / Wear OS app',
    tier: 'TIER3_FUTURE',
    rationale: 'Documented planned; requires native companion, not browser.',
  },
  {
    capability: 'Smart glasses / AR HUD',
    tier: 'TIER3_FUTURE',
    rationale: 'Explicitly Tier 3 in wearablesStatus.',
  },
  {
    capability: 'Deadman wrist escalation',
    tier: 'TIER3_FUTURE',
    rationale: 'Legal review gate; keep off.',
  },
  {
    capability: 'Full map on watch',
    tier: 'REMOVE_OR_HIDE',
    rationale: 'Violates field companion doctrine — do not build.',
  },
]

export function summarizeWearableInventory(): Record<WearableSurfaceClass, number> {
  const counts: Record<WearableSurfaceClass, number> = {
    OPERATIONAL: 0,
    EXPERIMENTAL: 0,
    REDUNDANT: 0,
    UNUSED: 0,
    PREVIEW_TIER3: 0,
  }
  for (const e of WEARABLE_SURFACE_INVENTORY) counts[e.classification]++
  return counts
}
