import type { PermissionStateLike } from './devicePermissions'

export type PermissionRecoveryPlatform = 'ios' | 'android' | 'desktop'

/** Field-facing platform bucket for short recovery copy (not interaction-mode). */
export function getPermissionRecoveryPlatform(): PermissionRecoveryPlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

export function wizardIntroHint(platform: PermissionRecoveryPlatform): string {
  switch (platform) {
    case 'ios':
      return 'Tap each prompt when it appears. If something stays off, use Settings, then return here.'
    case 'android':
      return 'Tap each prompt when it appears. If something stays off, check this site in Chrome, then return here.'
    default:
      return 'Tap each prompt when it appears. You can change access later in the browser site menu.'
  }
}

export function locationBlockedPrimaryLine(): string {
  return 'Location access is blocked.'
}

export function locationBlockedSecondaryLine(platform: PermissionRecoveryPlatform): string {
  switch (platform) {
    case 'ios':
      return 'Enable location for this site in Settings, then tap TRY AGAIN.'
    case 'android':
      return 'Allow location for this site in Chrome settings, then tap TRY AGAIN.'
    default:
      return 'Allow location for this site in your browser, then tap TRY AGAIN.'
  }
}

export function locationNotRequestedLine(): string {
  return 'Location is not on yet. Enable it when you are ready to share position.'
}

export function locationRequestingShortLine(): string {
  return 'Waiting for location…'
}

export function locationErrorShortLine(): string {
  return 'Location did not start. Wait a moment, then tap TRY AGAIN.'
}

/**
 * Reconcile Permissions API noise with persisted GPS outcome (Android prompt
 * after grant) and operator revoke (storage denied vs stale API granted).
 */
export function mergePersistedGeolocationState(
  api: PermissionStateLike,
  persistedGps: string | null,
): PermissionStateLike {
  if (api === 'prompt' && persistedGps === 'granted') return 'granted'
  if (api === 'prompt' && persistedGps === 'denied') return 'denied'
  if (api === 'granted' && persistedGps === 'denied') return 'denied'
  return api
}
