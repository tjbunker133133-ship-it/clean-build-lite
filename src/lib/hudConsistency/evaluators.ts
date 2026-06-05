import { headingDelta, normalizeHeading, readLastHeadingDebug } from '../deviceHeading'
import type {
  CompassHealthLevel,
  HudSystemHealth,
  LayoutHealthLevel,
  OverlayLayerStatus,
  RouteHealthLevel,
  RouteRenderMode,
  SnapEligibility,
  SnapHealthLevel,
  Tier2UsabilityLevel,
} from './types'

const COMPASS_STALL_MS = 12_000
const COMPASS_QUADRANT_JUMP_DEG = 90
const RAW_FUSED_DIVERGE_DEG = 45

export type CompassEvalInput = {
  heading: number | null
  status: string
  nowMs: number
  lastHeading: number | null
  lastChangeMs: number | null
  lastQuadrantJumpMs: number | null
}

export function evaluateCompassHealth(input: CompassEvalInput): {
  level: CompassHealthLevel
  warnings: string[]
  lastChangeMs: number | null
  lastQuadrantJumpMs: number | null
} {
  const warnings: string[] = []
  const debug = readLastHeadingDebug()
  let lastChangeMs = input.lastChangeMs
  let lastQuadrantJumpMs = input.lastQuadrantJumpMs

  if (input.heading != null) {
    if (input.heading < 0 || input.heading > 360 || !Number.isFinite(input.heading)) {
      warnings.push('heading_out_of_range')
    } else if (normalizeHeading(input.heading) !== input.heading) {
      warnings.push('heading_not_normalized')
    }
  }

  if (input.status === 'unavailable' && input.heading == null) {
    warnings.push('compass_unavailable')
  }

  if (input.status === 'level' && input.heading == null) {
    warnings.push('level_without_heading')
  }

  if (input.heading != null && input.lastHeading != null) {
    const delta = Math.abs(headingDelta(input.lastHeading, input.heading))
    if (delta >= 1) {
      lastChangeMs = input.nowMs
      if (delta >= COMPASS_QUADRANT_JUMP_DEG) {
        lastQuadrantJumpMs = input.nowMs
        warnings.push('quadrant_jump')
      }
    }
  } else if (input.heading != null && input.lastHeading == null) {
    lastChangeMs = input.nowMs
  }

  if (
    input.heading != null &&
    lastChangeMs != null &&
    input.nowMs - lastChangeMs > COMPASS_STALL_MS &&
    input.status !== 'unavailable'
  ) {
    warnings.push('heading_stalled')
  }

  if (debug?.rawAlpha != null && debug.fusedHeading != null && input.heading != null) {
    const diverge = Math.abs(headingDelta(debug.fusedHeading, input.heading))
    if (diverge > RAW_FUSED_DIVERGE_DEG) {
      warnings.push('raw_fused_divergence')
    }
  }

  let level: CompassHealthLevel = 'ok'
  if (warnings.includes('quadrant_jump') || warnings.includes('raw_fused_divergence')) {
    level = 'unstable'
  } else if (
    warnings.length > 0 &&
    !warnings.every((w) => w === 'heading_stalled')
  ) {
    level = 'degraded'
  } else if (warnings.includes('heading_stalled')) {
    level = 'degraded'
  }

  return { level, warnings, lastChangeMs, lastQuadrantJumpMs }
}

export type RouteEvalInput = {
  waypointCount: number
  snapEnabled: boolean
  pinLineFeatureCount: number
  trailLineFeatureCount: number
  trailLegCount: number
  trailLegTrailModeCount: number
}

export function evaluateRouteHealth(input: RouteEvalInput): {
  level: RouteHealthLevel
  routeRenderMode: RouteRenderMode
  warnings: string[]
} {
  const warnings: string[] = []
  let routeRenderMode: RouteRenderMode = 'none'

  if (input.waypointCount >= 2) {
    if (input.trailLineFeatureCount > 0 && input.snapEnabled && input.trailLegTrailModeCount > 0) {
      routeRenderMode = 'trail'
    } else if (input.pinLineFeatureCount > 0) {
      routeRenderMode = 'fallback_straight'
    } else {
      routeRenderMode = 'none'
      warnings.push('missing_polyline_despite_waypoints')
    }

    if (input.snapEnabled && input.trailLegTrailModeCount === 0 && input.trailLineFeatureCount === 0) {
      warnings.push('snap_enabled_no_trail_geometry')
    }

    if (input.waypointCount - 1 !== input.trailLegCount && input.trailLegCount > 0) {
      warnings.push('leg_count_mismatch')
    }
  }

  let level: RouteHealthLevel = 'ok'
  if (warnings.includes('missing_polyline_despite_waypoints')) {
    level = 'missing'
  } else if (warnings.length > 0) {
    level = 'degraded'
  }

  return { level, routeRenderMode, warnings }
}

