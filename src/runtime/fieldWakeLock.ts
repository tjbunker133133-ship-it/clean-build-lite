/**
 * Keep the screen awake during an active field mission (Tier 2 comms/session).
 * Uses the Screen Wake Lock API where supported; no-op elsewhere.
 */

type WakeLockSentinel = { release: () => Promise<void> }

let sentinel: WakeLockSentinel | null = null
let wantActive = false

async function tryAcquire(): Promise<void> {
  if (!wantActive || typeof navigator === 'undefined') return
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> }
  }
  if (!nav.wakeLock?.request) return
  try {
    if (sentinel) return
    sentinel = await nav.wakeLock.request('screen')
    sentinel.release().then(() => {
      sentinel = null
      if (wantActive) void tryAcquire()
    })
  } catch {
    sentinel = null
  }
}

export function setFieldWakeLockActive(active: boolean): void {
  wantActive = active
  if (!active) {
    void sentinel?.release()
    sentinel = null
    return
  }
  void tryAcquire()
}

export function isFieldWakeLockSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  return Boolean((navigator as Navigator & { wakeLock?: unknown }).wakeLock)
}

export function isFieldWakeLockHeld(): boolean {
  return sentinel != null
}

/** Re-request after visibility return (browser releases lock when tab hidden). */
export function installFieldWakeLockRecovery(): () => void {
  if (typeof document === 'undefined') return () => {}
  const onVisible = () => {
    if (document.visibilityState === 'visible' && wantActive) void tryAcquire()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => document.removeEventListener('visibilitychange', onVisible)
}
