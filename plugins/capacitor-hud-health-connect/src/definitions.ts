export type HealthConnectSdkStatus =
  | 'available'
  | 'unavailable'
  | 'provider_update_required'
  | 'not_android'

export type HudHealthConnectAvailability = {
  platform: 'android' | 'web'
  sdkStatus: HealthConnectSdkStatus
  permissionsGranted: boolean
  /** Read-only advisory — never used for SOS or deadman. */
  advisoryOnly: true
}

export type HudHealthConnectSnapshot = {
  heartRateBpm: number | null
  heartRateRecordedAt: string | null
  stepsToday: number | null
  stepsRecordedAt: string | null
  permissionsGranted: boolean
  error?: string
  advisoryOnly: true
}

export interface HudHealthConnectPlugin {
  getAvailability(): Promise<HudHealthConnectAvailability>
  requestPermissions(): Promise<{ granted: string[] }>
  readSnapshot(): Promise<HudHealthConnectSnapshot>
  openHealthConnectSettings(): Promise<void>
}
