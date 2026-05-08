import { describe, expect, it } from 'vitest'
import { shouldRunGpsStaleCheck } from './useGPS'

describe('shouldRunGpsStaleCheck', () => {
  it('suppresses stale checks while page is hidden', () => {
    expect(shouldRunGpsStaleCheck({ visibilityState: 'hidden' })).toBe(false)
  })

  it('allows stale checks while page is visible', () => {
    expect(shouldRunGpsStaleCheck({ visibilityState: 'visible' })).toBe(true)
  })
})
