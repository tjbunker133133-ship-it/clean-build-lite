function reloadWithUpdateQuery(): void {
  const qs = new URLSearchParams(window.location.search)
  qs.set('update', String(Date.now()))
  const next =
    `${window.location.pathname}?${qs.toString()}${window.location.hash || ''}`
  window.location.href = next
}

export async function forceUpdateApp(): Promise<void> {
  console.log('[FORCE UPDATE] Checking SW')

  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const reg of regs) {
        await reg.update()
        const waiting = reg.waiting
        if (waiting) {
          waiting.postMessage({ type: 'SKIP_WAITING' })
        }
      }
    } catch (err) {
      console.warn('[FORCE UPDATE ERROR]', err)
    }
  }

  console.log('[FORCE UPDATE] Triggered')
  window.setTimeout(() => {
    console.log('[FORCE UPDATE] Reloading')
    reloadWithUpdateQuery()
  }, 500)
}
