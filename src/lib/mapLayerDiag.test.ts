import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { isMapLayerDiagEnabled } from './mapLayerDiag'

describe('mapLayerDiag', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: {
        getItem: vi.fn(() => null),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is disabled by default', () => {
    expect(isMapLayerDiagEnabled()).toBe(false)
  })

  it('enables when hud_layer_log is set', () => {
    const getItem = vi.fn((key: string) => (key === 'hud_layer_log' ? '1' : null))
    vi.stubGlobal('localStorage', { getItem })
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem },
    })
    expect(isMapLayerDiagEnabled()).toBe(true)
  })

  it('enables when mapdebug query param is present', () => {
    vi.stubGlobal('window', {
      location: { search: '?mapdebug=1' },
      localStorage: { getItem: vi.fn(() => null) },
    })
    expect(isMapLayerDiagEnabled()).toBe(true)
  })
})
