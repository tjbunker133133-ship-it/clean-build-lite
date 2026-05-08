import {
  createForceUpdateMeta,
  FORCE_UPDATE_META_KEY,
  mergeForceUpdateMeta,
  SW_DEFERRED_RELOAD_KEY,
} from '../runtime/forceUpdateMeta'
import { traceAction } from '../runtime/actionTrace'
import { getRuntimeSnapshot } from '../runtime/runtimeSnapshot'
import { logInfo, logWarn } from '../runtime/logger'

const FORCE_UPDATE_IN_FLIGHT_KEY = 'hud_force_update_in_flight_v1'
const FORCE_UPDATE_LAST_RELOAD_KEY = 'hud_force_update_last_reload_v1'
const FORCE_UPDATE_RESULT_KEY = 'hud_force_update_result_v1'

/**
 * After a force-update navigation (`?update=`), clear session throttles so the
 * operator can run another force update immediately on the fresh document.
 */
export function consumeForceUpdateNavigationMark(): void {
  if (typeof window === 'undefined') return
  try {
    if (new URLSearchParams(window.location.search).has('update')) {
      sessionStorage.removeItem(FORCE_UPDATE_LAST_RELOAD_KEY)
      sessionStorage.removeItem(FORCE_UPDATE_IN_FLIGHT_KEY)
    }
  } catch {
    /* ignore */
  }
}

function reloadWithUpdateQuery(): void {
  const qs = new URLSearchParams(window.location.search)
  qs.set('update', String(Date.now()))
  const next =
    `${window.location.pathname}?${qs.toString()}${window.location.hash || ''}`
  window.location.href = next
}

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

/** Give Workbox time to finish precache after a new worker reaches installed/activated. */
async function waitForServiceWorkerLifecycle(
  reg: ServiceWorkerRegistration,
  maxMs: number,
): Promise<void> {
  const w = reg.installing ?? reg.waiting
  if (!w) return
  await new Promise<void>((resolve) => {
    const finish = () => resolve()
    const maybeFinish = () => {
      if (w.state === 'installed' || w.state === 'activated' || w.state === 'redundant') {
        w.removeEventListener('statechange', onState)
        finish()
      }
    }
    const onState = () => maybeFinish()
    w.addEventListener('statechange', onState)
    maybeFinish()
    window.setTimeout(() => {
      w.removeEventListener('statechange', onState)
      finish()
    }, maxMs)
  })
}

type RecoveryResult = { ok: boolean; message: string }

