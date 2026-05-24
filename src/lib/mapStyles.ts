import type { StyleSpecification } from 'maplibre-gl'
import type { LayerType } from '../types'

// ⚠️ LOCKED SYSTEM — Behavior Freeze Active
// Any change to interaction, layout, display modes, or layers requires explicit approval.

/**
 * 🔒 CONTRACT: Map layer system is immutable.
 * Allowed layers: streets, topo, outdoor, satellite only
 * No mutation, no additions, no dynamic changes
 * Do NOT modify without explicit approval
 *
 * MapTiler style.json URLs — key from VITE_MAPTILER_KEY only (never commit keys).
 * Frozen shallowly — do not replace or mutate entries at runtime.
 */
function maptilerKey(): string {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_MAPTILER_KEY
  return (typeof raw === 'string' ? raw : '').trim()
}

function maptilerStyleUrl(mapPath: string): string {
  const key = maptilerKey()
  if (!key) return ''
  return `https://api.maptiler.com/maps/${mapPath}/style.json?key=${key}`
}

export const MAP_STYLES = Object.freeze({
  streets: maptilerStyleUrl('openstreetmap'),
  outdoor: maptilerStyleUrl('outdoor-v4'),
  topo: maptilerStyleUrl('topo-v4'),
  satellite: maptilerStyleUrl('hybrid-v4'),
} as const)
export const VALID_LAYERS = Object.freeze(['streets', 'topo', 'outdoor', 'satellite'] as const)

export type MapStyleKey = keyof typeof MAP_STYLES

export type MapStyleInput = StyleSpecification | string

/** Resolve basemap URL for a layer key (aligned with `LayerType` / layer panel). */
export function getStyleUrl(style: MapStyleKey): string {
  const url = MAP_STYLES[style]
  if (!url) {
    if (import.meta.env.DEV) {
      console.warn(
        `[mapStyles] No URL for "${String(style)}" — set VITE_MAPTILER_KEY in .env.local`,
      )
    }
    return MAP_STYLES.streets || ''
  }
  return url
}

/** MapTiler terrain-rgb TileJSON — uses VITE_MAPTILER_KEY. */
export function maptilerTerrainRgbTileJson(): string {
  const key = maptilerKey()
  if (key) return `https://api.maptiler.com/tiles/terrain-rgb/tiles.json?key=${key}`
  if (import.meta.env.DEV) {
    console.warn('[mapStyles] VITE_MAPTILER_KEY missing — terrain-rgb unavailable')
  }
  return 'https://api.maptiler.com/tiles/terrain-rgb/tiles.json'
}

function rasterStyle(
  sourceId: string,
  tiles: string[],
  attribution: string,
  sourceMaxzoom = 19,
): StyleSpecification {
  return {
    version: 8,
    sources: {
      [sourceId]: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution,
        maxzoom: sourceMaxzoom,
      },
    },
    layers: [
      {
        id: sourceId,
        type: 'raster',
        source: sourceId,
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  }
}

/** Emergency only: when MapTiler style.json fails in MapCanvas error handlers. */
export const FALLBACK_MAP_STYLE: StyleSpecification = rasterStyle(
  'osm-fallback',
  ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  '© OpenStreetMap contributors',
)

export function validatedEmergencyFallbackStyle(): StyleSpecification | null {
  const s = FALLBACK_MAP_STYLE
  if (!s || s.version !== 8 || !s.sources) {
    console.error('[mapStyles] FALLBACK_MAP_STYLE is invalid')
    return null
  }
  return s
}

export function mapStyleFingerprint(style: MapStyleInput): string {
  if (typeof style === 'string') {
    return `url:${style.trim()}`
  }
  const sources = style.sources as Record<string, { type?: string; tiles?: string[] }>
  const ids = Object.keys(sources).sort().join('|')
  const first = Object.values(sources)[0]
  const tile0 = first?.tiles?.[0] ?? ''
  return `v8:${ids}:${tile0}`
}

export function logActiveLayerTileDebug(layer: LayerType): void {
  const enabled =
    typeof window !== 'undefined' &&
    (window.location.search.includes('mapdebug=1') ||
      window.localStorage.getItem('hud_layer_log') === '1' ||
      window.localStorage.getItem('hud_tier1_debug') === '1')
  if (!enabled) return
  const url = getStyleUrl(layer as MapStyleKey)
  console.log('LAYER STYLE URL:', url.replace(/key=[^&]+/i, 'key=<redacted>'))
}

export const WAYPOINT_COLORS: Record<string, string> = {
  default: '#00ffb4',
  camp: '#ffe033',
  water: '#33c4ff',
  danger: '#ff3b3b',
}

export const WAYPOINT_ICONS: Record<string, string> = {
  default: '◈',
  camp: '⛺',
  water: '💧',
  danger: '⚠',
}
