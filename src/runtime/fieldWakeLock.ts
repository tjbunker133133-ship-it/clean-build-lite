/**
 * Keep the screen awake during an active field mission (Tier 2 comms/session).
 * Uses the Screen Wake Lock API where supported; no-op elsewhere.
 */

type WakeLockSentinel = { release: () => Promise<void> }

let sentinel: WakeLockSentinel | null = null
let wantActive = false
let acquiring = false
let reacquireTimer: ReturnType<typeof setTimeout> | null = null
type WakeLockListener = (held: boolean) => void
const wakeLockListeners = new Set<WakeLockListener>()

function notifyWakeLockListeners(): void {
  const held = sentinel != null
  wakeLockListeners.forEach((fn) => {
    try {
      fn(held)
    } catch {
      /* ignore */
    }
  })
}

async function tryAcquire(): Promise<void> {
  if (!wantActive || typeof navigator === 'undefined') return
  if (acquiring || sentinel) return // Prevent concurrent acquisition attempts

  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> }
  }
  if (!nav.wakeLock?.request) return

  acquiring = true
  try {
    sentinel = await nav.wakeLock.request('screen')
    notifyWakeLockListeners()
    sentinel.release().then(() => {
      sentinel = null
      notifyWakeLockListeners()
      // Debounced reacquire: wait 100ms to avoid thrashing
      if (wantActive && !reacquireTimer) {
        reacquireTimer = setTimeout(() => {
          reacquireTimer = null
          void tryAcquire()
        }, 100)
      }
    })
  } catch {
    sentinel = null
    notifyWakeLockListeners()
  } finally {
    acquiring = false
  }
}

export function setFieldWakeLockActive(active: boolean): void {
  wantActive = active
  if (!active) {
    void sentinel?.release()
    sentinel = null
    notifyWakeLockListeners()
    return
  }
  void tryAcquire()
}

export function isFieldWakeLockWanted(): boolean {
  return wantActive
}

export function subscribeFieldWakeLock(listener: WakeLockListener): () => void {
  wakeLockListeners.add(listener)
  listener(sentinel != null)
  return () => wakeLockListeners.delete(listener)
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
