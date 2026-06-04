import { WebPlugin } from '@capacitor/core'
import type { HudHealthConnectPlugin } from './definitions'

export class HudHealthConnectWeb extends WebPlugin implements HudHealthConnectPlugin {
  async getAvailability() {
    return {
      platform: 'web' as const,
      sdkStatus: 'not_android' as const,
      permissionsGranted: false,
      advisoryOnly: true as const,
    }
  }

  async requestPermissions() {
    return { granted: [] as string[] }
  }

  async readSnapshot() {
    return {
      heartRateBpm: null,
      heartRateRecordedAt: null,
      stepsToday: null,
      stepsRecordedAt: null,
      permissionsGranted: false,
      error: 'Health Connect requires the Android field APK.',
      advisoryOnly: true as const,
    }
  }

  async openHealthConnectSettings(): Promise<void> {
    /* web */
  }
}
