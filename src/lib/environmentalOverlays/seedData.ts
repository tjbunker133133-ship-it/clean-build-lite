/**
 * OVERLAY SEED DATA — Bundled baseline datasets for guaranteed rendering
 *
 * PURPOSE: Provide lightweight, always-available GeoJSON for immediate overlay rendering.
 * Network enhancement runs in background but is NEVER required for visibility.
 */

import type { EnvironmentalOverlayId } from './types'

/**
 * Lightweight bike paths seed — major regional corridors only.
 * These are simplified LineString features that render immediately.
 * Full detail loaded via Overpass in background when available.
 */
const BIKE_PATHS_SEED: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    // Transamerica Trail segment (example)
    {
      type: 'Feature',
      properties: { name: 'Multi-Use Path', osm_id: 1, feature_type: 'path' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-122.5, 37.7],
          [-122.4, 37.75],
          [-122.3, 37.8],
        ],
      },
    },
    // Rails-to-trails corridor example
    {
      type: 'Feature',
      properties: { name: 'Rail Trail', osm_id: 2, feature_type: 'path' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-121.9, 37.3],
          [-121.8, 37.35],
          [-121.7, 37.4],
        ],
      },
    },
    // Urban bike boulevard example
    {
      type: 'Feature',
      properties: { name: 'Bike Boulevard', osm_id: 3, feature_type: 'path' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-122.2, 37.6],
          [-122.15, 37.65],
        ],
      },
    },
  ],
}

/**
 * Camping areas seed — common dispersed camping zones and established campgrounds.
 * Point features for fast rendering. Polygons loaded from network.
 */
const CAMPING_SEED: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    // Example dispersed camping area
    {
      type: 'Feature',
      properties: {
        name: 'Public Dispersed Area',
        osm_id: 101,
        feature_type: 'campground',
        site_type: 'dispersed',
      },
      geometry: {
        type: 'Point',
        coordinates: [-120.5, 39.2],
      },
    },
    // Example established campground
    {
      type: 'Feature',
      properties: {
        name: 'Forest Campground',
        osm_id: 102,
        feature_type: 'campground',
        site_type: 'established',
      },
      geometry: {
        type: 'Point',
        coordinates: [-121.2, 38.9],
      },
    },
    // Example backcountry site
    {
      type: 'Feature',
      properties: {
        name: 'Backcountry Site',
        osm_id: 103,
        feature_type: 'campground',
        site_type: 'backcountry',
      },
      geometry: {
        type: 'Point',
        coordinates: [-119.8, 39.5],
      },
    },
  ],
}

/**
 * Hiking trails seed — major trail systems.
 * Backbone trails render immediately. Full network loads in background.
 */
const HIKING_TRAILS_SEED: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    // Pacific Crest Trail segment example
    {
      type: 'Feature',
      properties: { name: 'PCT Section', osm_id: 201, feature_type: 'trail' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-120.1, 39.3],
          [-120.0, 39.4],
          [-119.9, 39.5],
        ],
      },
    },
    // John Muir Trail segment example
    {
      type: 'Feature',
      properties: { name: 'JMT Section', osm_id: 202, feature_type: 'trail' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-119.5, 37.7],
          [-119.4, 37.8],
        ],
      },
    },
  ],
}

/**
 * Abandoned railways seed — historical rail corridors.
 * Linear features suitable for low-zoom display.
 */
const ABANDONED_RAIL_SEED: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    // Old logging railroad example
    {
      type: 'Feature',
      properties: { name: 'Old Logging Line', osm_id: 301, feature_type: 'abandoned_rail' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-123.0, 42.1],
          [-122.9, 42.15],
          [-122.8, 42.2],
        ],
      },
    },
    // Disused industrial spur example
    {
      type: 'Feature',
      properties: { name: 'Industrial Spur', osm_id: 302, feature_type: 'abandoned_rail' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-121.5, 37.8],
          [-121.45, 37.82],
        ],
      },
    },
  ],
}

/**
 * Mines seed — known historic mine sites.
 * Point features for immediate rendering.
 */
const MINES_SEED: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    // Historic gold mine example
    {
      type: 'Feature',
      properties: {
        name: 'Historic Gold Mine',
        osm_id: 401,
        feature_type: 'mine',
      },
      geometry: {
        type: 'Point',
        coordinates: [-120.8, 39.4],
      },
    },
    // Abandoned silver mine example
    {
      type: 'Feature',
      properties: {
        name: 'Abandoned Silver Mine',
        osm_id: 402,
        feature_type: 'mine',
      },
      geometry: {
        type: 'Point',
        coordinates: [-119.6, 38.2],
      },
    },
    // Historic copper prospect example
    {
      type: 'Feature',
      properties: {
        name: 'Copper Prospect',
        osm_id: 403,
        feature_type: 'mine',
      },
      geometry: {
        type: 'Point',
        coordinates: [-121.3, 40.1],
      },
    },
  ],
}

const SEED_DATA: Record<EnvironmentalOverlayId, GeoJSON.FeatureCollection> = {
  bike_paths: BIKE_PATHS_SEED,
  camping: CAMPING_SEED,
  hiking_trails: HIKING_TRAILS_SEED,
  abandoned_rail: ABANDONED_RAIL_SEED,
  mines: MINES_SEED,
  // Raster overlays don't use seed data
  fire_firms: { type: 'FeatureCollection', features: [] },
  relief_usgs: { type: 'FeatureCollection', features: [] },
  forest_usfs: { type: 'FeatureCollection', features: [] },
  public_lands: { type: 'FeatureCollection', features: [] },
}

/**
 * Get bundled seed data for immediate overlay rendering.
 * This ALWAYS returns valid GeoJSON, even if empty.
 * Network enhancement is separate and optional.
 */
export function getOverlaySeedData(id: EnvironmentalOverlayId): GeoJSON.FeatureCollection {
  return SEED_DATA[id] ?? { type: 'FeatureCollection', features: [] }
}

/**
 * Check if overlay has bundled seed data available.
 * Used to determine if immediate render is possible.
 */
export function hasOverlaySeedData(id: EnvironmentalOverlayId): boolean {
  const data = SEED_DATA[id]
  return data != null && data.features.length > 0
}

/**
 * Merge seed data with enhanced network data.
 * Deduplicates by OSM ID, preferring enhanced features.
 */
export function mergeSeedWithEnhanced(
  seed: GeoJSON.FeatureCollection,
  enhanced: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const seen = new Set<string>()
  const merged: GeoJSON.Feature[] = []

  // Add enhanced features first (preferred)
  for (const f of enhanced.features) {
    const id = (f.properties as { osm_id?: number })?.osm_id
    if (id != null) {
      seen.add(String(id))
    }
    merged.push(f)
  }

  // Add seed features not in enhanced set
  for (const f of seed.features) {
    const id = (f.properties as { osm_id?: number })?.osm_id
    const key = id != null ? String(id) : JSON.stringify(f.geometry)
    if (!seen.has(key)) {
      merged.push(f)
    }
  }

  return {
    type: 'FeatureCollection',
    features: merged,
  }
}
