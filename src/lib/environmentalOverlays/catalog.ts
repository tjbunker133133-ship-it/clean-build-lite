import type { EnvironmentalOverlayDef, EnvironmentalOverlayId } from './types'
import { validateOverlayCatalog } from '../overlays/overlayRenderModeValidator'

/**
 * Situational vs Detail Overlay Rendering Model
 *
 * SITUATIONAL: Always render if enabled (safety, awareness, planning overlays)
 * - NASA fires, USGS relief, forest boundaries, public lands
 * - Visible at national/state view regardless of zoom
 *
 * DETAIL: Respect minZoom gate (small features, POIs)
 * - Trails, mines, bike paths, camping sites
 * - Only visible when zoomed in appropriately
 */
export const ENVIRONMENTAL_OVERLAY_CATALOG: EnvironmentalOverlayDef[] = [
  {
    id: 'fire_firms',
    label: 'Active fire (24h)',
    hint: 'NASA FIRMS hotspots · needs free MAP_KEY',
    delivery: 'raster-wms',
    onlinePreferred: true,
    offlineCacheable: false,
    attribution: 'NASA FIRMS',
    signupUrl: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/',
    envKey: 'VITE_FIRMS_MAP_KEY',
    // Situational overlays: no minZoom - always visible when enabled for safety
    renderMode: 'situational',
  },
  {
    id: 'relief_usgs',
    label: 'Shaded relief',
    hint: 'USGS terrain shading (planning aid)',
    delivery: 'raster-wms',
    onlinePreferred: true,
    offlineCacheable: false,
    attribution: 'USGS The National Map',
    maxZoom: 18,
    // Situational overlays: no minZoom - always visible when enabled for planning
    renderMode: 'situational',
  },
  {
    id: 'forest_usfs',
    label: 'National forest',
    hint: 'USFS forest system boundaries',
    delivery: 'raster-wms',
    onlinePreferred: true,
    offlineCacheable: false,
    attribution: 'USDA USFS',
    // Situational overlays: no minZoom - always visible when enabled for boundary awareness
    renderMode: 'situational',
  },
  {
    id: 'public_lands',
    label: 'Public / federal lands',
    hint: 'Federal land management outlines',
    delivery: 'raster-wms',
    onlinePreferred: true,
    offlineCacheable: false,
    attribution: 'USGS / federal GIS',
    // Situational overlays: no minZoom - always visible when enabled for boundary awareness
    renderMode: 'situational',
  },
  {
    id: 'bike_paths',
    label: 'Bike paths',
    hint: 'OSM cycleways in view · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 8,  // REDUCED from 10: bike paths are often long corridors visible at lower zoom
    renderMode: 'detail', // Small linear features: respect zoom gate
  },
  {
    id: 'abandoned_rail',
    label: 'Abandoned railways',
    hint: 'Disused rail corridors · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 7,  // REDUCED from 9: rail corridors are long-range linear features
    renderMode: 'detail', // Linear features: respect zoom gate
  },
  {
    id: 'mines',
    label: 'Mines & shafts',
    hint: 'Historic / abandoned mine features · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 8,  // REDUCED from 10: mine sites are often large areas
    renderMode: 'detail', // Point features: respect zoom gate
  },
  {
    id: 'hiking_trails',
    label: 'Hiking paths (OSM)',
    hint: 'Foot/hiking paths not in vector basemap · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 9,  // REDUCED from 11: major trail systems visible at moderate zoom
    renderMode: 'detail', // Small linear features: respect zoom gate
  },
  {
    id: 'camping',
    label: 'Camping areas',
    hint: 'Campgrounds & dispersed camping zones · cached when offline',
    delivery: 'geojson-overpass',
    onlinePreferred: false,
    offlineCacheable: true,
    attribution: 'OpenStreetMap contributors',
    minZoom: 8,  // REDUCED from 9: large campgrounds visible at moderate zoom
    renderMode: 'detail', // POI features: respect zoom gate
  },
]

export const ENVIRONMENTAL_OVERLAY_IDS: EnvironmentalOverlayId[] = ENVIRONMENTAL_OVERLAY_CATALOG.map(
  (d) => d.id,
)

export function overlayDef(id: EnvironmentalOverlayId): EnvironmentalOverlayDef {
  const d = ENVIRONMENTAL_OVERLAY_CATALOG.find((x) => x.id === id)
  if (!d) throw new Error(`unknown overlay: ${id}`)
  return d
}

export function isEnvironmentalOverlayId(raw: string): raw is EnvironmentalOverlayId {
  return (ENVIRONMENTAL_OVERLAY_IDS as string[]).includes(raw)
}

// ============================================================================
// SCHEMA VALIDATION: Enforce renderMode taxonomy at load time
// This prevents future classification drift by validating all overlays on startup
// ============================================================================

const validationResult = validateOverlayCatalog(ENVIRONMENTAL_OVERLAY_CATALOG)

if (!validationResult.valid) {
  // Log all blocking errors
  console.error('[OVERLAY VALIDATOR] CRITICAL: Overlay catalog validation failed:')
  validationResult.blockingErrors.forEach((error) => {
    console.error(`  - ${error}`)
  })

  // In development, throw to catch immediately
  if (import.meta.env.DEV) {
    throw new Error(
      `Overlay catalog validation failed with ${validationResult.totalErrors} error(s). ` +
        `Fix the renderMode taxonomy before continuing.`
    )
  }

  // In production, log but allow degraded operation (individual overlays may fail)
  console.warn('[OVERLAY VALIDATOR] Continuing with validation errors (production mode)')
}

// Log warnings (non-blocking)
if (validationResult.totalWarnings > 0) {
  console.warn(`[OVERLAY VALIDATOR] ${validationResult.totalWarnings} warning(s) found:`)
  validationResult.results.forEach((result, id) => {
    result.warnings.forEach((warning) => {
      console.warn(`  - ${warning}`)
    })
  })
}

// Export validation results for diagnostic access
export const OVERLAY_CATALOG_VALIDATION = {
  valid: validationResult.valid,
  totalErrors: validationResult.totalErrors,
  totalWarnings: validationResult.totalWarnings,
  blockingErrors: validationResult.blockingErrors,
  overlayResults: Object.fromEntries(validationResult.results),
} as const