export type SnapEvalInput = {
  toggleCapable: boolean
  toggleEnabled: boolean
  zoom: number | null
  minSnapZoom: number
  styleHasVectorTrails: boolean
  overlaySnapLayersActive: boolean
  mapPresent: boolean
}

export function evaluateSnapHealth(input: SnapEvalInput): {
  level: SnapHealthLevel
  eligibility: SnapEligibility
  snap_status_reason: string
  warnings: string[]
} {
  const warnings: string[] = []
  let eligibility: SnapEligibility = 'unavailable_reasoned'
  let snap_status_reason = 'map_unavailable'

  if (!input.mapPresent) {
    snap_status_reason = 'map_unavailable'
  } else if (input.zoom != null && input.zoom < input.minSnapZoom) {
    snap_status_reason = `zoom_below_${input.minSnapZoom}`
  } else if (input.styleHasVectorTrails) {
    eligibility = 'available'
    snap_status_reason = 'vector_trails_in_style'
  } else if (input.overlaySnapLayersActive) {
    eligibility = 'fallback_only'
    snap_status_reason = 'overlay_path_fallback'
  } else {
    snap_status_reason = 'no_trail_or_overlay_geometry'
  }

  if (input.styleHasVectorTrails && !input.toggleCapable) {
    warnings.push('vector_data_present_toggle_disabled')
  }
  if (input.overlaySnapLayersActive && !input.toggleCapable) {
    warnings.push('overlay_paths_present_toggle_disabled')
  }
  if (input.toggleEnabled && eligibility === 'unavailable_reasoned') {
    warnings.push('snap_enabled_but_ineligible')
  }

  let level: SnapHealthLevel = 'ok'
  if (warnings.includes('vector_data_present_toggle_disabled') || warnings.includes('overlay_paths_present_toggle_disabled')) {
    level = 'degraded'
  } else if (warnings.includes('snap_enabled_but_ineligible')) {
    level = 'blocked'
  }

  return { level, eligibility, snap_status_reason, warnings }
}

export type OverlayLayerEval = {
  id: string
  toggle: boolean
  loading: boolean
  error: string | null
  layerOnMap: boolean
  stale?: boolean
}

export function evaluateOverlayHealth(layers: OverlayLayerEval[]): {
  level: 'ok' | 'degraded'
  layerStatus: Record<string, { toggle: boolean; status: OverlayLayerStatus; error: string | null }>
  warnings: string[]
} {
  const warnings: string[] = []
  const layerStatus: Record<string, { toggle: boolean; status: OverlayLayerStatus; error: string | null }> = {}

  for (const layer of layers) {
    let status: OverlayLayerStatus = 'off'
    if (layer.toggle) {
      if (layer.error) status = 'failed'
      else if (layer.loading) status = 'pending'
      else if (layer.layerOnMap) status = 'active'
      else status = 'pending'
    }

    layerStatus[layer.id] = { toggle: layer.toggle, status, error: layer.error }

    if (layer.toggle && layer.stale && layer.layerOnMap) {
      warnings.push(`overlay_stale:${layer.id}`)
    }
    if (layer.toggle && !layer.loading && !layer.error && !layer.layerOnMap) {
      warnings.push(`overlay_silent_failure:${layer.id}`)
    }
    if (layer.toggle && layer.loading && !layer.layerOnMap) {
      /* expected pending — styledata/idle retry in flight */
    }
    if (layer.toggle && layer.error && !layer.layerOnMap) {
      warnings.push(`overlay_failed:${layer.id}`)
    }
  }

  const level = warnings.length > 0 ? 'degraded' : 'ok'
  return { level, layerStatus, warnings }
}

export type PanelRectLike = {
  x: number
  y: number
  w: number
  h: number | null
  docked?: boolean
}

export type LayoutEvalInput = {
  panels: Record<string, PanelRectLike | undefined>
  vw: number
  vh: number
  isMobile: boolean
}

function panelHeightGuess(h: number | null): number {
  return Math.max(76, h ?? 220)
}

function rectsOverlap(
  a: { l: number; t: number; r: number; b: number },
  b: { l: number; t: number; r: number; b: number },
  pad = 4,
): boolean {
  return !(a.r <= b.l + pad || a.l >= b.r - pad || a.b <= b.t + pad || a.t >= b.b - pad)
}

