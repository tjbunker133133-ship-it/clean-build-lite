/**
 * Production PWA force-update helpers (Android Chrome / installed PWAs).
 * Clears Workbox caches, activates waiting workers, and waits for controller turnover.
 */

export async function clearWorkboxCaches(): Promise<number> {
  if (typeof window === 'undefined' || !('caches' in window)) return 0
  const keys = await caches.keys()
  await Promise.all(keys.map((key) => caches.delete(key)))
  return keys.length
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
  const regs = [...(await navigator.serviceWorker.getRegistrations())]
  await Promise.all(regs.map((reg) => reg.update().catch(() => undefined)))
  for (const reg of regs) postSkipWaiting(reg)
  return regs
}

export async function unregisterAllServiceWorkers(): Promise<number> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 0
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)))
  return regs.length
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

export async function runPwaForceUpdateCycle(options?: {
  activatePwaUpdate?: () => void
  maxWaitMs?: number
}): Promise<{ controllerChanged: boolean; cachesCleared: number; unregistered: boolean }> {
  const maxWaitMs = options?.maxWaitMs ?? 8000
  const cachesCleared = await clearWorkboxCaches()
  options?.activatePwaUpdate?.()
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
    await clearWorkboxCaches()
    unregistered = true
  }

  return { controllerChanged, cachesCleared, unregistered }
}
