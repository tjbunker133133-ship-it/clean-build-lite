import type { Map } from 'maplibre-gl'
import {
  findTrailFeatureAtPoint,
  TRAIL_INSPECT_MAX_RADIUS_M,
  type TrailFeatureHit,
} from './snapToTrail'

export type TrailInspectLink = {
  label: string
  url: string
}

export type TrailInspectResult = {
  name: string | null
  ref: string | null
  trailClass: string | null
  lat: number
  lng: number
  distanceMeters: number
  links: TrailInspectLink[]
  /** Shown in UI — planning aid only. */
  disclaimer: string
}

const PLANNING_DISCLAIMER =
  'Map trail data is for planning only. Verify conditions, closures, and permits locally.'

const ALLOWED_LINK_HOSTS = new Set([
  'www.recreation.gov',
  'recreation.gov',
  'www.fs.usda.gov',
  'fs.usda.gov',
  'www.openstreetmap.org',
  'openstreetmap.org',
])

function readProp(props: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = props[key]
    if (typeof v === 'string') {
      const t = v.trim()
      if (t) return t
    }
  }
  return null
}

export function trailLabelsFromProperties(
  properties: Record<string, unknown>,
  sourceClass: string,
): { name: string | null; ref: string | null; trailClass: string | null } {
  const name = readProp(properties, ['name', 'name:en', 'name_en'])
  const ref = readProp(properties, ['ref', 'route_ref', 'ncn_ref', 'ref:usfs'])
  const trailClass =
    readProp(properties, ['class', 'subclass', 'type', 'highway', 'route']) ?? sourceClass
  return { name, ref, trailClass }
}

function isAllowedTrailLink(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return ALLOWED_LINK_HOSTS.has(u.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Build HTTPS search links on allowlisted hosts only. */
export function buildTrailInspectLinks(
  name: string | null,
  ref: string | null,
  lat: number,
  lng: number,
): TrailInspectLink[] {
  const parts = [name, ref ? (ref.startsWith('#') ? ref : `#${ref}`) : null].filter(
    (p): p is string => Boolean(p),
  )
  const query = parts.join(' ').trim() || `trail near ${lat.toFixed(4)},${lng.toFixed(4)}`
  const q = encodeURIComponent(query)

  const candidates: TrailInspectLink[] = [
    {
      label: 'Recreation.gov',
      url: `https://www.recreation.gov/search?q=${q}`,
    },
    {
      label: 'US Forest Service',
      url: `https://www.fs.usda.gov/search/?query=${q}`,
    },
    {
      label: 'OpenStreetMap',
      url: `https://www.openstreetmap.org/search?query=${q}#map=14/${lat.toFixed(5)}/${lng.toFixed(5)}`,
    },
  ]

  return candidates.filter((c) => isAllowedTrailLink(c.url))
}

export function trailInspectFromHit(hit: TrailFeatureHit): TrailInspectResult {
  const { name, ref, trailClass } = trailLabelsFromProperties(hit.properties, hit.sourceClass)
  return {
    name,
    ref,
    trailClass,
    lat: hit.lat,
    lng: hit.lng,
    distanceMeters: hit.distanceMeters,
    links: buildTrailInspectLinks(name, ref, hit.lat, hit.lng),
    disclaimer: PLANNING_DISCLAIMER,
  }
}

/**
 * Inspect trail under a map click/touch (rendered vectors only). Returns null when
 * no qualifying trail within radius or map lacks trail layers.
 */
export function inspectTrailAtLngLat(
  map: Map,
  lat: number,
  lng: number,
): TrailInspectResult | null {
  const hit = findTrailFeatureAtPoint(map, {
    lat,
    lng,
    radiusMeters: TRAIL_INSPECT_MAX_RADIUS_M,
  })
  if (!hit) return null
  return trailInspectFromHit(hit)
}

export function openTrailInspectLink(url: string): boolean {
  if (!isAllowedTrailLink(url)) return false
  if (typeof window === 'undefined') return false
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  } catch {
    return false
  }
}
