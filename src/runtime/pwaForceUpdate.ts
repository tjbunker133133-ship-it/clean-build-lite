/**
 * Production PWA force-update helpers (Android Chrome / iOS Safari / installed PWAs).
 * Clears Workbox caches, activates waiting workers, and waits for controller turnover.
 */

const SW_UPDATE_TIMEOUT_MS = 2500
const FORCE_CYCLE_TIMEOUT_MS = 10000

const CACHE_BUST_PARAMS = ['update', 'v', 'hud_update'] as const

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), ms)),
  ])
}

/** Cache-busting navigation — required on iOS Safari where plain reload keeps stale bundles. */
export function hardReloadWithCacheBust(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    for (const key of CACHE_BUST_PARAMS) url.searchParams.delete(key)
    const stamp = String(Date.now())
    url.searchParams.set('update', stamp)
    url.searchParams.set('v', stamp)
    url.searchParams.set('hud_update', stamp)
    window.location.replace(url.toString())
    return
  } catch {
    /* fall through */
  }
  try {
    window.location.reload()
  } catch {
    window.location.href = window.location.href
  }
}

export async function clearWorkboxCaches(): Promise<number> {
  if (typeof window === 'undefined' || !('caches' in window)) return 0
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
    return keys.length
  } catch {
    return 0
  }
}

export function postSkipWaiting(reg: ServiceWorkerRegistration): void {
  for (const sw of [reg.waiting, reg.installing]) {
    try {
      sw?.postMessage({ type: 'SKIP_WAITING' })
    } catch {
      /* ignore */
    }
  }
}

export async function refreshServiceWorkerRegistrations(): Promise<ServiceWorkerRegistration[]> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return []
  try {
    const regs = [...(await navigator.serviceWorker.getRegistrations())]
    await Promise.all(
      regs.map((reg) =>
        withTimeout(reg.update().catch(() => undefined), SW_UPDATE_TIMEOUT_MS, undefined),
      ),
    )
    for (const reg of regs) postSkipWaiting(reg)
    return regs
  } catch {
    return []
  }
}

export async function unregisterAllServiceWorkers(): Promise<number> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 0
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)))
    return regs.length
  } catch {
    return 0
  }
}

export function waitForServiceWorkerControllerChange(timeoutMs: number): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(false)
  }
  const initialUrl = navigator.serviceWorker.controller?.scriptURL ?? ''
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve(ok)
    }
    const onChange = () => {
      const nextUrl = navigator.serviceWorker.controller?.scriptURL ?? ''
      finish(!initialUrl || nextUrl !== initialUrl)
    }
    const timer = window.setTimeout(() => finish(false), timeoutMs)
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
  })
}

async function runPwaForceUpdateCycleInner(options?: {
  activatePwaUpdate?: () => void
  maxWaitMs?: number
  hardReset?: boolean
}): Promise<{ controllerChanged: boolean; cachesCleared: number; unregistered: boolean }> {
  const maxWaitMs = options?.maxWaitMs ?? 8000
  options?.activatePwaUpdate?.()

  if (options?.hardReset) {
    const unregisteredCount = await unregisterAllServiceWorkers()
    const cachesCleared = await clearWorkboxCaches()
    return {
      controllerChanged: false,
      cachesCleared,
      unregistered: unregisteredCount > 0,
    }
  }

  let cachesCleared = await clearWorkboxCaches()
  let regs = await refreshServiceWorkerRegistrations()
  let controllerChanged = await waitForServiceWorkerControllerChange(maxWaitMs)

  if (!controllerChanged) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((r) => window.setTimeout(r, 400))
      regs = await refreshServiceWorkerRegistrations()
      controllerChanged = await waitForServiceWorkerControllerChange(1200)
      if (controllerChanged) break
    }
  }

  let unregistered = false
  if (!controllerChanged && regs.length > 0) {
    await unregisterAllServiceWorkers()
    cachesCleared += await clearWorkboxCaches()
    unregistered = true
  }

  return { controllerChanged, cachesCleared, unregistered }
}

export async function runPwaForceUpdateCycle(options?: {
  activatePwaUpdate?: () => void
  maxWaitMs?: number
  /** Operator force-update: unregister SW + clear caches (iOS-safe) without waiting on controllerchange. */
  hardReset?: boolean
}): Promise<{ controllerChanged: boolean; cachesCleared: number; unregistered: boolean }> {
  const timeoutMs = options?.hardReset ? 6000 : FORCE_CYCLE_TIMEOUT_MS
  return withTimeout(
    runPwaForceUpdateCycleInner(options),
    timeoutMs,
    { controllerChanged: false, cachesCleared: 0, unregistered: false },
  )
}