export function evaluateLayoutHealth(input: LayoutEvalInput): {
  level: LayoutHealthLevel
  dockedCount: number
  overlapCount: number
  misalignedCount: number
  warnings: string[]
} {
  const warnings: string[] = []
  let overlapCount = 0
  let misalignedCount = 0
  let dockedCount = 0

  const boxes: Array<{ id: string; l: number; t: number; r: number; b: number }> = []

  for (const [id, panel] of Object.entries(input.panels)) {
    if (!panel) continue
    const h = panelHeightGuess(panel.h)
    if (panel.docked) dockedCount += 1

    if (input.isMobile && panel.x > input.vw * 0.55 && panel.w < input.vw * 0.5) {
      /* likely desktop coord leaked onto narrow viewport */
      if (panel.x > input.vw - panel.w + 40) {
        misalignedCount += 1
        warnings.push(`mobile_desktop_coord:${id}`)
      }
    }

    if (panel.x < -4 || panel.y < 0 || panel.x + panel.w > input.vw + 8 || panel.y + h > input.vh + 8) {
      misalignedCount += 1
      warnings.push(`panel_off_viewport:${id}`)
    }

    boxes.push({ id, l: panel.x, t: panel.y, r: panel.x + panel.w, b: panel.y + h })
  }

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (rectsOverlap(boxes[i], boxes[j])) {
        overlapCount += 1
        warnings.push(`overlap:${boxes[i].id}:${boxes[j].id}`)
      }
    }
  }

  let level: LayoutHealthLevel = 'ok'
  if (overlapCount > 0) level = 'overlapping'
  else if (misalignedCount > 0) level = 'misaligned'

  return { level, dockedCount, overlapCount, misalignedCount, warnings }
}

/** Collapse domain diagnostics into one usability answer. */
export function aggregateTier2Usability(parts: {
  compass: CompassHealthLevel
  route: RouteHealthLevel
  snap: SnapHealthLevel
  overlay: 'ok' | 'degraded'
  layout: LayoutHealthLevel
}): Tier2UsabilityLevel {
  if (
    parts.compass === 'unstable' ||
    parts.route === 'missing' ||
    parts.snap === 'blocked' ||
    parts.layout === 'overlapping'
  ) {
    return 'unstable'
  }
  if (
    parts.compass === 'degraded' ||
    parts.route === 'degraded' ||
    parts.snap === 'degraded' ||
    parts.overlay === 'degraded' ||
    parts.layout === 'misaligned'
  ) {
    return 'degraded'
  }
  return 'ok'
}

export function buildHudSystemHealth(parts: {
  nowMs: number
  compass: ReturnType<typeof evaluateCompassHealth> & {
    heading: number | null
    status: string
  }
  route: ReturnType<typeof evaluateRouteHealth> & RouteEvalInput
  snap: ReturnType<typeof evaluateSnapHealth> & Pick<SnapEvalInput, 'toggleCapable' | 'toggleEnabled'>
  overlay: ReturnType<typeof evaluateOverlayHealth>
  layout: ReturnType<typeof evaluateLayoutHealth>
}): HudSystemHealth {
  const debug = readLastHeadingDebug()
  const rawFusedDeltaDeg =
    debug?.fusedHeading != null && parts.compass.heading != null
      ? Math.abs(headingDelta(debug.fusedHeading, parts.compass.heading))
      : null

  return {
    updatedAt: parts.nowMs,
    overall_health: aggregateTier2Usability({
      compass: parts.compass.level,
      route: parts.route.level,
      snap: parts.snap.level,
      overlay: parts.overlay.level,
      layout: parts.layout.level,
    }),
    compass_health: parts.compass.level,
    route_health: parts.route.level,
    snap_health: parts.snap.level,
    overlay_health: parts.overlay.level,
    layout_health: parts.layout.level,
    compass: {
      heading: parts.compass.heading,
      status: parts.compass.status,
      lastChangeMs: parts.compass.lastChangeMs,
      rawAlpha: debug?.rawAlpha ?? null,
      fusedHeading: debug?.fusedHeading ?? null,
      rawFusedDeltaDeg,
      warnings: parts.compass.warnings,
    },
    route: {
      waypointCount: parts.route.waypointCount,
      routeRenderMode: parts.route.routeRenderMode,
      pinLineFeatureCount: parts.route.pinLineFeatureCount,
      trailLineFeatureCount: parts.route.trailLineFeatureCount,
      trailLegCount: parts.route.trailLegCount,
      snapEnabled: parts.route.snapEnabled,
      warnings: parts.route.warnings,
    },
    snap: {
      eligibility: parts.snap.eligibility,
      snap_status_reason: parts.snap.snap_status_reason,
      toggleCapable: parts.snap.toggleCapable,
      toggleEnabled: parts.snap.toggleEnabled,
      warnings: parts.snap.warnings,
    },
    overlay: {
      layers: parts.overlay.layerStatus,
      warnings: parts.overlay.warnings,
    },
    layout: {
      dockedCount: parts.layout.dockedCount,
      overlapCount: parts.layout.overlapCount,
      misalignedCount: parts.layout.misalignedCount,
      warnings: parts.layout.warnings,
    },
  }
}
