/**
 * Field lifecycle surface detection — portable across browser PWA and Capacitor.
 * No runtime side effects; safe for audits and readiness checks.
 */

import { getDeviceProfile } from './deviceProfile'
import { isFieldWakeLockSupported } from './fieldWakeLock'

export type FieldLifecycleSurface = 'browser-tab' | 'pwa-standalone' | 'capacitor-native'

export type NativeLifecycleAuditItem = {
  id: string
  area: string
  status: 'ready' | 'partial' | 'gap'
  note: string
}

export function detectFieldLifecycleSurface(): FieldLifecycleSurface {
  if (typeof window === 'undefined') return 'browser-tab'
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (cap?.isNativePlatform?.()) return 'capacitor-native'
  if (getDeviceProfile().isStandalone) return 'pwa-standalone'
  return 'browser-tab'
}

export function isFieldSessionBackgrounded(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'hidden'
}

/** Capacitor / Android foreground rules — audit checklist for native trajectory. */
export function auditNativeLifecycleCompatibility(): NativeLifecycleAuditItem[] {
  const surface = detectFieldLifecycleSurface()
  const wakeLock = isFieldWakeLockSupported()
  const hasVisibility = typeof document !== 'undefined' && 'visibilityState' in document
  const hasOnline = typeof navigator !== 'undefined' && 'onLine' in navigator

  return [
    {
      id: 'surface',
      area: 'Install surface',
      status: surface === 'browser-tab' ? 'partial' : 'ready',
      note:
        surface === 'capacitor-native'
          ? 'Capacitor native shell — full foreground lifecycle hooks available'
          : surface === 'pwa-standalone'
            ? 'Installed PWA — improved resume; OS may still suspend background tabs'
            : 'Browser tab — background throttling likely; add to Home Screen for field use',
    },
    {
      id: 'visibility',
      area: 'visibilitychange',
      status: hasVisibility ? 'ready' : 'gap',
      note: hasVisibility
        ? 'Page visibility wired for background honesty and wake-lock reacquire'
        : 'visibilityState unavailable — lifecycle honesty degraded',
    },
    {
      id: 'wake-lock',
      area: 'Screen wake lock',
      status: wakeLock ? 'ready' : 'partial',
      note: wakeLock
        ? 'Wake Lock API supported — reacquired on foreground return'
        : 'Wake lock unsupported — OS display sleep may interrupt coordination',
    },
    {
      id: 'network',
      area: 'Network transitions',
      status: hasOnline ? 'ready' : 'gap',
      note: hasOnline
        ? 'online/offline events available for relay degraded signaling'
        : 'Network state unknown — relay recovery may be delayed',
    },
    {
      id: 'native-discovery',
      area: 'Native mission discovery',
      status: surface === 'capacitor-native' ? 'ready' : 'partial',
      note:
        surface === 'capacitor-native'
          ? 'Nearby + LAN plugins active in Android shell'
          : 'Browser relies on Wi‑Fi code signaling + manual share bundles',
    },
    {
      id: 'notifications',
      area: 'Notification permission',
      status:
        typeof Notification !== 'undefined' || surface === 'capacitor-native' ? 'partial' : 'gap',
      note:
        'Mission alerts optional — native wrapper should request permission on first field session',
    },
  ]
}
