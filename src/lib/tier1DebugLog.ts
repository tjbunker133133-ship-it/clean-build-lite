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
