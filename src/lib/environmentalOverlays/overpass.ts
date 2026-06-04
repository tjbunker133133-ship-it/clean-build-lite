import type { EnvironmentalOverlayId, MapBbox } from './types'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const MAX_BBOX_DEG = 0.35

export function clampBbox(bbox: MapBbox): MapBbox | null {
  const latSpan = bbox.north - bbox.south
  const lngSpan = bbox.east - bbox.west
  if (latSpan <= 0 || lngSpan <= 0) return null
  if (latSpan > MAX_BBOX_DEG || lngSpan > MAX_BBOX_DEG) return null
  return bbox
}

export function overpassQuery(id: EnvironmentalOverlayId, bbox: MapBbox): string | null {
  const b = clampBbox(bbox)
  if (!b) return null
  const box = `${b.south},${b.west},${b.north},${b.east}`
  const timeout = 25

  switch (id) {
    case 'bike_paths':
      return `[out:json][timeout:${timeout}];(way["highway"="cycleway"](${box});way["cycleway"](${box});way["bicycle"="designated"](${box}););out geom 120;`
    case 'abandoned_rail':
      return `[out:json][timeout:${timeout}];(way["railway"~"abandoned|disused|razed"](${box}););out geom 120;`
    case 'mines':
      return `[out:json][timeout:${timeout}];(node["man_made"="mineshaft"](${box});node["historic"="mine"](${box});way["man_made"="adit"](${box});way["abandoned"="mine"](${box}););out geom 80;`
    case 'hiking_trails':
      return `[out:json][timeout:${timeout}];(way["highway"~"path|footway"](${box})["sac_scale"];way["route"="hiking"](${box});way["highway"="path"]["foot"~"designated|yes"](${box}););out geom 120;`
    default:
      return null
  }
}

type OverpassElement = {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
}

function elementToFeature(el: OverpassElement): GeoJSON.Feature | null {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) return null
  const coords = el.geometry.map((p) => [p.lon, p.lat] as [number, number])
  const name = el.tags?.name?.trim()
  return {
    type: 'Feature',
    properties: { name: name ?? '', osm_id: el.id },
    geometry: { type: 'LineString', coordinates: coords },
  }
}

export function overpassToGeojson(raw: unknown): GeoJSON.FeatureCollection {
  if (!raw || typeof raw !== 'object') {
    return { type: 'FeatureCollection', features: [] }
  }
  const elements = (raw as { elements?: OverpassElement[] }).elements
  if (!Array.isArray(elements)) {
    return { type: 'FeatureCollection', features: [] }
  }
  const features: GeoJSON.Feature[] = []
  for (const el of elements) {
    const f = elementToFeature(el)
    if (f) features.push(f)
  }
  return { type: 'FeatureCollection', features }
}

export async function fetchOverpassGeojson(
  id: EnvironmentalOverlayId,
  bbox: MapBbox,
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection> {
  const q = overpassQuery(id, bbox)
  if (!q) {
    throw new Error('Map zoom in — area too large for OSM fetch.')
  }
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(q)}`,
    signal,
  })
  if (!res.ok) {
    throw new Error(`OSM data unavailable (${res.status})`)
  }
  const json = (await res.json()) as unknown
  return overpassToGeojson(json)
}
