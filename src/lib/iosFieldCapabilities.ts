/**
 * iOS / WebKit field capability notes — documentation + UI copy only.
 * Does not change runtime behavior; MapCanvas raster-vs-vector policy stays in Tier 1.
 */

import { getDeviceProfile, isIosFieldHud } from '../runtime/deviceProfile'

export type IosFieldCapabilityReport = {
  isIosFieldHud: boolean
  isStandalonePwa: boolean
  /** Trail snap + trail inspect need vector transportation layers. */
  vectorTrailFeaturesAvailable: boolean
  /** Why snap is usually off on iPhone Outdoor (stable raster basemap). */
  trailSnapLimitationReason: string | null
}

export function getIosFieldCapabilityReport(): IosFieldCapabilityReport {
  const p = getDeviceProfile()
  const iosField = isIosFieldHud()
  const standalone = p.isStandalone || p.isPWA
  const vectorTrailFeaturesAvailable = !iosField
  return {
    isIosFieldHud: iosField,
    isStandalonePwa: standalone,
    vectorTrailFeaturesAvailable,
    trailSnapLimitationReason: iosField
      ? 'On iPhone/iPad the HUD uses a stable raster Outdoor map (WebKit safety). Vector trail snap and tap-to-inspect trails are not available on Outdoor here — use straight pin-to-pin routes and corridor offline tiles.'
      : null,
  }
}

/** Short copy for Waypoint / navigation panels. */
export function iosTrailSnapUnavailableReason(): string {
  return (
    getIosFieldCapabilityReport().trailSnapLimitationReason ??
    'Trail snap needs vector layers at zoom 12+.'
  )
}

/** Push alerts on iOS only work from the Home Screen app (iOS 16.4+). */
export function iosWebPushRequirementLine(): string {
  const p = getDeviceProfile()
  if (!p.isIOS) return ''
  if (p.isStandalone) return 'Push alerts work in this Home Screen app (iOS 16.4+).'
  return 'Push alerts need Add to Home Screen — Safari tabs cannot subscribe on iOS.'
}
