/**
 * Native portability boundary registry — Capacitor / Play Store trajectory.
 * Platform assumptions isolated here and in referenced modules.
 * MissionSyncContext must delegate to these boundaries, not embed browser logic.
 */

import { auditNativeLifecycleCompatibility, detectFieldLifecycleSurface } from './fieldLifecycle'
import { isFieldWakeLockSupported } from './fieldWakeLock'

export type PortabilityBoundary = {
  id: string
  module: string
  owns: string
  browserAssumption: string
  nativeIntegration: string
  status: 'ready' | 'partial' | 'gap'
}

export const NATIVE_PORTABILITY_BOUNDARIES: PortabilityBoundary[] = [
  {
    id: 'lifecycle-surface',
    module: 'src/runtime/fieldLifecycle.ts',
    owns: 'visibility, install surface, background honesty',
    browserAssumption: 'document.visibilityState, matchMedia standalone',
    nativeIntegration: 'Capacitor App plugin resume/pause can extend fieldLifecycle',
    status: 'partial',
  },
  {
    id: 'wake-lock',
    module: 'src/runtime/fieldWakeLock.ts',
    owns: 'Screen awake during mission, reacquire on foreground',
    browserAssumption: 'navigator.wakeLock Screen Wake Lock API',
    nativeIntegration: 'Native may use FLAG_KEEP_SCREEN_ON; same setFieldWakeLockActive entry',
    status: 'partial',
  },
  {
    id: 'native-discovery',
    module: 'src/lib/missionSync/nativeLink.ts',
    owns: 'Nearby + LAN payload bridge',
    browserAssumption: 'Web stubs; Wi‑Fi code + paste fallback',
    nativeIntegration: 'capacitor-hud-mission-link plugin — no orchestration change',
    status: 'ready',
  },
  {
    id: 'network-relay',
    module: 'src/lib/missionSync/observerMonitorChannel.ts',
    owns: 'Internet relay transport',
    browserAssumption: 'Supabase Realtime + navigator.onLine',
    nativeIntegration: 'Same relay path; native network transitions via existing online events',
    status: 'ready',
  },
  {
    id: 'webrtc-mesh',
    module: 'src/lib/missionSync/coordinator.ts',
    owns: 'WebRTC mesh data channel',
    browserAssumption: 'RTCPeerConnection in WebView',
    nativeIntegration: 'Capacitor WebView must expose WebRTC; TURN via turnConfig.ts env',
    status: 'partial',
  },
  {
    id: 'voice-sr',
    module: 'src/hud/VoicePanel.tsx',
    owns: 'Speech recognition lifecycle',
    browserAssumption: 'Web Speech API or browser-specific SR',
    nativeIntegration: 'Native wrapper may swap SR backend — VoicePanel owns recovery',
    status: 'partial',
  },
  {
    id: 'session-persist',
    module: 'src/lib/missionSync/persist.ts',
    owns: 'localStorage device id + session',
    browserAssumption: 'localStorage quota and sync',
    nativeIntegration: 'Capacitor Preferences can replace storage adapter later — same contract',
    status: 'ready',
  },
]

export type NativePortabilityAudit = {
  surface: ReturnType<typeof detectFieldLifecycleSurface>
  wakeLockSupported: boolean
  boundaries: PortabilityBoundary[]
  lifecycleItems: ReturnType<typeof auditNativeLifecycleCompatibility>
  gapCount: number
}

export function auditNativePortability(): NativePortabilityAudit {
  const boundaries = NATIVE_PORTABILITY_BOUNDARIES
  const lifecycleItems = auditNativeLifecycleCompatibility()
  return {
    surface: detectFieldLifecycleSurface(),
    wakeLockSupported: isFieldWakeLockSupported(),
    boundaries,
    lifecycleItems,
    gapCount:
      boundaries.filter((b) => b.status === 'gap').length +
      lifecycleItems.filter((i) => i.status === 'gap').length,
  }
}
