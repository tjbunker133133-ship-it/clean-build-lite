import { describe, expect, it } from 'vitest'
import { shouldAutoResumeGeolocation, shouldRunGpsStaleCheck } from './useGPS'

describe('shouldAutoResumeGeolocation', () => {
  it('resumes when the browser reports granted', () => {
    expect(shouldAutoResumeGeolocation('granted', false)).toBe(true)
  })

  it('does not resume on prompt or denied', () => {
    expect(shouldAutoResumeGeolocation('prompt', true)).toBe(false)
    expect(shouldAutoResumeGeolocation('denied', true)).toBe(false)
  })

  it('trusts stored grant only when Permissions API is unsupported', () => {
    expect(shouldAutoResumeGeolocation('unsupported', true)).toBe(true)
    expect(shouldAutoResumeGeolocation('unsupported', false)).toBe(false)
  })
})

describe('shouldRunGpsStaleCheck', () => {  it('suppresses stale checks while page is hidden', () => {
    expect(shouldRunGpsStaleCheck({ visibilityState: 'hidden' })).toBe(false)
  })

  it('allows stale checks while page is visible', () => {
    expect(shouldRunGpsStaleCheck({ visibilityState: 'visible' })).toBe(true)
  })
})
