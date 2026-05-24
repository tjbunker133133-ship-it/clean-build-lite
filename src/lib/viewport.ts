/**
 * Single source for HUD layout + collision math.
 * Prefer VisualViewport so mobile drag/clamps match the visible area (Chrome/Safari URL bar).
 */
export function cockpitViewport(): { vw: number; vh: number } {
  if (typeof window === 'undefined') return { vw: 1280, vh: 720 }
  const vv = window.visualViewport
  return {
    vw: Math.round(vv?.width ?? window.innerWidth),
    vh: Math.round(vv?.height ?? window.innerHeight),
  }
}

export type CockpitSafeAreaInsets = {
  top: number
  right: number
  bottom: number
  left: number
}

/** Read env(safe-area-inset-*) once per session for panel clamp math. */
export function cockpitSafeAreaInsets(): CockpitSafeAreaInsets {
  if (typeof document === 'undefined') {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding:' +
    'env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) ' +
    'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
  document.documentElement.appendChild(el)
  const cs = getComputedStyle(el)
  const read = (v: string) => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : 0
  }
  const insets = {
    top: read(cs.paddingTop),
    right: read(cs.paddingRight),
    bottom: read(cs.paddingBottom),
    left: read(cs.paddingLeft),
  }
  document.documentElement.removeChild(el)
  return insets
}

/** Top chrome clearance: status bar inset + HUD top bar (~48px). */
export function cockpitMobileTopInset(safe = cockpitSafeAreaInsets()): number {
  return Math.max(36, Math.round(safe.top + 48))
}