export async function forceUpdateApp(): Promise<RecoveryResult> {
  traceAction('force_update_app', 'handler_enter')
  logInfo('PWA', 'force update: handler enter')
  const now = Date.now()
  try {
    const inFlightAt = Number(sessionStorage.getItem(FORCE_UPDATE_IN_FLIGHT_KEY) ?? '0')
    if (Number.isFinite(inFlightAt) && inFlightAt > 0 && now - inFlightAt < 10_000) {
      return { ok: false, message: 'Force update already running' }
    }
    sessionStorage.setItem(FORCE_UPDATE_IN_FLIGHT_KEY, String(now))
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(
        FORCE_UPDATE_META_KEY,
        JSON.stringify(
          createForceUpdateMeta({
            requestedAt: Date.now(),
            requestBuildId: __BUILD_ID__,
          }),
        ),
      )
      sessionStorage.removeItem(SW_DEFERRED_RELOAD_KEY)
    } catch {
      // ignore storage failures
    }
  }

  let swRegistered = false
  let updateAvailable = false
  let activeWorkerCount = 0
  let registrationCount = 0
  let cacheKeys: string[] = []
  let localStorageSize = -1
  let registrationRef: ServiceWorkerRegistration | null = null
  const snapBefore = getRuntimeSnapshot()
  const beforeBuild = snapBefore.buildId
  const networkBuild = snapBefore.deploymentIntegrity.latestBuildId

  if ('serviceWorker' in navigator) {
    try {
      traceAction('force_update_app', 'async_start', { step: 'sw_registration_update' })
      const regs = await navigator.serviceWorker.getRegistrations()
      swRegistered = regs.length > 0
      registrationCount = regs.length
      activeWorkerCount = regs.filter((r) => Boolean(r.active)).length
      let waitingPresent = false
      for (const reg of regs) {
        registrationRef ??= reg
        await reg.update()
        const waiting = reg.waiting
        if (waiting) {
          waitingPresent = true
          updateAvailable = true
          logInfo('PWA', 'force update: waiting worker — skipWaiting', { scope: reg.scope })
          waiting.postMessage({ type: 'SKIP_WAITING' })
        }
        await waitForServiceWorkerLifecycle(reg, 6000)
      }
      if (import.meta.env.DEV) {
        try {
          cacheKeys = 'caches' in window && window.caches ? await window.caches.keys() : []
        } catch {
          cacheKeys = []
        }
        localStorageSize = await getLocalStorageSizeSafe()
        console.table({
          swRegistered,
          updateAvailable,
          cacheKeys: cacheKeys.length,
          localStorageSize,
          platform: navigator.userAgent,
          isPWA: detectPwaMode(),
        })
      }
      if (import.meta.env.DEV) {
        console.info('[HUD DEV] force-update-check', {
          registrations: regs.length,
          waitingPresent,
          activeWorkerCount,
          controllerUrl: navigator.serviceWorker.controller?.scriptURL ?? null,
        })
      }
      traceAction('force_update_app', 'async_complete', {
        step: 'sw_registration_update',
        registrations: regs.length,
        waitingPresent,
      })
    } catch (err) {
      logWarn('PWA', 'force update: service worker error', err)
      traceAction('force_update_app', 'failure', {
        reason: 'sw_update_failed',
        message: (err as Error)?.message ?? 'unknown',
      })
      try {
        sessionStorage.removeItem(FORCE_UPDATE_IN_FLIGHT_KEY)
      } catch {
        // ignore
      }
      return { ok: false, message: 'Force update failed while checking service worker' }
    }
  } else {
    traceAction('force_update_app', 'guard_reject', { reason: 'sw_unsupported' })
    try {
      sessionStorage.removeItem(FORCE_UPDATE_IN_FLIGHT_KEY)
    } catch {
      // ignore
    }
    return { ok: false, message: 'Service worker unsupported in this browser' }
  }

  if (activeWorkerCount > 1) {
    logWarn('PWA', 'force update: multiple registrations report an active worker', {
      activeWorkerCount,
      registrationCount,
    })
  }

  logInfo('PWA', 'force update: scheduling navigation reload')
  window.setTimeout(() => {
    try {
      sessionStorage.setItem(FORCE_UPDATE_LAST_RELOAD_KEY, String(Date.now()))
      const reloadReason =
        updateAvailable
          ? 'update_available'
          : snapBefore.deploymentIntegrity.staleStatus === 'stale_detected'
            ? 'recovery_reload'
            : 'already_latest'
      sessionStorage.setItem(
        FORCE_UPDATE_RESULT_KEY,
        JSON.stringify({
          beforeBuild,
          afterBuild: __BUILD_ID__,
          networkBuild,
          updateTriggered: true,
          reloadReason,
          swState: snapBefore.serviceWorker.status,
          cacheGeneration: snapBefore.deploymentIntegrity.cacheGeneration,
        }),
      )
      const raw = sessionStorage.getItem(FORCE_UPDATE_META_KEY)
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      sessionStorage.setItem(
        FORCE_UPDATE_META_KEY,
        JSON.stringify(
          mergeForceUpdateMeta(parsed, {
            reloadRequested: true,
            reloadRequestedAt: Date.now(),
          }),
        ),
      )
    } catch {
      // ignore storage failures
    }
    if (registrationRef?.waiting) {
      registrationRef.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
    traceAction('force_update_app', 'reload_requested', { source: 'force_update_timeout' })
    reloadWithUpdateQuery()
  }, 650)
  return { ok: true, message: 'Force update triggered' }
}
