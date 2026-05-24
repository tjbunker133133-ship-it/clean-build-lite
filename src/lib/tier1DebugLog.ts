/**
 * Verbose HUD dev console output. Enable: localStorage.hud_tier1_debug = '1'
 * (or window.__HUD_LOOP_DEBUG__ / HUD_LOOP_DEBUG globals).
 */
export function isHudVerboseDebug(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('hud_tier1_debug') === '1') {
      return true
    }
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    const w = window as Window & { __HUD_LOOP_DEBUG__?: number; HUD_LOOP_DEBUG?: number }
    if (w.__HUD_LOOP_DEBUG__ === 1 || w.HUD_LOOP_DEBUG === 1) return true
  }
  return false
}

/** Structured `[HUD DEV]` channel — silent unless verbose debug is enabled. */
export function hudDevLog(tag: string, detail?: unknown): void {
  if (!isHudVerboseDebug()) return
  if (detail !== undefined) console.info(`[HUD DEV] ${tag}`, detail)
  else console.info(`[HUD DEV] ${tag}`)
}

/**
 * Temporary Tier 1 audit logging. Enable: localStorage.hud_tier1_debug = '1'
 * No-op when off — does not change app behavior.
 */
export function tier1Debug(area: string, message: string, detail?: unknown): void {
  try {
    if (typeof localStorage === 'undefined' || localStorage.getItem('hud_tier1_debug') !== '1') {
      return
    }
  } catch {
    return
  }
  if (detail !== undefined) {
    console.info(`[tier1:${area}] ${message}`, detail)
  } else {
    console.info(`[tier1:${area}] ${message}`)
  }
}
