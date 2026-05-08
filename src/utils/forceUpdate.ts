import {
  createForceUpdateMeta,
  FORCE_UPDATE_META_KEY,
  mergeForceUpdateMeta,
  SW_DEFERRED_RELOAD_KEY,
} from '../runtime/forceUpdateMeta'
import { traceAction } from '../runtime/actionTrace'

function reloadWithUpdateQuery(): void {
  const qs = new URLSearchParams(window.location.search)
  qs.set('update', String(Date.now()))
  const next =
    `${window.location.pathname}?${qs.toString()}${window.location.hash || ''}`
  window.location.href = next
}

export async function forceUpdateApp(): Promise<void> {
  traceAction('force_update_app', 'handler_enter')
  console.log('[FORCE UPDATE] Checking SW')
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

  if ('serviceWorker' in navigator) {
    try {
      traceAction('force_update_app', 'async_start', { step: 'sw_registration_update' })
      const regs = await navigator.serviceWorker.getRegistrations()
      let waitingPresent = false
      for (const reg of regs) {
        await reg.update()
        const waiting = reg.waiting
        if (waiting) {
          waitingPresent = true
          waiting.postMessage({ type: 'SKIP_WAITING' })
        }
      }
      if (import.meta.env.DEV) {
        console.info('[HUD DEV] force-update-check', {
          registrations: regs.length,
          waitingPresent,
          controllerUrl: navigator.serviceWorker.controller?.scriptURL ?? null,
        })
      }
      traceAction('force_update_app', 'async_complete', {
        step: 'sw_registration_update',
        registrations: regs.length,
        waitingPresent,
      })
    } catch (err) {
      console.warn('[FORCE UPDATE ERROR]', err)
      traceAction('force_update_app', 'failure', {
        reason: 'sw_update_failed',
        message: (err as Error)?.message ?? 'unknown',
      })
    }
  } else {
    traceAction('force_update_app', 'guard_reject', { reason: 'sw_unsupported' })
  }

  console.log('[FORCE UPDATE] Triggered')
  window.setTimeout(() => {
    try {
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
    console.log('[FORCE UPDATE] Reloading')
    traceAction('force_update_app', 'reload_requested', { source: 'force_update_timeout' })
    reloadWithUpdateQuery()
  }, 500)
}
