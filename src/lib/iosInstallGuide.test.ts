import { afterEach, describe, expect, it, vi } from 'vitest'
import { iosInstallCopy } from './iosInstallGuide'
import { __resetDeviceProfileForTests, refreshDeviceProfile } from '../runtime/deviceProfile'

describe('iosInstallCopy', () => {
  afterEach(() => {
    __resetDeviceProfileForTests()
    vi.unstubAllGlobals()
  })

  it('warns against bookmark for phone and tablet', () => {
    const phone = iosInstallCopy(false)
    expect(phone.title).toBe('ADD TO HOME SCREEN')
    expect(phone.avoid.toLowerCase()).toContain('bookmark')
    const tablet = iosInstallCopy(true)
    expect(tablet.steps[0]).toContain('top')
  })
})
