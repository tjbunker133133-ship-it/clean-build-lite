export type EnvironmentalOverlayId =
  | 'fire_firms'
  | 'relief_usgs'
  | 'forest_usfs'
  | 'public_lands'
  | 'bike_paths'
  | 'abandoned_rail'
  | 'mines'
  | 'hiking_trails'
  | 'camping'

export type OverlayDelivery = 'raster-wms' | 'geojson-overpass'

export type EnvironmentalOverlayDef = {
  id: EnvironmentalOverlayId
  label: string
  hint: string
  delivery: OverlayDelivery
  /** Shown in panel when layer needs network tiles. */
  onlinePreferred: boolean
  /** GeoJSON overlays can show last cached fetch when offline. */
  offlineCacheable: boolean
  attribution: string
  signupUrl?: string
  envKey?: 'VITE_FIRMS_MAP_KEY'
  minZoom?: number
  maxZoom?: number
}

/**
 * Overlay State Machine - STRICT ENFORCEMENT REQUIRED
 *
 * States:
 * - IDLE: Initial, disabled, or reset state
 * - LOADING: Async operation in progress (MUST transition to terminal state within 30s)
 * - READY: Successfully loaded and displayed
 * - EMPTY: Loaded but no data/features in view
 * - ERROR: Failed to load with error message
 * - OFFLINE_FALLBACK: Using cached/stale data due to offline/network failure
 *
 * Rules:
 * - LOADING must always transition to a terminal state (READY/EMPTY/ERROR/OFFLINE_FALLBACK)
 * - No indefinite LOADING allowed - 30s global timeout enforced
 * - State transitions are explicit and logged
 */
export type OverlayStateMachine =
  | { state: 'IDLE'; enabled: boolean }
  | { state: 'LOADING'; enabled: true; startedAt: number }
  | { state: 'READY'; enabled: true; featureCount: number }
  | { state: 'EMPTY'; enabled: true; message: string }
  | { state: 'ERROR'; enabled: boolean; error: string }
  | { state: 'OFFLINE_FALLBACK'; enabled: true; cachedAt: number; message?: string }

/**
 * Runtime status for backward compatibility.
 * @deprecated Use OverlayStateMachine for new code
 */
export type OverlayRuntimeStatus = {
  enabled: boolean
  loading: boolean
  error: string | null
  stale: boolean
  fromCache: boolean
}

export type MapBbox = {
  south: number
  west: number
  north: number
  east: number
}
