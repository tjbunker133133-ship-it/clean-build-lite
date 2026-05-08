import { getRuntimeSnapshot, updateDeploymentIntegrity, updateServiceWorker } from './runtimeSnapshot'
import { logInfo, logWarn } from './logger'
import { traceAction } from './actionTrace'

const RELOAD_ATTEMPT_KEY = 'reloadAttempted'
const LAST_CHECK_AT_KEY = 'hud_deploy_last_check_at_v1'
const CHECK_INTERVAL_MS = 90_000
const RUNTIME_BUILD_ID =
  typeof __BUILD_ID__ !== 'undefined' && typeof __BUILD_ID__ === 'string'
    ? __BUILD_ID__
    : 'unknown'

function normalizePath(urlLike: string): string {
  try {
    const u = new URL(urlLike, window.location.origin)
    return `${u.pathname}${u.search}`
  } catch {
    return urlLike
  }
}

function getCurrentEntryModulePath(): string | null {
  try {
    const currentModule = normalizePath(import.meta.url)
    if (currentModule.includes('/assets/')) return currentModule
    const node = document.querySelector('script[type="module"][src]') as HTMLScriptElement | null
    return node?.src ? normalizePath(node.src) : null
  } catch {
    return null
  }
}

function getLatestEntryFromHtml(html: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const node = doc.querySelector('script[type="module"][src]') as HTMLScriptElement | null
    return node?.src ? normalizePath(node.src) : null
  } catch {
    return null
  }
}

async function getCacheStats(): Promise<{ names: string[]; totalEntries: number }> {
  if (typeof window === 'undefined' || !('caches' in window) || !window.caches) {
    return { names: [], totalEntries: 0 }
  }
  try {
    const names = await window.caches.keys()
    let totalEntries = 0
    for (const name of names) {
      const cache = await window.caches.open(name)
      const keys = await cache.keys()
      totalEntries += keys.length
    }
    return { names, totalEntries }
  } catch {
    return { names: [], totalEntries: 0 }
  }
}

async function recoverFromStaleRuntime(reason: string): Promise<void> {
  traceAction('deployment_freshness_recovery', 'handler_enter', { reason })
  try {
    if (sessionStorage.getItem(RELOAD_ATTEMPT_KEY) === '1') {
      logWarn('RUNTIME', `deploy recovery skipped: reload already attempted (${reason})`)
      updateDeploymentIntegrity({
        staleStatus: 'stale_detected',
        recoveryInFlight: false,
        reloadAttempted: true,
      })
      return
    }
    sessionStorage.setItem(RELOAD_ATTEMPT_KEY, '1')
  } catch {
    // ignore
  }

  updateDeploymentIntegrity({
    staleStatus: 'recovering',
    recoveryInFlight: true,
    reloadAttempted: true,
  })

  try {
    if ('caches' in window && window.caches) {
      const keys = await window.caches.keys()
      await Promise.all(keys.map((k) => window.caches.delete(k)))
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((reg) => reg.unregister()))
    }
  } catch (err) {
    logWarn('RUNTIME', 'deploy stale recovery cleanup error', err)
  }

  traceAction('deployment_freshness_recovery', 'reload_requested', { reason })
  const qs = new URLSearchParams(window.location.search)
  qs.set('fresh', String(Date.now()))
  window.location.replace(`${window.location.pathname}?${qs.toString()}${window.location.hash || ''}`)
}

function attachChunkLoadRecovery(): void {
  const maybeRecover = (text: string) => {
    const lower = text.toLowerCase()
    if (
      lower.includes('failed to fetch dynamically imported module') ||
      lower.includes('importing a module script failed') ||
      lower.includes('chunkloaderror') ||
      lower.includes('loading chunk')
    ) {
      void recoverFromStaleRuntime('dynamic_import_failure')
    }
  }

  window.addEventListener('error', (event) => {
    if (!event) return
    const msg = String(event.message ?? '')
    const errMsg = String((event.error as Error | undefined)?.message ?? '')
    maybeRecover(`${msg} ${errMsg}`)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const text =
      reason instanceof Error
        ? `${reason.name} ${reason.message}`
        : typeof reason === 'string'
          ? reason
          : JSON.stringify(reason)
    maybeRecover(text)
  })
}

