import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EscalationProjection } from '../wal/types'
import { _resetWcelDiagnosticsForTests } from '../wcel/store'
import { projectToWatchNotification } from '../wal/outputChannels'
import {
  _resetDcrlStoreForTests,
  _resetSafeProjectForTests,
  _setSendToDeviceHandlerForTests,
  _setWcelEnforcementAvailableForTests,
  escalationToWearablePayload,
  safeProjectEscalationToChannel,
  safeProjectToWearable,
  throttleWearablePayload,
  upsertDcrlDevice,
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

function seedConnectedWatch(deviceId = 'watch-1'): void {
  upsertDcrlDevice({
    deviceId,
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
}

describe('safeProjectToWearable pipeline', () => {
  beforeEach(() => {
    _resetDcrlStoreForTests()
    _resetDcrlDynamicSyncForTests()
    _resetWcelDiagnosticsForTests()
    _resetSafeProjectForTests()
    _setSendToDeviceHandlerForTests(async () => ({ ok: true }))
  })

  it('ring receives zero outbound payloads — blocked by WCEL only', async () => {
    upsertDcrlDevice({
      deviceId: 'ring-1',
      type: 'ring',
      displayName: 'Ring',
      dynamic: {
        present: true,
        connected: true,
        authenticated: true,
        reachable: true,
        notificationPermission: 'unsupported',
        batteryPct: 80,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: true,
        lastSeenAt: Date.now(),
      },
    })
    const payload = escalationToWearablePayload(projection())
    const result = await safeProjectToWearable('ring-1', payload, 'ring_passive', projection())
    expect(result.blocked).toBe(true)
    if (result.blocked) expect(result.reason).toBe('wcel_violation')
  })

  it('watch receives only stripped notifications', async () => {
    seedConnectedWatch()
    const sends: unknown[] = []
    _setSendToDeviceHandlerForTests(async (_id, payload) => {
      sends.push(payload)
      return { ok: true }
    })

    const base = projection({ body: 'Full escalation body with extra operational detail.' })
    const result = await safeProjectToWearable(
      'watch-1',
      escalationToWearablePayload(base),
      'watch_notification',
      base,
    )

    expect(result.blocked).toBe(false)
    expect(sends[0]).toEqual({
      status: base.state,
      summary: base.body,
      alertLevel: base.urgency,
      timestamp: expect.any(Number),
    })
    expect(sends[0]).not.toHaveProperty('title')
    expect(sends[0]).not.toHaveProperty('body')
  })

  it('glasses receive minimal hints only', async () => {
    upsertDcrlDevice({
      deviceId: 'glasses-1',
      type: 'glasses',
      displayName: 'Glasses',
      dynamic: {
        present: true,
        connected: true,
        authenticated: true,
        reachable: true,
        notificationPermission: 'unsupported',
        batteryPct: 90,
        batteryLow: false,
        foreground: true,
        degraded: false,
        streaming: true,
        lastSeenAt: Date.now(),
      },
    })

    const sends: unknown[] = []
    _setSendToDeviceHandlerForTests(async (_id, payload) => {
      sends.push(payload)
      return { ok: true }
    })

    const payload = {
      status: 'escalation_pending',
      summary: 'Should not pass through to glasses',
      alertLevel: 'critical',
      directionHint: 'NE',
      alert: 'hold',
      title: 'Escalation pending',
      body: 'Waypoint map panel overlay',
    }

    const result = await safeProjectToWearable(
      'glasses-1',
      payload,
      'glasses_display',
      projection(),
    )

    expect(result.blocked).toBe(false)
    expect(sends[0]).toEqual({ directionHint: 'NE', alert: 'hold' })
    expect(throttleWearablePayload('glasses', payload)).toEqual({
      directionHint: 'NE',
      alert: 'hold',
    })
  })

  it('WCEL blocks invalid or HUD-leaking payloads after DCRL shaping', async () => {
    seedConnectedWatch()
    const leaky = projection({
      body: 'Waypoint 3 at lat: 45.1234, lng: -122.5678 — open map panel',
    })
    const result = await safeProjectToWearable(
      'watch-1',
      escalationToWearablePayload(leaky),
      'watch_notification',
      leaky,
    )
    expect(result.blocked).toBe(true)
    if (result.blocked) expect(result.reason).toBe('wcel_violation')
  })

  it('missing DCRL triggers safe downgrade mode without blocking', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sends: unknown[] = []
    _setSendToDeviceHandlerForTests(async (_id, payload) => {
      sends.push(payload)
      return { ok: true }
    })

    const base = projection()
    const result = await safeProjectToWearable(
      'slot-watch',
      escalationToWearablePayload(base),
      'watch_notification',
      base,
    )

    expect(result.blocked).toBe(false)
    expect(warn).toHaveBeenCalledWith('[hud-dcrl] dcrl_missing_fallback_safe_mode')
    expect(sends[0]).toEqual({
      status: 'degraded',
      summary: 'Limited connection',
      alertLevel: 'warning',
      timestamp: expect.any(Number),
    })
    warn.mockRestore()
  })

  it('missing WCEL fails closed and blocks all wearable output', async () => {
    seedConnectedWatch()
    _setWcelEnforcementAvailableForTests(false)
    const result = await safeProjectEscalationToChannel(projection(), 'watch_notification')
    expect(result.blocked).toBe(true)
    if (result.blocked) expect(result.reason).toBe('wcel_unavailable')
  })

  it('disconnected watch is downgraded by DCRL then sent if WCEL allows', async () => {
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

    const sends: unknown[] = []
    _setSendToDeviceHandlerForTests(async (_id, payload) => {
      sends.push(payload)
      return { ok: true }
    })

    const result = await safeProjectEscalationToChannel(projection(), 'watch_notification')
    expect(result.blocked).toBe(false)
    expect(sends[0]).toEqual({
      status: 'degraded',
      summary: 'Limited connection',
      alertLevel: 'warning',
      timestamp: expect.any(Number),
    })
  })
})

describe('outputChannels integration', () => {
  beforeEach(() => {
    _resetDcrlStoreForTests()
    _resetSafeProjectForTests()
    _setSendToDeviceHandlerForTests(async () => ({ ok: true }))
  })

  it('projectToWatchNotification routes only through safeProjectToWearable', async () => {
    seedConnectedWatch()
    const sends: string[] = []
    _setSendToDeviceHandlerForTests(async (_id, payload) => {
      sends.push(payload.summary ?? '')
      return { ok: true }
    })

    await projectToWatchNotification(projection())
    expect(sends.length).toBe(1)
  })

  it('no bypass exists around safeProjectToWearable when watch disconnected', async () => {
    upsertDcrlDevice({
      deviceId: 'slot-watch',
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

    const sends: unknown[] = []
    _setSendToDeviceHandlerForTests(async (_id, payload) => {
      sends.push(payload)
      return { ok: true }
    })

    await projectToWatchNotification(projection())
    expect(sends.length).toBe(1)
    expect(sends[0]).toMatchObject({ status: 'degraded', summary: 'Limited connection' })
  })
})
