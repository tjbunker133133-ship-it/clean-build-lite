import {
  createForceUpdateMeta,
  FORCE_UPDATE_META_KEY,
  FORCE_UPDATE_PENDING_KEY,
  mergeForceUpdateMeta,
  SW_DEFERRED_RELOAD_KEY,
} from '../runtime/forceUpdateMeta'
import { runPwaForceUpdateCycle } from '../runtime/pwaForceUpdate'
import { traceAction } from '../runtime/actionTrace'

function reloadWithUpdateQuery(): void {
  const url = new URL(window.location.href)
  url.searchParams.set('update', String(Date.now()))
  url.searchParams.set('v', String(Date.now()))
  window.location.replace(url.toString())
}

function readActivatePwaUpdate(): (() => void) | undefined {
  if (typeof window === 'undefined') return undefined
  const fn = (window as Window & { __hudActivatePwaUpdate?: () => void }).__hudActivatePwaUpdate
  return typeof fn === 'function' ? fn : undefined
}

export async function forceUpdateApp(): Promise<void> {
  traceAction('force_update_app', 'handler_enter')
  console.log('[FORCE UPDATE] Checking SW')
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(FORCE_UPDATE_PENDING_KEY, '1')
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

  try {
    traceAction('force_update_app', 'async_start', { step: 'pwa_force_cycle' })
    const result = await runPwaForceUpdateCycle({
      activatePwaUpdate: readActivatePwaUpdate(),
      maxWaitMs: 9000,
    })
    if (import.meta.env.DEV) {
      console.info('[HUD DEV] force-update-cycle', result)
    }
    traceAction('force_update_app', 'async_complete', {
      step: 'pwa_force_cycle',
      ...result,
    })
  } catch (err) {
    console.warn('[FORCE UPDATE ERROR]', err)
    traceAction('force_update_app', 'failure', {
      reason: 'pwa_force_cycle_failed',
      message: (err as Error)?.message ?? 'unknown',
    })
  }

  console.log('[FORCE UPDATE] Reloading')
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
  traceAction('force_update_app', 'reload_requested', { source: 'force_update_reload' })
  reloadWithUpdateQuery()
}
