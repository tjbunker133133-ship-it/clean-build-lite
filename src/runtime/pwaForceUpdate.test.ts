import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { hardReloadWithCacheBust } from './pwaForceUpdate'

describe('hardReloadWithCacheBust', () => {
  const replace = vi.fn()

  beforeEach(() => {
    replace.mockReset()
    vi.stubGlobal('window', {
      location: {
        href: 'https://example.com/hud/?foo=1&update=old&v=old&hud_update=old',
        replace,
        reload: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('replaces location with fresh cache-bust params', () => {
    hardReloadWithCacheBust()
    expect(replace).toHaveBeenCalledTimes(1)
    const next = new URL(replace.mock.calls[0][0] as string)
    expect(next.searchParams.get('foo')).toBe('1')
    expect(next.searchParams.get('update')).not.toBe('old')
    expect(next.searchParams.get('v')).toBe(next.searchParams.get('update'))
    expect(next.searchParams.get('hud_update')).toBe(next.searchParams.get('update'))
  })
})
