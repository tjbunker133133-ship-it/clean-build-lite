import { describe, expect, it } from 'vitest'
import { shouldRefreshByDistance, shouldRefreshByInterval } from './panelDataThrottle'

describe('panelDataThrottle', () => {
  it('requires minimum movement before refresh', () => {
    const a = { lat: 40, lng: -105 }
    const b = { lat: 40.0001, lng: -105.0001 }
    expect(shouldRefreshByDistance(null, a, 200)).toBe(true)
    expect(shouldRefreshByDistance(a, b, 200)).toBe(false)
  })

  it('requires minimum interval before refresh', () => {
    expect(shouldRefreshByInterval(null, 60_000)).toBe(true)
    expect(shouldRefreshByInterval(1000, 60_000, 10_000)).toBe(false)
    expect(shouldRefreshByInterval(1000, 60_000, 70_000)).toBe(true)
  })
})
