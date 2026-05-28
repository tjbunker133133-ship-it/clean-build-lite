import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetDeviceProfileForTests, refreshDeviceProfile } from '../../runtime/deviceProfile'
import { getVoiceListenProfile } from './voiceListenProfile'

function installViewport(ua: string, width: number, height: number, maxTouchPoints = 5) {
  vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints })
  vi.stubGlobal('window', {
    innerWidth: width,
    innerHeight: height,
    matchMedia: () => ({ matches: false, addEventListener: undefined }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
}

afterEach(() => {
  __resetDeviceProfileForTests()
  vi.unstubAllGlobals()
})

describe('getVoiceListenProfile', () => {
  it('power-save on mobile uses non-continuous SR', () => {
    installViewport(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      412,
      915,
    )
    refreshDeviceProfile()
    const profile = getVoiceListenProfile('powerSave')
    expect(profile.powerSave).toBe(true)
    expect(profile.continuous).toBe(false)
    expect(profile.pauseSrDuringTts).toBe(true)
  })

  it('hard-listen on mobile uses continuous SR with shorter restart gap', () => {
    installViewport(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      412,
      915,
    )
    refreshDeviceProfile()
    const profile = getVoiceListenProfile('hardListen')
    expect(profile.continuous).toBe(true)
    expect(profile.minRestartGapMs).toBeLessThan(2000)
    expect(profile.wakeContinuationMs).toBeGreaterThanOrEqual(12_000)
  })

  it('tablet hard-listen has moderate restart gap', () => {
    installViewport(
      'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      800,
      1280,
    )
    refreshDeviceProfile()
    expect(getVoiceListenProfile('hardListen').minRestartGapMs).toBe(900)
  })
})
