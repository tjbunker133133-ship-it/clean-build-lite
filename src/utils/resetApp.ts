import { traceAction } from '../runtime/actionTrace'
let isResetting = false

export async function resetAppState() {
  traceAction('reset_app', 'handler_enter')
  if (isResetting) {
    traceAction('reset_app', 'guard_reject', { reason: 'already_resetting' })
    return
  }
  isResetting = true

  try {
    console.log('[APP RESET] Starting')

    const confirmed = window.confirm(
      'Reset app and reload? This will clear all saved data and restart setup.',
    )
    if (!confirmed) {
      traceAction('reset_app', 'guard_reject', { reason: 'operator_cancelled' })
      isResetting = false
      return
    }

    traceAction('reset_app', 'async_start', { step: 'storage_clear' })
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
    return
  }

  window.setTimeout(() => {
    traceAction('reset_app', 'runtime_effect', { reloadRequested: true })
    window.location.reload()
  }, 300)
}
