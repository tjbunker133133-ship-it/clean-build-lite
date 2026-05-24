import type { LayerType } from '../types'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { mapStyleFingerprint } from './mapStyles'

/**
 * Field diagnostics for basemap layer switching (iOS Safari / PWA focus).
 * Enable: `?mapdebug=1`, `localStorage.hud_layer_log = '1'`, or `hud_tier1_debug = '1'`.
 */
export function isMapLayerDiagEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.location.search.includes('mapdebug=1')) return true
    if (localStorage.getItem('hud_layer_log') === '1') return true
    if (localStorage.getItem('hud_tier1_debug') === '1') return true
  } catch {
    /* ignore */
  }
  return false
}

export function mapLayerDiag(event: string, detail?: Record<string, unknown>): void {
  if (!isMapLayerDiagEnabled()) return
  const base = {
    ts: Date.now(),
    event,
    ...getMapRuntimeContext(),
  }
  if (detail !== undefined) {
    console.info('[map-layer-diag]', { ...base, ...detail })
  } else {
    console.info('[map-layer-diag]', base)
  }
}

export function getMapRuntimeContext(): Record<string, unknown> {
  const p = getDeviceProfile()
  return {
    isIOS: p.isIOS,
    isPWA: p.isPWA,
    isStandalone: p.isStandalone,
    isAppleWebKit: p.isAppleWebKit,
    interactionMode: p.interactionMode,
    orientation: p.orientation,
    viewport: { w: p.width, h: p.height },
    visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
  }
}

/** Probe WebGL availability (Safari/PWA can report supported but fail under memory pressure). */
export function probeWebGLSummary(): Record<string, unknown> {
  if (typeof document === 'undefined') return { available: false }
  try {
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext('experimental-webgl')
    if (!gl) return { available: false }
    const dbg = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info')
    return {
      available: true,
      version: (gl as WebGLRenderingContext).getParameter((gl as WebGLRenderingContext).VERSION),
      renderer: dbg
        ? (gl as WebGLRenderingContext).getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : 'unknown',
      maxTextureSize: (gl as WebGLRenderingContext).getParameter(
        (gl as WebGLRenderingContext).MAX_TEXTURE_SIZE,
      ),
    }
  } catch (e) {
    return { available: false, error: String(e) }
  }
}

export function logLayerSelection(
  layer: LayerType,
  styleUrl: string,
  extra?: Record<string, unknown>,
): void {
  mapLayerDiag('layer-selection', {
    layer,
    styleFp: mapStyleFingerprint(styleUrl),
    styleUrl: styleUrl.replace(/key=[^&]+/i, 'key=<redacted>'),
    webgl: probeWebGLSummary(),
    ...extra,
  })
}

export function logLayerActivation(
  layer: LayerType,
  outcome: 'ready' | 'raster-fallback' | 'osm-emergency' | 'stalled' | 'error' | 'retry',
  extra?: Record<string, unknown>,
): void {
  mapLayerDiag('layer-activation', { layer, outcome, ...extra })
}

export type StyleSwitchPhase =
  | 'start'
  | 'load'
  | 'idle'
  | 'data'
  | 'ready'
  | 'timeout'
  | 'error'

export function logStyleSwitchTiming(
  layer: LayerType,
  phase: StyleSwitchPhase,
  msSinceStart: number,
  extra?: Record<string, unknown>,
): void {
  mapLayerDiag('style-switch-timing', { layer, phase, msSinceStart, ...extra })
}

export function installMapLayerDiagHook(
  snapshot: () => Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return
  ;(window as Window & { __hudMapLayerDiag?: () => Record<string, unknown> }).__hudMapLayerDiag =
    () => ({
      ...getMapRuntimeContext(),
      webgl: probeWebGLSummary(),
      ...snapshot(),
    })
}
