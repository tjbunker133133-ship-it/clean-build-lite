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
