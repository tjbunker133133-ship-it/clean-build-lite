/**
 * DEV-only Performance API helpers for low-noise observability.
 * Enable: localStorage.hud_obs = '1' or window.__HUD_OBS__ = 1 (read once on first use; reload to re-read).
 * No console output, no listeners, no timers.
 */

let cachedEnabled: boolean | null = null
let globalApiInstalled = false

function resolveEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled
  try {
    const w = typeof window !== 'undefined' ? (window as Window & { __HUD_OBS__?: number }).__HUD_OBS__ : undefined
    cachedEnabled =
      (typeof localStorage !== 'undefined' && localStorage.getItem('hud_obs') === '1') || w === 1
  } catch {
    cachedEnabled = false
  }
  return cachedEnabled
}

export function hudObsEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  return resolveEnabled()
}

function maybeInstallGlobalApi(): void {
  if (!resolveEnabled() || globalApiInstalled || typeof window === 'undefined') return
  globalApiInstalled = true
  ;(window as Window & { __hudObs?: { snapshot: () => Record<string, unknown> } }).__hudObs = {
    snapshot: () => ({
      hud_obs: true,
      hint: 'performance.getEntriesByType("mark") | getEntriesByType("measure")',
    }),
  }
}

export function hudObsMark(name: string): void {
  if (!import.meta.env.DEV) return
  if (!resolveEnabled()) return
  maybeInstallGlobalApi()
  try {
    performance.mark(name)
  } catch {
    /* duplicate name (e.g. StrictMode) or quota */
  }
}

export function hudObsMeasure(measureName: string, startMark: string, endMark: string): void {
  if (!import.meta.env.DEV) return
  if (!resolveEnabled()) return
  maybeInstallGlobalApi()
  try {
    performance.measure(measureName, startMark, endMark)
  } catch {
    /* missing marks or invalid range */
  }
}
