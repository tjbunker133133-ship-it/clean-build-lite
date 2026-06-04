import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetDeviceProfileForTests, refreshDeviceProfile } from '../runtime/deviceProfile'
import { getIosFieldCapabilityReport, iosWebPushRequirementLine } from './iosFieldCapabilities'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function installIphoneViewport() {
  vi.stubGlobal('navigator', { userAgent: IPHONE_UA, maxTouchPoints: 5 })
  vi.stubGlobal('window', {
    innerWidth: 390,
    innerHeight: 844,
    ontouchstart: true,
    matchMedia: () => ({ matches: false, addEventListener: undefined }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
}

afterEach(() => {
  __resetDeviceProfileForTests()
  vi.unstubAllGlobals()
})

describe('iosFieldCapabilities', () => {
  it('reports trail snap limitation on iOS field HUD', () => {
    installIphoneViewport()
    refreshDeviceProfile()
    const report = getIosFieldCapabilityReport()
    expect(report.isIosFieldHud).toBe(true)
    expect(report.vectorTrailFeaturesAvailable).toBe(false)
    expect(report.trailSnapLimitationReason).toContain('raster')
  })

  it('warns Safari tab users about push', () => {
    installIphoneViewport()
    refreshDeviceProfile()
    expect(iosWebPushRequirementLine()).toContain('Home Screen')
  })
})
