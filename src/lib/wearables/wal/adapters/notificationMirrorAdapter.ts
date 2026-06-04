/**
 * Android/iOS notification mirror adapter — projects outbound notifications only.
 * Inbound notification_ack requires future platform hooks; stub emits none.
 */

import type { WearableAdapter, WearableAdapterCapabilities, WearableSignalHandler } from '../types'

const capabilities: WearableAdapterCapabilities = {
  identity: {
    adapterId: 'notification_mirror',
    kind:
      typeof navigator !== 'undefined' && /iPhone|iPad/i.test(navigator.userAgent)
        ? 'ios_notification_mirror'
        : 'android_notification_mirror',
    displayName: 'Phone notification mirror',
    authenticated: false,
  },
  capabilities: ['notification_out'],
  platformNote: 'Watch mirrors phone notifications via OS — no direct watch API in Tier 2',
}

export const notificationMirrorAdapter: WearableAdapter = {
  capabilities,

  async authenticate() {
    if (typeof Notification === 'undefined') return false
    capabilities.identity.authenticated = Notification.permission === 'granted'
    return capabilities.identity.authenticated
  },

  async startStreaming(_onSignal: WearableSignalHandler) {
    /* Inbound ack stream not available in browser Tier 2 */
  },

  async stopStreaming() {},
}
