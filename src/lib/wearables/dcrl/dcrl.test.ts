import { beforeEach, describe, expect, it } from 'vitest'
import type { EscalationProjection } from '../wal/types'
import { enforceChannelProjection } from '../wcel/enforce'
import { _resetWcelDiagnosticsForTests } from '../wcel/store'
import {
  DCRL_STATIC_REGISTRY,
  WATCH_STATIC_PROFILE,
  filterChannelsByDcrl,
  gateChannelProjectionWithDcrl,
  resolveEffectiveCapability,
  resolveWcelThrottleDirective,
  upsertDcrlDevice,
  _resetDcrlStoreForTests,
  getDcrlDeviceByType,
} from './index'
import { _resetDcrlDynamicSyncForTests } from './sync'

function projection(partial: Partial<EscalationProjection> = {}): EscalationProjection {
  return {
    state: 'escalation_pending',
    title: 'Escalation pending',
    body: 'Possible emergency — cancel or confirm SOS.',
    urgency: 'critical',
    channels: ['phone', 'watch_notification'],
    ...partial,
  }
}

describe('DCRL static registry', () => {
  it('defines four canonical device types', () => {
    expect(Object.keys(DCRL_STATIC_REGISTRY).sort()).toEqual(['glasses', 'phone', 'ring', 'watch'])
  })

  it('phone is hud host with map and sos capabilities', () => {
    expect(DCRL_STATIC_REGISTRY.phone.role).toBe('hud_host')
    expect(DCRL_STATIC_REGISTRY.phone.staticCapabilities).toContain('map_render')
    expect(DCRL_STATIC_REGISTRY.phone.staticCapabilities).toContain('sos_dispatch')
  })

  it('ring has no output channels', () => {
    expect(WATCH_STATIC_PROFILE.outputChannels).toEqual(['watch_notification'])
    expect(DCRL_STATIC_REGISTRY.ring.outputChannels).toEqual([])
  })
})

describe('DCRL dynamic effective capability', () => {
  beforeEach(() => {
    _resetDcrlStoreForTests()
    _resetDcrlDynamicSyncForTests()
  })

  it('watch cannot output when notification permission missing', () => {
    upsertDcrlDevice({
      deviceId: 'watch-1',
      type: 'watch',
      displayName: 'Watch',
      dynamic: {
        present: true,
        connected: true,
        authenticated: true,
        reachable: true,
        notificationPermission: 'denied',
        batteryPct: null,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: true,
        lastSeenAt: Date.now(),
      },
    })
    const effective = resolveEffectiveCapability('watch')
    expect(effective.canReceiveOutput).toBe(false)
    expect(effective.allowedOutputChannels).toEqual([])
    expect(effective.reasons).toContain('notification_not_granted')
  })

  it('watch can output when connected and notifications granted', () => {
    upsertDcrlDevice({
      deviceId: 'watch-1',
      type: 'watch',
      displayName: 'Watch',
      dynamic: {
        present: true,
        connected: true,
        authenticated: true,
        reachable: true,
        notificationPermission: 'granted',
        batteryPct: 80,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: true,
        lastSeenAt: Date.now(),
      },
    })
    const effective = resolveEffectiveCapability('watch')
    expect(effective.canReceiveOutput).toBe(true)
    expect(effective.allowedOutputChannels).toEqual(['watch_notification'])
  })
})

