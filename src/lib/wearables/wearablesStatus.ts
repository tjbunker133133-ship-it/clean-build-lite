import { getDeviceProfile } from '../../runtime/deviceProfile'
import { getIosFieldCapabilityReport, iosWebPushRequirementLine } from '../iosFieldCapabilities'
import { isWebPushConfigured } from '../push/webPushConfig'
import { isWebPushSupported } from '../push/webPushClient'
import { healthRingReadiness } from './healthConnectFormat'
import { getWearablesHealthCache } from './wearablesHealthCache'

export type WearableReadiness = 'works_today' | 'phone_only' | 'planned' | 'unsupported'

export type WearableCategoryId =
  | 'phone_notifications'
  | 'smartwatch'
  | 'health_ring'
  | 'smart_glasses'
  | 'deadman_wrist'

export type WearableCategory = {
  id: WearableCategoryId
  title: string
  summary: string
  readiness: WearableReadiness
  steps: string[]
  note?: string
}

export type WearablesCompanionStatus = {
  platformLabel: string
  isStandalone: boolean
  notifications: NotificationPermission | 'unsupported'
  pushConfigured: boolean
  pushSupported: boolean
  nativeAndroidApp: boolean
  bluetoothMeshNote: string
}

function notificationState(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export function getWearablesCompanionStatus(): WearablesCompanionStatus {
  const p = getDeviceProfile()
  const platformLabel = p.isIOS
    ? p.isStandalone
      ? 'iOS Home Screen app'
      : 'iOS Safari tab'
    : p.isAndroid
      ? p.isStandalone
        ? 'Android installed app'
        : 'Android browser'
      : 'Desktop browser'

  return {
    platformLabel,
    isStandalone: p.isStandalone || p.isPWA,
    notifications: notificationState(),
    pushConfigured: isWebPushConfigured(),
    pushSupported: isWebPushSupported(),
    nativeAndroidApp: p.isAndroid && p.isStandalone,
    bluetoothMeshNote:
      'Android field app: Wi‑Fi + Bluetooth/Nearby discovery, then stable mesh. Browser: Share / QR / paste bundle.',
  }
}

export function getWearableCategories(): WearableCategory[] {
  const p = getDeviceProfile()
  const ios = getIosFieldCapabilityReport()
  const status = getWearablesCompanionStatus()
  const notifOk = status.notifications === 'granted'
  const health = getWearablesHealthCache()
  const ringReady = healthRingReadiness(health)

  const categories: WearableCategory[] = [
    {
      id: 'phone_notifications',
      title: 'Phone alerts',
      summary:
        'HUD shows system notifications on your phone. Paired watches mirror most Android alerts automatically.',
      readiness: notifOk ? 'works_today' : status.notifications === 'denied' ? 'unsupported' : 'phone_only',
      steps: [
        'Open this panel and tap Allow notifications (or use Preflight).',
        'Tap Send test alert and confirm it appears on the phone.',
        'On Pixel Watch: if the phone shows the alert, the watch should mirror it (Wear OS settings).',
      ],
      note: iosWebPushRequirementLine() || undefined,
    },
    {
      id: 'smartwatch',
      title: 'Smartwatch (Pixel Watch, Wear OS, Apple Watch)',
      summary:
        'No separate watch app in this build. The watch extends the phone via notification mirror and (later) Health Connect on Android.',
      readiness: notifOk && status.pushConfigured ? 'works_today' : 'phone_only',
      steps: [
        'Install HUD on the phone (PWA or Android field app) — not on the watch.',
        'For emergency contact alerts: share the push invite below; contact allows notifications on their phone.',
        'Field operator: use phone alerts today; wrist complications are planned (Tier 2).',
      ],
      note: p.isIOS
        ? 'Apple Watch mirrors iPhone notifications when HUD is installed to Home Screen.'
        : 'Pixel Watch mirrors phone notifications when watch is connected in Google Pixel Watch app.',
    },
    {
      id: 'health_ring',
      title: 'Health ring / band (Oura, Galaxy, etc.)',
      summary:
        ringReady === 'works_today'
          ? 'Health Connect is linked. Latest heart rate and steps show in Wearables (advisory only — not SOS or deadman).'
          : p.isAndroid && status.nativeAndroidApp
            ? 'Android field APK: link your ring or watch app to Health Connect, then allow read access in Wearables.'
            : 'Health Connect works in the Android field APK. Browser/PWA shows battery only via voice “biometric”.',
      readiness: ringReady,
      steps:
        ringReady === 'works_today'
          ? [
              'Refresh vitals in Wearables after activity.',
              'Voice “biometric” includes advisory heart rate and steps when linked.',
            ]
          : [
              'Install Signal One from the Play field APK (not browser only).',
              'In Wearables: Link Health Connect → allow heart rate and steps.',
              'Sync Oura / Samsung Health / Pixel Watch data into Health Connect first.',
            ],
      note:
        ringReady === 'works_today'
          ? 'Read-only. Does not trigger rescue or change deadman.'
          : undefined,
    },
    {
      id: 'smart_glasses',
      title: 'Smart glasses (AR / camera glasses)',
      summary: 'No device link in Tier 2. HUD stays on phone; glasses are not a safety input.',
      readiness: 'planned',
      steps: ['Use phone or watch mirror for alerts.', 'AR HUD overlay remains a later Tier 3 track.'],
    },
    {
      id: 'deadman_wrist',
      title: 'Deadman alerts on wrist',
      summary: 'Not enabled. Requires product and legal review before wrist-based deadman escalation.',
      readiness: 'planned',
      steps: [
        'Use in-app Deadman on the phone today.',
        'Optional later: wrist buzz when deadman warns — separate from contact SOS push.',
      ],
      note: 'Intentionally off until reviewed.',
    },
  ]

  if (ios.isIosFieldHud) {
    const watch = categories.find((c) => c.id === 'smartwatch')
    if (watch) {
      watch.note = [watch.note, ios.trailSnapLimitationReason].filter(Boolean).join(' ')
    }
  }

  return categories
}

export function readinessLabel(r: WearableReadiness): string {
  switch (r) {
    case 'works_today':
      return 'Works today'
    case 'phone_only':
      return 'Phone setup'
    case 'planned':
      return 'Planned'
    case 'unsupported':
      return 'Blocked'
  }
}

export function readinessColor(r: WearableReadiness): string {
  switch (r) {
    case 'works_today':
      return '#7dff8a'
    case 'phone_only':
      return '#ffd166'
    case 'planned':
      return '#94a3b8'
    case 'unsupported':
      return '#ff9aac'
  }
}
