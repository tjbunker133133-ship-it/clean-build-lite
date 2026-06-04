/**
 * Tier 1 freeze boundary registry (documentation + CI guards).
 * Does not alter runtime behavior.
 */

export const TIER1_FREEZE_ID = 'tier1-field-proven-2026-05-24'
export const TIER1_FREEZE_DATE = '2026-05-24'
export const TIER1_BASELINE_MANIFEST_REL = 'tier1-baseline.manifest.json'

/** Field-proven systems — immutable unless explicitly approved. */
export const TIER1_LOCKED_SYSTEMS = [
  'PWA install / service-worker deployment shell',
  'Map rendering stack (MapCanvas, mapStyles, layer toggle wiring)',
  'Raw GPS acquisition (watchPosition stream, fix normalization)',
  'HUD shell + panel dock/float interaction model',
  'Offline map baseline (Tier 1 layer stack, bounded prefetch)',
  'Rescue / SOS / deadman dispatch infrastructure',
  'Supabase rescue edge function contract',
  'Reference implementation (tier1-hud.html) + timing invariants',
] as const

/**
 * Active Tier 2 development — must not be treated as frozen Tier 1.
 * Changes here must not replace Tier 1 core behavior.
 */
export const TIER2_EXCLUDED_PATHS = [
  'src/lib/waypointNavigation.ts',
  'src/hud/WaypointTypePanel.tsx',
  'src/hud/NavigationHud.tsx',
  'src/hooks/useNavigationMonitor.ts',
  'src/lib/offRoute.ts',
  'src/lib/snapToTrail.ts',
  'src/lib/trailRoute.ts',
  'src/hooks/useCorridorOffline.ts',
  'src/lib/corridorPrefetch.ts',
  'src/lib/gpsConfidence.ts',
  'src/layers/RouteLayer.tsx',
  'src/layers/WaypointLayer.tsx',
  'src/lib/trailInspect.ts',
  'src/hooks/useTrailInspect.ts',
  'src/hud/TrailInspectCard.tsx',
  'src/lib/missionSync',
  'src/context/MissionSyncContext.tsx',
  'src/hud/MissionLinkPanel.tsx',
  'src/layers/TeamPresenceLayer.tsx',
  'src/layers/MonitorMapFollow.tsx',
  'src/layers/EnvironmentalOverlaysLayer.tsx',
  'src/lib/environmentalOverlays',
  'src/context/OverlayContext.tsx',
  'src/lib/snapTrack',
  'src/lib/wearables',
  'src/lib/wearables/wearablesFieldValidation.ts',
  'src/lib/wearables/wal',
  'plugins/capacitor-hud-health-connect',
  'src/hud/WearablesPanel.tsx',
  'src/hud/FieldStatusRail.tsx',
  'src/lib/missionSync/fieldConnectionStatus.ts',
  'src/lib/missionSync/missionReadiness.ts',
  'src/lib/missionSync/relayRecovery.ts',
  'src/lib/missionSync/missionRestoreContract.ts',
  'src/lib/missionSync/operationalTelemetry.ts',
  'src/lib/missionSync/ownershipRegistry.ts',
  'src/lib/missionSync/contextChurnAudit.ts',
  'src/lib/missionSync/missionSyncDerived.ts',
  'src/runtime/nativePortabilityBoundaries.ts',
  'src/runtime/fieldLifecycle.ts',
  'src/hud/MissionReadinessStrip.tsx',
  'src/hud/hudLayout.ts',
  'src/lib/travelSpeed.ts',
  'src/hooks/useTravelSpeed.ts',
] as const

export const TIER2_EXCLUDED_CAPABILITIES = [
  'Waypoint progression and arrival confirmation',
  'Corridor-aware navigation logic',
  'Off-route detection',
  'Trail-aware distance calculation',
  'Snap-to-trail runtime behavior',
  'Intelligent route state systems',
  'Advanced offline corridor caching',
  'Terrain-aware navigation',
  'USGS / NASA / environmental integrations',
  'Predictive routing behavior',
  'Outdoor trail inspect (tap-for-info, link-out)',
  'Mission P2P sync (WebRTC mesh, waypoint sharing, team check-in/burst)',
  'Capacitor Android shell + LAN mission discovery plugin',
] as const

export type Tier1FreezeAuditResult = {
  ok: boolean
  failures: string[]
}