describe('DCRL WCEL throttle directives', () => {
  beforeEach(() => {
    _resetDcrlStoreForTests()
    _resetWcelDiagnosticsForTests()
  })

  it('always allows phone channel', () => {
    const d = resolveWcelThrottleDirective('phone')
    expect(d.verdict).toBe('allow')
    expect(d.allowedChannels).toEqual(['phone'])
  })

  it('blocks watch channel when not connected', () => {
    upsertDcrlDevice({
      deviceId: 'watch-1',
      type: 'watch',
      displayName: 'Watch',
      dynamic: {
        present: true,
        connected: false,
        authenticated: false,
        reachable: true,
        notificationPermission: 'granted',
        batteryPct: null,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: false,
        lastSeenAt: null,
      },
    })
    const d = resolveWcelThrottleDirective('watch_notification')
    expect(d.verdict).toBe('block')
    expect(d.allowedChannels).toEqual(['phone'])
  })

  it('restricts non-critical watch output when phone is backgrounded', () => {
    upsertDcrlDevice({
      deviceId: 'host-phone',
      type: 'phone',
      displayName: 'Phone',
      dynamic: {
        present: true,
        connected: true,
        authenticated: true,
        reachable: true,
        notificationPermission: 'granted',
        batteryPct: 90,
        batteryLow: false,
        foreground: false,
        degraded: false,
        streaming: false,
        lastSeenAt: Date.now(),
      },
    })
    upsertDcrlDevice({
      deviceId: 'watch-1',
      type: 'watch',
      displayName: 'Watch',
      dynamic: {
        present: true,
        connected: true,
        authenticated: true,
        reachable: true,
        notificationPermission: 'granted',
        batteryPct: 90,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: true,
        lastSeenAt: Date.now(),
      },
    })
    const d = resolveWcelThrottleDirective('watch_notification', { urgency: 'info' })
    expect(d.verdict).toBe('restrict')
    expect(d.allowedChannels).toEqual(['phone'])
  })

  it('filterChannelsByDcrl is diagnostic-only and does not remove channels', () => {
    upsertDcrlDevice({
      deviceId: 'watch-1',
      type: 'watch',
      displayName: 'Watch',
      dynamic: {
        present: true,
        connected: false,
        authenticated: false,
        reachable: true,
        notificationPermission: 'granted',
        batteryPct: null,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: false,
        lastSeenAt: null,
      },
    })
    const filtered = filterChannelsByDcrl(['phone', 'watch_notification'], { urgency: 'critical' })
    expect(filtered).toEqual(['phone', 'watch_notification'])
  })
})

describe('DCRL + WCEL composed gate', () => {
  beforeEach(() => {
    _resetDcrlStoreForTests()
    _resetWcelDiagnosticsForTests()
  })

  it('DCRL shapes disconnected watch; WCEL decides allow/block', () => {
    upsertDcrlDevice({
      deviceId: 'watch-1',
      type: 'watch',
      displayName: 'Watch',
      dynamic: {
        present: true,
        connected: false,
        authenticated: false,
        reachable: true,
        notificationPermission: 'granted',
        batteryPct: null,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: false,
        lastSeenAt: null,
      },
    })
    expect(gateChannelProjectionWithDcrl('watch_notification', projection())).toBe(true)
  })

  it('passes valid watch projection through DCRL to WCEL', () => {
    upsertDcrlDevice({
      deviceId: 'watch-1',
      type: 'watch',
      displayName: 'Watch',
      dynamic: {
        present: true,
        connected: true,
        authenticated: true,
        reachable: true,
        notificationPermission: 'granted',
        batteryPct: 90,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: true,
        lastSeenAt: Date.now(),
      },
    })
    expect(gateChannelProjectionWithDcrl('watch_notification', projection())).toBe(true)
    expect(enforceChannelProjection('watch_notification', projection())).toBe(true)
  })

  it('WCEL blocks HUD leak after DCRL shaping', () => {
    upsertDcrlDevice({
      deviceId: 'watch-1',
      type: 'watch',
      displayName: 'Watch',
      dynamic: {
        present: true,
        connected: true,
        authenticated: true,
        reachable: true,
        notificationPermission: 'granted',
        batteryPct: 90,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: true,
        lastSeenAt: Date.now(),
      },
    })
    const leaky = projection({
      body: 'Waypoint panel at lat: 45.1234, lng: -122.5678',
    })
    expect(gateChannelProjectionWithDcrl('watch_notification', leaky)).toBe(false)
  })
})

describe('DCRL phone host seed', () => {
  beforeEach(() => {
    _resetDcrlStoreForTests()
  })

  it('registers phone host on diagnostics install path', () => {
    upsertDcrlDevice({
      deviceId: 'host-phone',
      type: 'phone',
      displayName: 'Mission HUD Host',
      dynamic: {
        present: true,
        connected: true,
        authenticated: true,
        reachable: true,
        notificationPermission: 'unsupported',
        batteryPct: null,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: false,
        lastSeenAt: null,
      },
    })
    expect(getDcrlDeviceByType('phone')?.type).toBe('phone')
  })
})
