/**
 * HUD System Consistency Lock Layer — read-only diagnostic store.
 *
 * Observes compass, route, snap, overlay, and layout subsystems.
 * Does NOT modify core behavior; warnings only when debug flag enabled.
 */

import {
  buildHudSystemHealth,
  evaluateCompassHealth,
  evaluateLayoutHealth,
  evaluateOverlayHealth,
  evaluateRouteHealth,
  evaluateSnapHealth,
  type OverlayLayerEval,
  type RouteEvalInput,
} from '../lib/hudConsistency/evaluators'
import { HUD_SYSTEM_HEALTH_DEFAULT, type HudSystemHealth } from '../lib/hudConsistency/types'
import { hudDevLog } from '../lib/tier1DebugLog'
import { logWarn } from './logger'

type Listener = (health: HudSystemHealth) => void

const listeners = new Set<Listener>()

let health: HudSystemHealth = { ...HUD_SYSTEM_HEALTH_DEFAULT }

let lastBridgeInput: HudHealthBridgeInput | null = null

/** Route layer observation — updated by RouteLayer after each render sync. */
let routeObservation: RouteEvalInput = {
  waypointCount: 0,
  snapEnabled: false,
  pinLineFeatureCount: 0,
  trailLineFeatureCount: 0,
  trailLegCount: 0,
  trailLegTrailModeCount: 0,
}

/** Compass tracking refs owned by bridge (not stored in health object mutations). */
export const compassTrack = {
  lastHeading: null as number | null,
  lastChangeMs: null as number | null,
  lastQuadrantJumpMs: null as number | null,
}

let lastWarnKey: string | null = null

function notify(): void {
  for (const fn of listeners) {
    try {
      fn(health)
    } catch {
      /* ignore */
    }
  }
}

function logHealthWarnings(next: HudSystemHealth): void {
  const allWarnings = [
    ...next.compass.warnings.map((w) => `compass:${w}`),
    ...next.route.warnings.map((w) => `route:${w}`),
    ...next.snap.warnings.map((w) => `snap:${w}`),
    ...next.overlay.warnings.map((w) => `overlay:${w}`),
    ...next.layout.warnings.map((w) => `layout:${w}`),
  ]
  if (allWarnings.length === 0) {
    lastWarnKey = null
    return
  }
  const key = allWarnings.sort().join('|')
  if (key === lastWarnKey) return
  lastWarnKey = key
  hudDevLog('system-health', next)
  if (
    next.compass_health === 'unstable' ||
    next.route_health === 'missing' ||
    next.snap_health === 'blocked' ||
    next.layout_health === 'overlapping'
  ) {
    logWarn('RUNTIME', 'hud consistency guard', {
      compass: next.compass_health,
      route: next.route_health,
      snap: next.snap_health,
      overlay: next.overlay_health,
      layout: next.layout_health,
      warnings: allWarnings,
    })
  }
}

export function getHudSystemHealth(): HudSystemHealth {
  return health
}

export function subscribeHudSystemHealth(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function reportRouteLayerObservation(patch: Partial<RouteEvalInput>): void {
  routeObservation = { ...routeObservation, ...patch }
  if (lastBridgeInput) {
    recomputeHudSystemHealth(lastBridgeInput)
  }
}

export type HudHealthBridgeInput = {
  heading: number | null
  compassStatus: string
  snapToggleCapable: boolean
  snapToggleEnabled: boolean
  trailLegCount: number
  trailLegTrailModeCount: number
  overlayLayers: OverlayLayerEval[]
  panels: Record<string, { x: number; y: number; w: number; h: number | null; docked?: boolean } | undefined>
  vw: number
  vh: number
  isMobile: boolean
  mapZoom: number | null
  minSnapZoom: number
  styleHasVectorTrails: boolean
  overlaySnapLayersActive: boolean
  mapPresent: boolean
}

/** Recompute health from latest observations — called by HudSystemHealthBridge on dep change. */
export function recomputeHudSystemHealth(input: HudHealthBridgeInput): HudSystemHealth {
  const nowMs = Date.now()

  const compassEval = evaluateCompassHealth({
    heading: input.heading,
    status: input.compassStatus,
    nowMs,
    lastHeading: compassTrack.lastHeading,
    lastChangeMs: compassTrack.lastChangeMs,
    lastQuadrantJumpMs: compassTrack.lastQuadrantJumpMs,
  })
  compassTrack.lastHeading = input.heading
  compassTrack.lastChangeMs = compassEval.lastChangeMs
  compassTrack.lastQuadrantJumpMs = compassEval.lastQuadrantJumpMs

  const routeEval = evaluateRouteHealth({
    ...routeObservation,
    snapEnabled: input.snapToggleEnabled,
    trailLegCount: input.trailLegCount,
    trailLegTrailModeCount: input.trailLegTrailModeCount,
  })

  const snapEval = evaluateSnapHealth({
    toggleCapable: input.snapToggleCapable,
    toggleEnabled: input.snapToggleEnabled,
    zoom: input.mapZoom,
    minSnapZoom: input.minSnapZoom,
    styleHasVectorTrails: input.styleHasVectorTrails,
    overlaySnapLayersActive: input.overlaySnapLayersActive,
    mapPresent: input.mapPresent,
  })

  const overlayEval = evaluateOverlayHealth(input.overlayLayers)
  const layoutEval = evaluateLayoutHealth({
    panels: input.panels,
    vw: input.vw,
    vh: input.vh,
    isMobile: input.isMobile,
  })

  const next = buildHudSystemHealth({
    nowMs,
    compass: { ...compassEval, heading: input.heading, status: input.compassStatus },
    route: { ...routeEval, ...routeObservation, snapEnabled: input.snapToggleEnabled },
    snap: {
      ...snapEval,
      toggleCapable: input.snapToggleCapable,
      toggleEnabled: input.snapToggleEnabled,
    },
    overlay: overlayEval,
    layout: layoutEval,
  })

  lastBridgeInput = input
  health = next
  logHealthWarnings(next)
  notify()
  return next
}

let installed = false

export function installHudSystemHealth(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const w = window as Window & {
    __hudSystemHealth?: HudSystemHealth
    __hudSystemHealthGet?: () => HudSystemHealth
  }
  w.__hudSystemHealth = health
  w.__hudSystemHealthGet = () => health
  subscribeHudSystemHealth((h) => {
    w.__hudSystemHealth = h
  })
}
