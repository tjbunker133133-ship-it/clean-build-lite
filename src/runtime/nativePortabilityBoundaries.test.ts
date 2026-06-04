import { describe, expect, it } from 'vitest'
import {
  auditNativePortability,
  NATIVE_PORTABILITY_BOUNDARIES,
} from './nativePortabilityBoundaries'

describe('nativePortabilityBoundaries', () => {
  it('registers platform isolation modules', () => {
    expect(NATIVE_PORTABILITY_BOUNDARIES.some((b) => b.id === 'native-discovery')).toBe(true)
    expect(NATIVE_PORTABILITY_BOUNDARIES.some((b) => b.id === 'wake-lock')).toBe(true)
  })

  it('runs combined portability audit', () => {
    const audit = auditNativePortability()
    expect(audit.boundaries.length).toBeGreaterThan(0)
    expect(audit.lifecycleItems.length).toBeGreaterThan(0)
    expect(typeof audit.gapCount).toBe('number')
  })
})
