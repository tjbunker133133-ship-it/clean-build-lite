let isResetting = false

export async function resetAppState() {
  if (isResetting) return
  isResetting = true

  try {
    console.log('[APP RESET] Starting')

    const confirmed = window.confirm(
      'Reset app and reload? This will clear all saved data and restart setup.',
    )
    if (!confirmed) return

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
    }

    console.log('[APP RESET] Completed')
  } catch (err) {
    console.warn('[APP RESET ERROR]', err)
  }

  window.setTimeout(() => {
    window.location.reload()
  }, 300)
}
