import { WebPlugin } from '@capacitor/core'
import type { HudMissionLinkPlugin } from './definitions'

export class HudMissionLinkWeb extends WebPlugin implements HudMissionLinkPlugin {
  async getPlatformInfo() {
    return { available: false, platform: 'web', discoveryMethod: 'none' }
  }

  async startAdvertising(): Promise<void> {
    /* web uses QR / paste */
  }

  async stopAdvertising(): Promise<void> {
    /* noop */
  }

  async startDiscovery(): Promise<void> {
    /* noop */
  }

  async stopDiscovery(): Promise<void> {
    /* noop */
  }
}
