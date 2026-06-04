export type CompassHealthLevel = 'ok' | 'degraded' | 'unstable'

export type RouteHealthLevel = 'ok' | 'degraded' | 'missing'

export type RouteRenderMode = 'trail' | 'fallback_straight' | 'none'

export type SnapEligibility = 'available' | 'fallback_only' | 'unavailable_reasoned'

export type SnapHealthLevel = 'ok' | 'degraded' | 'blocked'

export type OverlayLayerStatus = 'active' | 'pending' | 'failed' | 'off'

export type LayoutHealthLevel = 'ok' | 'misaligned' | 'overlapping'

export type HudSystemHealth = {
  updatedAt: number
  compass_health: CompassHealthLevel
  route_health: RouteHealthLevel
  snap_health: SnapHealthLevel
  overlay_health: 'ok' | 'degraded'
  layout_health: LayoutHealthLevel
  /** Diagnostic detail — read-only, never drives core logic. */
  compass: {
    heading: number | null
    status: string
    lastChangeMs: number | null
    rawAlpha: number | null
    fusedHeading: number | null
    rawFusedDeltaDeg: number | null
    warnings: string[]
  }
  route: {
    waypointCount: number
    routeRenderMode: RouteRenderMode
    pinLineFeatureCount: number
    trailLineFeatureCount: number
    trailLegCount: number
    snapEnabled: boolean
    warnings: string[]
  }
  snap: {
    eligibility: SnapEligibility
    snap_status_reason: string
    toggleCapable: boolean
    toggleEnabled: boolean
    warnings: string[]
  }
  overlay: {
    layers: Record<string, { toggle: boolean; status: OverlayLayerStatus; error: string | null }>
    warnings: string[]
  }
  layout: {
    dockedCount: number
    overlapCount: number
    misalignedCount: number
    warnings: string[]
  }
}

export const HUD_SYSTEM_HEALTH_DEFAULT: HudSystemHealth = {
  updatedAt: 0,
  compass_health: 'ok',
  route_health: 'ok',
  snap_health: 'ok',
  overlay_health: 'ok',
  layout_health: 'ok',
  compass: {
    heading: null,
    status: 'unavailable',
    lastChangeMs: null,
    rawAlpha: null,
    fusedHeading: null,
    rawFusedDeltaDeg: null,
    warnings: [],
  },
  route: {
    waypointCount: 0,
    routeRenderMode: 'none',
    pinLineFeatureCount: 0,
    trailLineFeatureCount: 0,
    trailLegCount: 0,
    snapEnabled: false,
    warnings: [],
  },
  snap: {
    eligibility: 'unavailable_reasoned',
    snap_status_reason: 'not_evaluated',
    toggleCapable: false,
    toggleEnabled: false,
    warnings: [],
  },
  overlay: {
    layers: {},
    warnings: [],
  },
  layout: {
    dockedCount: 0,
    overlapCount: 0,
    misalignedCount: 0,
    warnings: [],
  },
}
