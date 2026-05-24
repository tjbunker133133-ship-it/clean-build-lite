import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetDeviceProfileForTests, refreshDeviceProfile } from '../runtime/deviceProfile'
import { shouldUseWaypointPointerDrag } from './waypointMarkerDrag'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function installViewport(ua: string, width: number, height: number, maxTouchPoints = 5) {
  vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints })
  vi.stubGlobal('window', {
    innerWidth: width,
    innerHeight: height,
    matchMedia: (q: string) => ({
      matches: q.includes('coarse') || q.includes('standalone'),
      addEventListener: undefined,
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
}

describe('shouldUseWaypointPointerDrag', () => {
  afterEach(() => {
    __resetDeviceProfileForTests()
    vi.unstubAllGlobals()
  })

  it('enables pointer drag on iPhone field HUD', () => {
    installViewport(IPHONE_UA, 390, 844)
    refreshDeviceProfile()
    expect(shouldUseWaypointPointerDrag()).toBe(true)
  })

  it('disables pointer drag on desktop', () => {
    installViewport(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      1280,
      800,
      0,
    )
    refreshDeviceProfile()
    expect(shouldUseWaypointPointerDrag()).toBe(false)
  })
})