async function runNetworkFreshnessCheck(source: string): Promise<void> {
  const now = Date.now()
  try {
    const last = Number(localStorage.getItem(LAST_CHECK_AT_KEY) ?? '0')
    if (Number.isFinite(last) && now - last < CHECK_INTERVAL_MS && source === 'interval') return
  } catch {
    // ignore
  }

  const currentEntry = getCurrentEntryModulePath()
  const snap = getRuntimeSnapshot()
  const swState = snap.serviceWorker.status
  const { names, totalEntries } = await getCacheStats()

  let latestEntry: string | null = null
  let staleStatus: 'unknown' | 'fresh' | 'stale_detected' | 'recovering' = 'unknown'
  let lastValidationOk = false
  try {
    const res = await fetch(`/index.html?fresh=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' },
    })
    if (!res.ok) throw new Error(`freshness-fetch-${res.status}`)
    const html = await res.text()
    latestEntry = getLatestEntryFromHtml(html)
    lastValidationOk = true
    staleStatus =
      currentEntry && latestEntry && normalizePath(currentEntry) !== normalizePath(latestEntry)
        ? 'stale_detected'
        : 'fresh'
  } catch (err) {
    logWarn('RUNTIME', 'deploy network freshness check failed', err)
    staleStatus = 'unknown'
  }

  updateDeploymentIntegrity({
    currentBuildId: RUNTIME_BUILD_ID,
    latestBuildId: latestEntry,
    swState,
    cacheGeneration: names.join(', '),
    cacheCount: names.length,
    cacheEntryCount: totalEntries,
    lastNetworkValidationAt: now,
    lastNetworkValidationOk: lastValidationOk,
    staleStatus,
    updatePending: snap.runtimeContinuity.pendingSWUpdate,
  })

  if (import.meta.env.DEV) {
    console.table({
      source,
      currentBuildId: RUNTIME_BUILD_ID,
      latestBuildId: latestEntry ?? 'unknown',
      swState,
      cacheNames: names.length,
      cacheEntries: totalEntries,
      staleStatus,
      updatePending: snap.runtimeContinuity.pendingSWUpdate,
    })
  }

  try {
    localStorage.setItem(LAST_CHECK_AT_KEY, String(now))
  } catch {
    // ignore
  }

  if (staleStatus === 'stale_detected') {
    await recoverFromStaleRuntime('entry_module_mismatch')
  }
}

function attachSwDiagnostics(): void {
  if (!('serviceWorker' in navigator)) {
    updateServiceWorker({ status: 'unsupported' })
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const controllerUrl = navigator.serviceWorker.controller?.scriptURL ?? null
    logInfo('SW', 'controllerchange', { controllerUrl, build: RUNTIME_BUILD_ID })
  })

  void navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return
    if (typeof reg.addEventListener !== 'function') return
    reg.addEventListener('updatefound', () => {
      logInfo('SW', 'updatefound', { scope: reg.scope, build: RUNTIME_BUILD_ID })
      const installing = reg.installing
      if (!installing) return
      logInfo('SW', 'installing', { state: installing.state })
      installing.addEventListener('statechange', async () => {
        const stats = await getCacheStats()
        logInfo('SW', `state:${installing.state}`, {
          waiting: Boolean(reg.waiting),
          active: Boolean(reg.active),
          cacheNames: stats.names,
          cacheEntries: stats.totalEntries,
          build: RUNTIME_BUILD_ID,
        })
      })
    })
  })
}

export function installDeploymentFreshnessGuard(): void {
  attachChunkLoadRecovery()
  attachSwDiagnostics()
  void runNetworkFreshnessCheck('boot')
  window.addEventListener('focus', () => void runNetworkFreshnessCheck('focus'))
  window.addEventListener('pageshow', () => void runNetworkFreshnessCheck('pageshow'))
  window.addEventListener('online', () => void runNetworkFreshnessCheck('online'))
  window.setInterval(() => {
    void runNetworkFreshnessCheck('interval')
  }, CHECK_INTERVAL_MS)
}

