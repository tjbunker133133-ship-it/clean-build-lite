import { describe, expect, it, beforeEach } from 'vitest'
import type { EscalationProjection } from '../wal/types'
import {
  RING_CONTRACT,
  WATCH_CONTRACT,
  WEARABLE_DEVICE_CONTRACTS,
} from './contracts'
import { enforceChannelProjection, enforceEscalationProjection } from './enforce'
import { _resetWcelDiagnosticsForTests, getWcelDiagnostics } from './store'
import {
  validateEscalationProjection,
  validateWearableSignalIngress,
} from './validate'

function projection(partial: Partial<EscalationProjection>): EscalationProjection {
  return {
    state: 'escalation_pending',
    title: 'Escalation pending',
    body: 'Possible emergency — cancel or confirm SOS.',
    urgency: 'critical',
    channels: ['phone', 'watch_notification'],
    ...partial,
  }
}

describe('WCEL contracts', () => {
  it('defines phone as hud host', () => {
    expect(WEARABLE_DEVICE_CONTRACTS.phone.role).toBe('hud_host')
  })

  it('ring is input-only with no output channels', () => {
    expect(RING_CONTRACT.allowedOutputChannels).toEqual([])
    expect(RING_CONTRACT.role).toBe('sensor_input')
  })

  it('watch allows compressed status output only', () => {
    expect(WATCH_CONTRACT.allowedOutputChannels).toEqual(['watch_notification'])
    expect(WATCH_CONTRACT.maxBodyChars).toBe(180)
  })
})

describe('validateEscalationProjection', () => {
  it('allows valid escalation status to watch', () => {
    const r = validateEscalationProjection(projection({}))
    expect(r.verdict).toBe('allow')
  })

  it('blocks HUD map leak in watch body', () => {
    const r = validateEscalationProjection(
      projection({
        body: 'Waypoint 3 at lat: 45.1234, lng: -122.5678 — open map panel',
      }),
    )
    expect(r.verdict).toBe('block')
    expect(r.violations.some((v) => v.code === 'forbidden_hud_payload')).toBe(true)
  })

  it('blocks ring output channel', () => {
    const r = validateEscalationProjection(
      projection({ channels: ['ring_passive'] }),
    )
    expect(r.verdict).toBe('block')
    expect(r.violations.some((v) => v.code === 'device_input_only')).toBe(true)
  })

  it('blocks oversize watch notification body', () => {
    const r = validateEscalationProjection(
      projection({
        channels: ['watch_notification'],
        body: 'x'.repeat(200),
      }),
    )
    expect(r.verdict).toBe('block')
    expect(r.violations.some((v) => v.code === 'body_too_long')).toBe(true)
  })
})

describe('validateWearableSignalIngress', () => {
  it('allows heart_rate from ring', () => {
    const r = validateWearableSignalIngress(
      {
        type: 'heart_rate',
        value: 72,
        timestamp: Date.now(),
        sourceDevice: 'oura_ring',
        confidence: 0.9,
      },
      'ring',
    )
    expect(r.verdict).toBe('allow')
  })

  it('blocks display-oriented signal from ring', () => {
    const r = validateWearableSignalIngress(
      {
        type: 'user_emergency',
        value: 1,
        timestamp: Date.now(),
        sourceDevice: 'ring',
        confidence: 1,
      },
      'ring',
    )
    expect(r.verdict).toBe('block')
  })
})

describe('WCEL enforcement gate', () => {
  beforeEach(() => _resetWcelDiagnosticsForTests())

  it('blocks invalid watch projection at boundary', () => {
    const ok = enforceChannelProjection(
      'watch_notification',
      projection({ body: 'Render MapCanvas overlay at zoom 14' }),
    )
    expect(ok).toBe(false)
    expect(getWcelDiagnostics().totalBlocked).toBe(1)
  })

  it('allows valid projection through gate', () => {
    const ok = enforceEscalationProjection(projection({ channels: ['phone'] }))
    expect(ok).toBe(true)
    expect(getWcelDiagnostics().totalAllowed).toBe(1)
  })
})
