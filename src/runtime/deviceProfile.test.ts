import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDeviceProfileForTests,
  getDeviceProfile,
  isIosFieldHud,
  isMobileFieldHud,
  refreshDeviceProfile,
} from './deviceProfile'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

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

afterEach(() => {
  __resetDeviceProfileForTests()
  vi.unstubAllGlobals()
})

describe('deviceProfile iOS detection', () => {
  it('detects iPhone as iOS mobile field HUD', () => {
    installViewport(IPHONE_UA, 390, 844)
    const p = refreshDeviceProfile()
    expect(p.isIOS).toBe(true)
    expect(p.interactionMode).toBe('mobile')
    expect(isIosFieldHud()).toBe(true)
  })

  it('detects iPadOS desktop UA via touch-capable Mac UA', () => {
    installViewport(IPAD_DESKTOP_UA, 820, 1180, 5)
    const p = getDeviceProfile()
    expect(p.isIOS).toBe(true)
    expect(p.type).toBe('tablet')
    expect(p.interactionMode).toBe('mobile')
  })

  it('does not mark Android as iOS', () => {
    installViewport(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      412,
      915,
    )
    const p = refreshDeviceProfile()
    expect(p.isIOS).toBe(false)
    expect(p.isAndroid).toBe(true)
    expect(p.type).toBe('mobile')
    expect(isIosFieldHud()).toBe(false)
    expect(isMobileFieldHud()).toBe(true)
  })

  it('does not classify typical Android phone viewport as tablet', () => {
    installViewport(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      412,
      915,
    )
    const p = refreshDeviceProfile()
    expect(p.type).toBe('mobile')
    expect(p.interactionMode).toBe('mobile')
  })

  it('classifies large Android tablet viewport as tablet when UA lacks Mobile', () => {
    installViewport(
      'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      800,
      1280,
    )
    const p = refreshDeviceProfile()
    expect(p.type).toBe('tablet')
    expect(p.interactionMode).toBe('mobile')
  })

  it('classifies Android tablet with Mobile token when screen is tablet-sized', () => {
    installViewport(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      800,
      1280,
    )
    const p = refreshDeviceProfile()
    expect(p.type).toBe('tablet')
    expect(p.interactionMode).toBe('mobile')
  })

  it('updates orientation when viewport dimensions swap (landscape)', () => {
    installViewport(
      'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      800,
      1280,
    )
    expect(refreshDeviceProfile().orientation).toBe('portrait')
    installViewport(
      'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      1280,
      800,
    )
    expect(refreshDeviceProfile().orientation).toBe('landscape')
  })
})
