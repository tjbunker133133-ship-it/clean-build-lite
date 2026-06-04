import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetDeviceProfileForTests, refreshDeviceProfile } from '../../runtime/deviceProfile'
import { getWearableCategories, readinessLabel } from './wearablesStatus'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

afterEach(() => {
  __resetDeviceProfileForTests()
  vi.unstubAllGlobals()
})

describe('wearablesStatus', () => {
  it('includes deadman wrist as planned', () => {
    vi.stubGlobal('navigator', {
      userAgent: IPHONE_UA,
      maxTouchPoints: 5,
    })
    vi.stubGlobal('window', {
      innerWidth: 390,
      innerHeight: 844,
      ontouchstart: true,
      matchMedia: () => ({ matches: false, addEventListener: undefined }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('Notification', { permission: 'granted' })
    refreshDeviceProfile()
    const deadman = getWearableCategories().find((c) => c.id === 'deadman_wrist')
    expect(deadman?.readiness).toBe('planned')
    expect(readinessLabel('works_today')).toBe('Works today')
  })
})
