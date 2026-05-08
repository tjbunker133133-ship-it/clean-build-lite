import { traceAction } from '../runtime/actionTrace'
let isResetting = false
const RESET_IN_FLIGHT_KEY = 'hud_reset_in_flight_v1'
const RESET_RELOAD_GUARD_KEY = 'hud_reset_last_reload_v1'
const RESET_RELOAD_GUARD_MS = 15_000

function detectPwaMode(): boolean {
  try {
    const mq = window.matchMedia?.('(display-mode: standalone)')
    const legacyStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    return Boolean(mq?.matches || legacyStandalone)
  } catch {
    return false
  }
}

async function getLocalStorageSizeSafe(): Promise<number> {
  try {
    let total = 0
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (!k) continue
      const v = localStorage.getItem(k) ?? ''
      total += k.length + v.length
    }
    return total
  } catch {
    return -1
  }
}

type RecoveryResult = { ok: boolean; message: string }

export async function resetAppState(): Promise<RecoveryResult> {
  traceAction('reset_app', 'handler_enter')
  console.log('[ResetApp] button pressed')
  if (isResetting) {
    traceAction('reset_app', 'guard_reject', { reason: 'already_resetting' })
    return { ok: false, message: 'Reset already running' }
  }
  isResetting = true
  try {
    sessionStorage.setItem(RESET_IN_FLIGHT_KEY, String(Date.now()))
  } catch {
    // ignore
  }

  try {
    console.log('[APP RESET] Starting')

    const confirmed = window.confirm(
      'Reset app and reload? This will clear all saved data and restart setup.',
    )
    if (!confirmed) {
      traceAction('reset_app', 'guard_reject', { reason: 'operator_cancelled' })
      isResetting = false
      try {
        sessionStorage.removeItem(RESET_IN_FLIGHT_KEY)
      } catch {
        // ignore
      }
      return { ok: false, message: 'Reset cancelled' }
    }

    traceAction('reset_app', 'async_start', { step: 'storage_clear' })
    console.log('[ResetApp] clearing caches')
    if ('caches' in window && window.caches) {
      const keys = await window.caches.keys()
      await Promise.all(keys.map((k) => window.caches.delete(k)))
    }
    console.log('[ResetApp] clearing local storage')
    localStorage.clear()
    sessionStorage.clear()

    if ('indexedDB' in window && typeof (indexedDB as any).databases === 'function') {
      const dbs = await (indexedDB as any).databases()
      for (const db of dbs as Array<{ name?: string }>) {
        if (db?.name) {
          indexedDB.deleteDatabase(db.name)
        }
      }
    }

    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const reg of regs) {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        await reg.unregister()
      }
      traceAction('reset_app', 'async_complete', { step: 'sw_unregister', registrations: regs.length })
    }

    console.log('[APP RESET] Completed')
    traceAction('reset_app', 'state_result', { cleared: true })
  } catch (err) {
    console.warn('[APP RESET ERROR]', err)
    traceAction('reset_app', 'failure', {
      reason: 'reset_failed',
      message: (err as Error)?.message ?? 'unknown',
    })
    isResetting = false
    try {
      sessionStorage.removeItem(RESET_IN_FLIGHT_KEY)
    } catch {
      // ignore
    }
    return { ok: false, message: 'Reset failed before reload' }
  }

  if (import.meta.env.DEV) {
    let cacheKeys: string[] = []
    try {
      cacheKeys = 'caches' in window && window.caches ? await window.caches.keys() : []
    } catch {
      cacheKeys = []
    }
    const localStorageSize = await getLocalStorageSizeSafe()
    console.table({
      swRegistered: 'serviceWorker' in navigator,
      updateAvailable: false,
      cacheKeys: cacheKeys.length,
      localStorageSize,
      platform: navigator.userAgent,
      isPWA: detectPwaMode(),
    })
  }

  window.setTimeout(() => {
    try {
      const lastReloadAt = Number(sessionStorage.getItem(RESET_RELOAD_GUARD_KEY) ?? '0')
      if (Number.isFinite(lastReloadAt) && lastReloadAt > 0 && Date.now() - lastReloadAt < RESET_RELOAD_GUARD_MS) {
        console.warn('[ResetApp] reload suppressed by guard window')
        isResetting = false
        sessionStorage.removeItem(RESET_IN_FLIGHT_KEY)
        return
      }
      sessionStorage.setItem(RESET_RELOAD_GUARD_KEY, String(Date.now()))
      sessionStorage.removeItem(RESET_IN_FLIGHT_KEY)
    } catch {
      // ignore
    }
    console.log('[ResetApp] reload triggered')
    traceAction('reset_app', 'runtime_effect', { reloadRequested: true })
    window.location.reload()
  }, 300)
  return { ok: true, message: 'Reset triggered' }
}
