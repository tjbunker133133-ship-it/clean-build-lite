/**
 * Camping Overlay - Tier 2 Environmental Context Layer
 *
 * PASSIVE INFORMATIONAL ONLY - NO SYSTEM COUPLING
 * - No SVS/CRO integration
 * - No GPS/routing influence
 * - No waypoint auto-addition
 * - No time-based logic (seasonal closures, fire restrictions reserved for Tier 3)
 */

import type { Map } from 'maplibre-gl'

export type CampingFeatureType = 'campground' | 'dispersed_zone'

export type CampingFeature = {
  osmId: number
  name: string
  featureType: CampingFeatureType
  siteType?: string
  capacity?: string
  coordinates: [number, number] // [lng, lat]
}

export type CampingInfoCard = {
  title: string
  subtitle: string
  typeLabel: string
  externalUrl: string
}

const RECREATION_GOV_BASE = 'https://www.recreation.gov'
const USFS_CAMPING_BASE = 'https://www.fs.gov/recreation'
const OSM_BROWSE_BASE = 'https://www.openstreetmap.org'

/**
 * Build an info card for a camping feature.
 * Returns external link for official booking or USFS dispersed camping info.
 */
export function buildCampingInfoCard(feature: CampingFeature): CampingInfoCard {
  const isCampground = feature.featureType === 'campground'

  // Title: use name or fallback
  const title = feature.name.trim() || (isCampground ? 'Unnamed Campground' : 'Dispersed Camping Area')

  // Type label based on feature type
  const typeLabel = isCampground ? 'Official Campground' : 'Dispersed Camping Zone'

  // Subtitle: include capacity if available
  let subtitle = ''
  if (feature.siteType) {
    subtitle = `Type: ${feature.siteType}`
  }
  if (feature.capacity) {
    subtitle = subtitle ? `${subtitle} · Capacity: ${feature.capacity}` : `Capacity: ${feature.capacity}`
  }
  if (!subtitle) {
    subtitle = isCampground ? 'Tap for details & booking' : 'National Forest dispersed camping'
  }

  // External URL
  let externalUrl: string
  if (isCampground) {
    // Link to recreation.gov search or OSM browse
    externalUrl = `${RECREATION_GOV_BASE}/search?q=${encodeURIComponent(title)}`
  } else {
    // Link to USFS dispersed camping rules
    externalUrl = `${USFS_CAMPING_BASE}/programs/camping-dispersed`
  }

  return { title, subtitle, typeLabel, externalUrl }
}

/**
 * Extract camping feature from GeoJSON feature properties.
 */
export function extractCampingFeature(feature: GeoJSON.Feature): CampingFeature | null {
  const props = feature.properties
  if (!props) return null

  const featureType = props.feature_type as CampingFeatureType | undefined
  if (!featureType || (featureType !== 'campground' && featureType !== 'dispersed_zone')) {
    return null
  }

  // Get coordinates based on geometry type
  let coordinates: [number, number] | null = null
  const geom = feature.geometry
  if (geom?.type === 'Point') {
    coordinates = (geom.coordinates as [number, number, number?]).slice(0, 2) as [number, number]
  } else if (geom?.type === 'Polygon') {
    // Use centroid of first ring for polygons
    const ring = geom.coordinates[0] as number[][]
    if (ring && ring.length > 0) {
      let lng = 0
      let lat = 0
      for (const pt of ring) {
        lng += pt[0]
        lat += pt[1]
      }
      coordinates = [lng / ring.length, lat / ring.length]
    }
  }

  if (!coordinates) return null

  return {
    osmId: (props.osm_id as number) ?? 0,
    name: (props.name as string) ?? '',
    featureType,
    siteType: (props.site_type as string) || undefined,
    capacity: (props.capacity as string) || undefined,
    coordinates,
  }
}

/**
 * Generate OSM browse URL for a camping feature.
 */
export function campingOsmBrowseUrl(feature: CampingFeature): string {
  const type = feature.featureType === 'campground' ? 'node' : 'way'
  return `${OSM_BROWSE_BASE}/${type}/${feature.osmId}`
}

/**
 * Check if a map click event hit a camping feature.
 * Returns the clicked camping feature or null.
 */
export function queryCampingFeatureAtPoint(
  map: Map,
  point: { x: number; y: number },
): CampingFeature | null {
  const layers = ['hud-env-camping-points', 'hud-env-camping-polygons-fill']
  const features = map.queryRenderedFeatures([point.x, point.y], { layers })

  if (!features.length) return null

  const feature = features[0]
  return extractCampingFeature(feature)
}

/**
 * Get bounding box for camping features (for clustering or viewport fitting).
 * Returns null if no features or insufficient data.
 */
export function getCampingBounds(features: CampingFeature[]): { sw: [number, number]; ne: [number, number] } | null {
  if (features.length === 0) return null

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  for (const f of features) {
    const [lng, lat] = f.coordinates
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  }

  return { sw: [minLng, minLat], ne: [maxLng, maxLat] }
}
