import { describe, expect, it } from 'vitest'
import {
  buildHealthBiometricLine,
  formatHeartRateLine,
  healthRingReadiness,
  type HealthConnectUiSnapshot,
} from './healthConnectFormat'

const linked: HealthConnectUiSnapshot = {
  nativeEligible: true,
  sdkStatus: 'available',
  permissionsGranted: true,
  heartRateBpm: 72,
  heartRateRecordedAt: '2026-05-28T12:00:00Z',
  stepsToday: 4200,
  stepsRecordedAt: null,
}

describe('healthConnectFormat', () => {
  it('marks ring works_today when vitals present', () => {
    expect(healthRingReadiness(linked)).toBe('works_today')
  })

  it('formats heart rate line', () => {
    expect(formatHeartRateLine(80, null)).toContain('80 bpm')
  })

  it('builds biometric voice line with advisory disclaimer', () => {
    const line = buildHealthBiometricLine(linked)
    expect(line).toContain('72 beats per minute')
    expect(line).toMatch(/not used for SOS/i)
  })
})
