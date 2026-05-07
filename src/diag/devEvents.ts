/**
 * DEV-only event bus consumed by `DevTestPanel`.
 *
 * Every public function early-returns when `import.meta.env.DEV` is false.
 * Vite replaces that flag with a literal `false` in production builds, so
 * the function bodies (and the listener Sets) are dead code that the
 * minifier eliminates. Production code still imports these symbols safely;
 * calling `emitPanelCommit` / `emitSystemNav` becomes a no-op.
 *
 * No console output, no timers, no side effects outside subscribed listeners.
 */

export type PanelCommitEvent = {
  panelId: string
  before: { w: number | null; h: number | null }
  after: { w: number | null; h: number | null }
  dw: number
  dh: number
  ts: number
}

export type SystemNavScheme = 'ios-prefs' | 'android-intent' | 'other'

export type SystemNavEvent = {
  phase: 'attempt' | 'success' | 'fallback'
  url: string
  scheme: SystemNavScheme
  ts: number
}

type PanelListener = (event: PanelCommitEvent) => void
type NavListener = (event: SystemNavEvent) => void

const panelListeners = new Set<PanelListener>()
const navListeners = new Set<NavListener>()

export function subscribePanelCommit(fn: PanelListener): () => void {
  if (!import.meta.env.DEV) return () => {}
  panelListeners.add(fn)
  return () => {
    panelListeners.delete(fn)
  }
}

export function subscribeSystemNav(fn: NavListener): () => void {
  if (!import.meta.env.DEV) return () => {}
  navListeners.add(fn)
  return () => {
    navListeners.delete(fn)
  }
}

export function emitPanelCommit(event: PanelCommitEvent): void {
  if (!import.meta.env.DEV) return
  if (panelListeners.size === 0) return
  for (const fn of panelListeners) {
    try {
      fn(event)
    } catch {
      /* listener errors must never disturb production logic */
    }
  }
}

export function emitSystemNav(event: SystemNavEvent): void {
  if (!import.meta.env.DEV) return
  if (navListeners.size === 0) return
  for (const fn of navListeners) {
    try {
      fn(event)
    } catch {
      /* listener errors must never disturb production logic */
    }
  }
}

export function classifySystemNavScheme(url: string): SystemNavScheme {
  if (/^(App-Prefs:|prefs:)/i.test(url)) return 'ios-prefs'
  if (/^intent:/i.test(url)) return 'android-intent'
  return 'other'
}
