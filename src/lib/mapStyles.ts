import type { StyleSpecification } from 'maplibre-gl'
import type { LayerType } from '../types'
import { getDeviceProfile } from '../runtime/deviceProfile'

// ⚠️ LOCKED SYSTEM — Behavior Freeze Active
// Any change to interaction, layout, display modes, or layers requires explicit approval.

/** Field cap — MapTiler vector/raster tiles go empty above ~18; prevents black void when pinching in. */
export const FIELD_MAX_MAP_ZOOM = 18

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
  return MAP_STYLES[style] || ''
}

/** True when MapTiler vector URLs are available at build time (inlined `VITE_MAPTILER_KEY`). */
export function maptilerBasemapsConfigured(): boolean {
  return Boolean(maptilerKey())
}

/**
 * Android field HUD: Outdoor direct raster matches corridor prefetch tile URLs.
 * Vector outdoor uses different tile URLs and breaks offline corridor reuse.
 */
export function shouldUseOutdoorFieldRasterBasemap(): boolean {
  const p = getDeviceProfile()
  if (!p.isAndroid) return false
  return p.isPWA || p.isStandalone || p.interactionMode === 'mobile'
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

/**
 * Map IDs aligned with vector style.json paths — used for TileJSON raster recovery.
 * XYZ template must include tile size: /maps/{id}/256/{z}/{x}/{y}.png
 */
const MAPTILER_RASTER_MAP_ID: Record<MapStyleKey, string> = {
  streets: 'openstreetmap',
  outdoor: 'outdoor-v4',
  topo: 'topo-v4',
  satellite: 'hybrid-v4',
}

/**
 * Per-layer MapTiler raster fallback via TileJSON (same presets as vector URLs).
 * Used when vector style.json stalls on WebKit or errors at runtime.
 */
/** Direct XYZ templates for corridor prefetch and offline boot (no TileJSON fetch). */
export function maptilerRasterTileTemplates(layer: MapStyleKey): string[] {
  const key = maptilerKey()
  if (!key) return []
  const mapId = MAPTILER_RASTER_MAP_ID[layer]
  return [`https://api.maptiler.com/maps/${mapId}/256/{z}/{x}/{y}.png?key=${key}`]
}

/**
 * Offline-safe MapTiler raster basemap: inlined `tiles` array (no `tiles.json` network hop).
 * Used for cold-start offline boot when a mission corridor has been prefetched.
 */
export function getMapTilerRasterDirectTilesStyle(layer: MapStyleKey): StyleSpecification | null {
  const tiles = maptilerRasterTileTemplates(layer)
  if (tiles.length === 0) return null
  const sourceId = `maptiler-raster-direct-${layer}`
  return rasterStyle(
    sourceId,
    tiles,
    '© MapTiler © OpenStreetMap contributors',
    22,
  )
}

export function getMapTilerRasterFallbackStyle(layer: MapStyleKey): StyleSpecification | null {
  const key = maptilerKey()
  if (!key) return null
  const mapId = MAPTILER_RASTER_MAP_ID[layer]
  const sourceId = `maptiler-raster-${layer}`
  return {
    version: 8,
    sources: {
      [sourceId]: {
        type: 'raster',
        url: `https://api.maptiler.com/maps/${mapId}/256/tiles.json?key=${key}`,
        tileSize: 256,
        attribution: '© MapTiler © OpenStreetMap contributors',
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

export function mapTilerRasterFallbackFingerprint(layer: MapStyleKey): string | null {
  const style = getMapTilerRasterFallbackStyle(layer)
  return style ? mapStyleFingerprint(style) : null
}

export type BasemapDelivery = 'vector' | 'maptiler-raster'

/** Apple WebKit: longer style-switch timeouts; vector primary (same as Android). */
export function isAppleWebKitMapSwitch(): boolean {
  const p = getDeviceProfile()
  return p.isIOS || (p.isAppleWebKit && (p.isPWA || p.isStandalone))
}

/**
 * Primary basemap: MapTiler vector style.json per layer.
 * Falls back to per-layer raster TileJSON, then caller may use OSM emergency.
 */
export function resolveBasemapStyle(layer: MapStyleKey): {
  style: string | StyleSpecification
  delivery: BasemapDelivery
} {
  if (layer === 'outdoor' && shouldUseOutdoorFieldRasterBasemap()) {
    const direct = getMapTilerRasterDirectTilesStyle('outdoor')
    if (direct) return { style: direct, delivery: 'maptiler-raster' }
  }
  const vectorUrl = getStyleUrl(layer)
  if (vectorUrl) return { style: vectorUrl, delivery: 'vector' }
  const raster = getMapTilerRasterFallbackStyle(layer)
  if (raster) return { style: raster, delivery: 'maptiler-raster' }
  const emerg = validatedEmergencyFallbackStyle()
  if (emerg) return { style: emerg, delivery: 'maptiler-raster' }
  return { style: '', delivery: 'vector' }
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
