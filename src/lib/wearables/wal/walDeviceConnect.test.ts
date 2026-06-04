import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  classifyWearables,
  buildReadyCard,
  CONNECT_WEARABLE_ERROR_LABEL,
  CONNECT_WEARABLE_SEARCH_LABEL,
} from './walDeviceConnect'
import type { WalDeviceProbe } from './walConnection'

describe('classifyWearables', () => {
  it('classifies watch when vitals and notifications available', () => {
    const probes: WalDeviceProbe[] = [
      {
        adapterId: 'android_health_connect',
        displayName: 'HC',
        kind: 'android_health_connect',
        available: true,
        authenticated: true,
        capabilities: ['heart_rate', 'motion'],
      },
      {
        adapterId: 'notification_mirror',
        displayName: 'Notif',
        kind: 'android_notification_mirror',
        available: true,
        authenticated: true,
        capabilities: ['notification_out'],
      },
    ]
    const c = classifyWearables(probes)
    expect(c.type).toBe('watch')
    expect(c.headline).toBe('Watch connected')
  })

  it('classifies ring when vitals only', () => {
    const probes: WalDeviceProbe[] = [
      {
        adapterId: 'android_health_connect',
        displayName: 'HC',
        kind: 'android_health_connect',
        available: true,
        authenticated: true,
        capabilities: ['heart_rate'],
      },
    ]
    const c = classifyWearables(probes)
    expect(c.type).toBe('ring')
    expect(c.headline).toBe('Biometric sensor found')
  })

  it('falls back to phone-only', () => {
    const c = classifyWearables([
      {
        adapterId: 'generic_fallback',
        displayName: 'Fallback',
        kind: 'generic_fallback',
        available: true,
        authenticated: false,
        capabilities: ['battery'],
      },
    ])
    expect(c.type).toBe('phone_only')
    expect(c.headline).toBe('Phone-only mode active')
  })
})

describe('buildReadyCard', () => {
  it('builds success card for watch', () => {
    const card = buildReadyCard(
      {
        type: 'watch',
        headline: 'Watch connected',
        adapterIds: ['notification_mirror'],
        capabilities: ['notification_out'],
      },
      true,
      true,
    )
    expect(card.title).toBe('Wearable Ready')
    expect(card.watchLine).toBe('Connected')
    expect(card.signalsLine).toBe('Active')
    expect(card.primaryButton).toBe('Done')
  })

  it('builds partial card for phone-only', () => {
    const card = buildReadyCard(
      {
        type: 'phone_only',
        headline: 'Phone-only mode active',
        adapterIds: ['generic_fallback'],
        capabilities: [],
      },
      false,
      false,
    )
    expect(card.title).toBe('Limited Wearable Support')
    expect(card.primaryButton).toBe('Continue')
  })
})

describe('connect UX labels', () => {
  it('uses non-technical search copy', () => {
    expect(CONNECT_WEARABLE_SEARCH_LABEL).toBe('Searching for wearable...')
    expect(CONNECT_WEARABLE_ERROR_LABEL).not.toMatch(/health connect|adapter|api/i)
  })
})
