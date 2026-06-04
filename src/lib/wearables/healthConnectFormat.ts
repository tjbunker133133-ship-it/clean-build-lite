/** Pure formatters — safe for unit tests without native plugin. */

export type HealthConnectSdkStatus =
  | 'available'
  | 'unavailable'
  | 'provider_update_required'
  | 'not_android'

export type HealthConnectUiSnapshot = {
  sdkStatus: 'available' | 'unavailable' | 'provider_update_required' | 'not_android'
  permissionsGranted: boolean
  heartRateBpm: number | null
  heartRateRecordedAt: string | null
  stepsToday: number | null
  stepsRecordedAt: string | null
  error?: string
  nativeEligible: boolean
}

export function healthConnectSdkLabel(status: HealthConnectUiSnapshot['sdkStatus']): string {
  switch (status) {
    case 'available':
      return 'Available'
    case 'provider_update_required':
      return 'Update Health Connect app'
    case 'unavailable':
      return 'Unavailable'
    case 'not_android':
      return 'Android APK only'
  }
}

export function formatHeartRateLine(bpm: number | null, recordedAt: string | null): string {
  if (bpm == null) return 'Heart rate: no recent sample'
  const when = recordedAt ? formatShortTime(recordedAt) : ''
  return when ? `Heart rate: ${bpm} bpm (${when})` : `Heart rate: ${bpm} bpm`
}

export function formatStepsLine(steps: number | null): string {
  if (steps == null) return 'Steps today: —'
  return `Steps today: ${steps.toLocaleString()}`
}

function formatShortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function healthRingReadiness(
  snap: HealthConnectUiSnapshot | null,
): 'works_today' | 'phone_only' | 'planned' | 'unsupported' {
  if (!snap?.nativeEligible) return 'planned'
  if (snap.sdkStatus !== 'available') return 'phone_only'
  if (snap.permissionsGranted && (snap.heartRateBpm != null || snap.stepsToday != null)) {
    return 'works_today'
  }
  if (snap.sdkStatus === 'available') return 'phone_only'
  return 'planned'
}

export function buildHealthBiometricLine(snap: HealthConnectUiSnapshot | null): string | null {
  if (!snap?.permissionsGranted) return null
  const parts: string[] = []
  if (snap.heartRateBpm != null) parts.push(`${snap.heartRateBpm} beats per minute`)
  if (snap.stepsToday != null) parts.push(`${snap.stepsToday} steps today`)
  if (parts.length === 0) {
    return 'Health Connect linked; no recent vitals yet. Advisory only — not used for SOS or deadman.'
  }
  return `Advisory vitals from Health Connect: ${parts.join('; ')}. Not used for SOS or deadman.`
}
