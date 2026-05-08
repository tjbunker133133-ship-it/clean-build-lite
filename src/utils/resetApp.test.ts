import { describe, expect, it, afterEach, vi } from 'vitest'

function installWindowStub(opts: {
  confirm: () => boolean
  localStorageClear?: () => void
}) {
  const clearFn = vi.fn(opts.localStorageClear ?? (() => {}))
  const local = {
    clear: clearFn,
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    key: vi.fn(),
    length: 0,
  }
  const sess = {
    clear: vi.fn(),
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    key: vi.fn(),
    length: 0,
  }
  vi.stubGlobal('localStorage', local as unknown as Storage)
  vi.stubGlobal('sessionStorage', sess as unknown as Storage)
  vi.stubGlobal(
    'window',
    {
      confirm: vi.fn(opts.confirm),
      localStorage: local,
      sessionStorage: sess,
      location: { reload: vi.fn() },
      indexedDB: undefined,
      caches: undefined,
    } as unknown as Window & typeof globalThis,
  )
  return clearFn
}

describe('resetAppState', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('does not leave reset blocked after confirm cancel', async () => {
    installWindowStub({ confirm: () => false })
    const { resetAppState } = await import('./resetApp')
    await resetAppState()
    await resetAppState()
    expect(window.confirm).toHaveBeenCalledTimes(2)
  })

  it('allows a second attempt after localStorage.clear throws', async () => {
    let n = 0
    installWindowStub({
      confirm: () => true,
      localStorageClear: () => {
        n += 1
        if (n === 1) throw new Error('clear-fail')
      },
    })
    const confirmMock = window.confirm as ReturnType<typeof vi.fn>
    const { resetAppState } = await import('./resetApp')
    await resetAppState()
    confirmMock.mockReturnValue(false)
    await resetAppState()
    expect(confirmMock).toHaveBeenCalledTimes(2)
  })
})
