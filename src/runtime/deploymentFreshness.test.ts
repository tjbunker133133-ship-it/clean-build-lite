import { afterEach, describe, expect, it, vi } from 'vitest'

type ListenerMap = Record<string, Array<(event: any) => void>>

function createStorage() {
  const map = new Map<string, string>()
  return {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      map.set(k, String(v))
    }),
    removeItem: vi.fn((k: string) => {
      map.delete(k)
    }),
    clear: vi.fn(() => map.clear()),
    key: vi.fn((i: number) => Array.from(map.keys())[i] ?? null),
    get length() {
      return map.size
    },
  } as unknown as Storage
}

function installRuntimeStubs(opts: { htmlEntrySrc: string }) {
  const listeners: ListenerMap = {}
  const addListener = (name: string, fn: (event: any) => void) => {
    listeners[name] = listeners[name] ?? []
    listeners[name].push(fn)
  }
  const dispatch = (name: string, event: any) => {
    for (const fn of listeners[name] ?? []) fn(event)
  }

  const sessionStorage = createStorage()
  const localStorage = createStorage()
  const cacheKeys = ['workbox-precache-v1', 'runtime-v1']
  const cacheEntries = ['/assets/index-old.js', '/assets/vendor-old.js']
  const cachesStub = {
    keys: vi.fn(async () => [...cacheKeys]),
    delete: vi.fn(async () => true),
    open: vi.fn(async () => ({
      keys: vi.fn(async () => cacheEntries.map((u) => ({ url: u }))),
    })),
  }

  const registrations = [
    {
      unregister: vi.fn(async () => true),
      waiting: null,
      active: { scriptURL: '/sw.js' },
      scope: '/',
      addEventListener: vi.fn(),
    },
  ]
  const swListeners: ListenerMap = {}
  const serviceWorker = {
    controller: { scriptURL: '/sw.js' },
    getRegistrations: vi.fn(async () => registrations as any),
    getRegistration: vi.fn(async () => registrations[0] as any),
    addEventListener: vi.fn((name: string, fn: (event: any) => void) => {
      swListeners[name] = swListeners[name] ?? []
      swListeners[name].push(fn)
    }),
  }

  class FakeDomParser {
    parseFromString() {
      return {
        querySelector: () => ({ src: opts.htmlEntrySrc }),
      }
    }
  }

  const locationReplace = vi.fn()
  const windowStub = {
    addEventListener: vi.fn(addListener),
    removeEventListener: vi.fn(),
    matchMedia: vi.fn(() => ({ matches: false })),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    caches: cachesStub,
    navigator: {
      userAgent: 'vitest',
      standalone: false,
      onLine: true,
      serviceWorker,
    },
    location: {
      origin: 'https://example.test',
      pathname: '/',
      search: '',
      hash: '',
      replace: locationReplace,
    },
    fetch: vi.fn(async () => ({
      ok: true,
      text: async () => `<!doctype html><script type="module" src="${opts.htmlEntrySrc}"></script>`,
    })),
  } as unknown as Window & typeof globalThis
  const fetchMock = windowStub.fetch as unknown as ReturnType<typeof vi.fn>

  const documentStub = {
    visibilityState: 'visible',
    addEventListener: vi.fn(addListener),
    removeEventListener: vi.fn(),
    querySelector: vi.fn(() => ({ src: '/assets/index-old.js' })),
  } as unknown as Document

  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('document', documentStub)
  vi.stubGlobal('navigator', windowStub.navigator)
  vi.stubGlobal('sessionStorage', sessionStorage)
  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('caches', cachesStub)
  vi.stubGlobal('fetch', windowStub.fetch as any)
  vi.stubGlobal('DOMParser', FakeDomParser as any)

  return {
    listeners,
    dispatch,
    sessionStorage,
    localStorage,
    cachesStub,
    serviceWorker,
    registrations,
    locationReplace,
    fetch: fetchMock,
  }
}

describe('deploymentFreshness', () => {
  const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it(
    'self-recovers once when network entry mismatches running entry',
    async () => {
      const env = installRuntimeStubs({ htmlEntrySrc: '/assets/index-new.js' })
      const mod = await import('./deploymentFreshness')
      mod.installDeploymentFreshnessGuard()
      await flush()

      expect(env.cachesStub.keys).toHaveBeenCalled()
      expect(env.cachesStub.delete).toHaveBeenCalled()
      expect(env.registrations[0].unregister).toHaveBeenCalled()
      expect(env.locationReplace).toHaveBeenCalledTimes(1)
      expect(env.sessionStorage.setItem).toHaveBeenCalledWith('reloadAttempted', '1')
    },
    15_000,
  )

  it('prevents infinite loop when recovery already attempted', async () => {
    const env = installRuntimeStubs({ htmlEntrySrc: '/assets/index-newer.js' })
    ;(env.sessionStorage.getItem as any).mockImplementation((k: string) =>
      k === 'reloadAttempted' ? '1' : null,
    )

    const mod = await import('./deploymentFreshness')
    mod.installDeploymentFreshnessGuard()
    await flush()

    expect(env.cachesStub.delete).not.toHaveBeenCalled()
    expect(env.registrations[0].unregister).not.toHaveBeenCalled()
    expect(env.locationReplace).not.toHaveBeenCalled()
  })

  it('does not fetch index.html when navigator is offline (zero-service boot)', async () => {
    const env = installRuntimeStubs({ htmlEntrySrc: '/assets/index-old.js' })
    const w = globalThis.window as Window & { navigator: { onLine: boolean } }
    w.navigator.onLine = false

    const mod = await import('./deploymentFreshness')
    mod.installDeploymentFreshnessGuard()
    await flush()

    expect(env.fetch).not.toHaveBeenCalled()
    expect(env.locationReplace).not.toHaveBeenCalled()
  })

  it('triggers stale recovery on dynamic import failure rejection', async () => {
    const env = installRuntimeStubs({ htmlEntrySrc: '/assets/index-old.js' })
    const mod = await import('./deploymentFreshness')
    mod.installDeploymentFreshnessGuard()
    await flush()

    env.dispatch('unhandledrejection', {
      reason: new Error('Failed to fetch dynamically imported module'),
    })
    await flush()

    expect(env.locationReplace).toHaveBeenCalledTimes(1)
    expect(env.cachesStub.delete).toHaveBeenCalled()
    expect(env.registrations[0].unregister).toHaveBeenCalled()
  })

})

