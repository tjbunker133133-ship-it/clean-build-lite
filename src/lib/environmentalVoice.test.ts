import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  buildAiRouteVoiceMessage,
  buildArVoiceMessage,
  buildBiometricVoiceMessage,
  buildFireConditionsBrief,
  buildForageSeasonalTip,
  buildLidarVoiceMessage,
  buildWaterConditionsBrief,
  formatDeadManVoiceMessage,
  readDeadManVoiceStatus,
} from './environmentalVoice'

describe('environmentalVoice', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    })
  })

  it('formats unarmed deadman message', () => {
    expect(formatDeadManVoiceMessage(readDeadManVoiceStatus())).toContain('ARM TIMER')
  })

  it('reads armed deadman remaining time', () => {
    const now = 1_000_000
    vi.stubGlobal('localStorage', {
      getItem: () =>
        JSON.stringify({ armed: true, expiresAt: now + 90 * 60_000, durationMs: 2 * 60 * 60_000 }),
      setItem: vi.fn(),
    })
    const status = readDeadManVoiceStatus(now)
    expect(status.armed).toBe(true)
    expect(formatDeadManVoiceMessage(status)).toContain('remaining')
  })

  it('builds fire brief with elevated wind', () => {
    const msg = buildFireConditionsBrief({
      temperature: 82,
      humidity: 18,
      windSpeed: 24,
      condition: 'Clear sky',
      unit: '°F',
      windUnit: 'mph',
      location: 'Test',
      weatherCode: 0,
      updatedAt: Date.now(),
    })
    expect(msg).toContain('low humidity')
    expect(msg).toContain('elevated wind')
    expect(msg).toContain('FIRMS')
  })

  it('builds water brief for precipitation', () => {
    const msg = buildWaterConditionsBrief({
      temperature: 55,
      humidity: 90,
      windSpeed: 8,
      condition: 'Rain',
      unit: '°F',
      windUnit: 'mph',
      location: 'Test',
      weatherCode: 63,
      updatedAt: Date.now(),
    })
    expect(msg).toContain('precipitation')
    expect(msg).toContain('USGS')
  })

  it('returns seasonal forage tip', () => {
    expect(buildForageSeasonalTip(4)).toContain('morel')
  })

  it('returns tier wiring messages', () => {
    expect(buildAiRouteVoiceMessage(0, 0)).toContain('not in this build')
    expect(buildBiometricVoiceMessage(72)).toContain('72 percent')
    expect(buildBiometricVoiceMessage(72, 'Advisory vitals from Health Connect: 65 beats per minute.')).toContain(
      '65 beats per minute',
    )
    expect(buildLidarVoiceMessage(true)).toContain('Snap-to-trail')
    expect(buildArVoiceMessage()).toContain('not in this build')
  })
})
