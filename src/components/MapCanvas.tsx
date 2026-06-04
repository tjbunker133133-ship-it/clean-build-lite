import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { useGPS } from '../hooks/useGPS'
import type { LayerType, Waypoint } from '../types'
import {
  getMapTilerRasterDirectTilesStyle,
  getMapTilerRasterFallbackStyle,
  getStyleUrl,
  type BasemapDelivery,
  type MapStyleKey,
  logActiveLayerTileDebug,
  mapStyleFingerprint,
  maptilerTerrainRgbTileJson,
  isAppleWebKitMapSwitch,
  resolveBasemapStyle,
  validatedEmergencyFallbackStyle,
  FIELD_MAX_MAP_ZOOM,
} from '../lib/mapStyles'
import { hasCorridorOutdoorCache } from '../lib/corridorPrefetch'
import { dispatchTrailInspectTap } from '../lib/trailInspectBridge'
import {
  installMapLayerDiagHook,
  logLayerActivation,
  logLayerSelection,
  logStyleSwitchTiming,
  mapLayerDiag,
} from '../lib/mapLayerDiag'
import { tier1Debug } from '../lib/tier1DebugLog'
import { isWaypointPlacementAllowed } from '../lib/waypointPlacement'
import { isWaypointMarkerTouchActive } from '../lib/waypointMarkerTouchGate'
import {
  __probeStyleForTrailLayersForTests,
  __resetSnapCapabilityDevLogForTests,
  createTrailSnapPreviewGate,
  findNearestTrailCandidate,
  isSnapAvailable,
  MAX_SNAP_RADIUS_M,
  MIN_SNAP_ZOOM,
} from '../lib/snapToTrail'
import { computeTrailRoute, diagnoseTrailLeg } from '../lib/trailRoute'
import { observeWaypointDropAfterCommit } from '../lib/snapTrack/waypointSnapBridge'
import { hudObsMark, hudObsMeasure } from '../diag/hudObs'
import { getDeviceProfile, isIosFieldHud } from '../runtime/deviceProfile'

/**
 * MapTiler `topo-v4` / `outdoor-v4` style.json embed terrain; MapLibre applies them during
 * `setStyle` `_load` before shaders are ready (terrainDepth / shaderPreludeCode). Use per-layer
 * MapTiler raster TileJSON instead (distinct visuals, no embedded terrain). Topo still gets
 * HUD-owned raster-dem via `syncTopoTerrain` after load.
 */
function vectorStyleEmbedsTerrain(url: string): boolean {
  return /topo-v4|outdoor-v4/i.test(url)
}

/**
 * MapTiler outdoor/topo style.json embeds terrain that can crash WebKit during setStyle.
 * Use raster TileJSON there only; Android + desktop keep vector so trail snap/inspect work.
 */
function shouldUseTerrainSafeRasterBasemap(layer: MapStyleKey): boolean {
  if (layer !== 'topo' && layer !== 'outdoor') return false
  if (isIosFieldHud()) return true
  if (isAppleWebKitMapSwitch() && !getDeviceProfile().isAndroid) return true
  return false
}

function applyOfflineCorridorBasemapIfNeeded(map: maplibregl.Map): void {
  if (typeof navigator !== 'undefined' && navigator.onLine) return
  if (!hasCorridorOutdoorCache()) return
  const direct = getMapTilerRasterDirectTilesStyle('outdoor')
  if (!direct) return
  try {
    const fp = mapStyleFingerprint(direct)
    if (mapStyleFingerprint(map.getStyle()) !== fp) {
      map.setStyle(direct, { diff: false })
      mapLayerDiag('offline-corridor-raster-reapply', { layer: 'outdoor' })
    }
    nudgeMapRenderAfterStyleChange(map)
  } catch {
    /* ignore */
  }
}

function resolveHudBasemapStyle(layer: MapStyleKey): ReturnType<typeof resolveBasemapStyle> {
  const resolved = resolveBasemapStyle(layer)
  if (
    resolved.delivery === 'vector' &&
    typeof resolved.style === 'string' &&
    vectorStyleEmbedsTerrain(resolved.style) &&
    shouldUseTerrainSafeRasterBasemap(layer)
  ) {
    const raster = getMapTilerRasterFallbackStyle(layer)
    if (raster) {
      return { style: raster, delivery: 'maptiler-raster' }
    }
  }
  return resolved
}

const HUD_DEBUG_CLICK_SRC = 'hud-debug-click'
const HUD_DEBUG_CLICK_LAYER = 'hud-debug-click-circle'
const TERRAIN_SOURCE_ID = 'hud-maptiler-terrain-rgb'
const MAP_VIEWPORT_KEY = 'hud_map_viewport_v1'
const LAST_KNOWN_LOCATION_KEY = 'lastKnownLocation'

type PersistedViewport = {
  lng: number
  lat: number
  zoom: number
  bearing: number
  pitch: number
  ts: number
}

function readPersistedViewport(): PersistedViewport | null {
  try {
    const raw = localStorage.getItem(MAP_VIEWPORT_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<PersistedViewport> | null
    if (!p) return null
    if (
      typeof p.lng !== 'number' ||
      typeof p.lat !== 'number' ||
      typeof p.zoom !== 'number' ||
      typeof p.bearing !== 'number' ||
      typeof p.pitch !== 'number'
    ) {
      return null
    }
    return {
      lng: p.lng,
      lat: p.lat,
      zoom: p.zoom,
      bearing: p.bearing,
      pitch: p.pitch,
      ts: typeof p.ts === 'number' ? p.ts : Date.now(),
    }
  } catch {
    return null
  }
}

function readCachedOperationalFix(): { lat: number; lng: number } | null {
  try {
    const raw = localStorage.getItem(LAST_KNOWN_LOCATION_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { lat?: unknown; lng?: unknown } | null
    if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return null
    return { lat: p.lat, lng: p.lng }
  } catch {
    return null
  }
}

const STATIC_MAP_CENTER = { lng: -105.7821, lat: 39.5501 }

/** Boot map center: last known GPS fix when available, otherwise Colorado fallback. */
function readInitialMapView(): { lng: number; lat: number; zoom: number } {
  const cached = readCachedOperationalFix()
  if (cached) {
    return { lng: cached.lng, lat: cached.lat, zoom: 14 }
  }
  return { lng: STATIC_MAP_CENTER.lng, lat: STATIC_MAP_CENTER.lat, zoom: 10 }
}

function applyOperationalMapCenter(
  map: maplibregl.Map,
  fix: { lat: number; lng: number },
  persisted: PersistedViewport | null,
) {
  map.jumpTo({
    center: [fix.lng, fix.lat],
    zoom: Math.max(14, persisted?.zoom ?? map.getZoom()),
    bearing: persisted?.bearing ?? 0,
    pitch: persisted?.pitch ?? 0,
  })
}

function createUserMarkerEl() {
  const el = document.createElement('div')
  el.style.width = '18px'
  el.style.height = '18px'
  el.style.position = 'relative'

  const core = document.createElement('div')
  core.style.width = '6px'
  core.style.height = '6px'
  core.style.borderRadius = '50%'
  core.style.background = 'rgba(255,255,255,0.95)'
  core.style.position = 'absolute'
  core.style.top = '50%'
  core.style.left = '50%'
  core.style.transform = 'translate(-50%, -50%)'

  const ring = document.createElement('div')
  ring.style.width = '18px'
  ring.style.height = '18px'
  ring.style.borderRadius = '50%'
  ring.style.border = '2px solid rgba(255,50,50,0.9)'
  ring.style.boxShadow = '0 0 10px rgba(255,50,50,0.7)'

  el.appendChild(ring)
  el.appendChild(core)
  return el
}

/** MapLibre may request junk sprite keys from bad icon-image in vector tiles ("null", " ", ""). */
function resolveSpriteMissingKey(raw: unknown): string | null {
  if (raw == null) return 'null'
  if (typeof raw !== 'string') return null
  if (raw === 'null' || raw === 'undefined') return raw
  const trimmed = raw.trim()
  if (!trimmed) {
    // Must register under the exact id MapLibre requested (e.g. literal " ").
    return raw.length > 0 ? raw : 'null'
  }
  return trimmed
}

function isJunkSpriteKey(key: string): boolean {
  if (key === 'null' || key === 'undefined') return true
  return key.trim().length === 0
}

function addSpritePlaceholder(map: maplibregl.Map, key: string, junk: boolean): void {
  const size = junk ? 1 : 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, size, size)
  if (!junk) {
    ctx.fillStyle = 'rgba(210, 72, 72, 0.9)'
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 4, 0, Math.PI * 2)
    ctx.fill()
  }
  map.addImage(key, ctx.getImageData(0, 0, size, size), { pixelRatio: 1 })
}

/** Placeholder icons when sprite entries fail (network / CORS / ad block). */
function onStyleImageMissingFactory(map: maplibregl.Map) {
  return (e: { id: string }) => {
    const key = resolveSpriteMissingKey(e?.id)
    if (!key) return
    if (map.hasImage(key)) return
    const junk = isJunkSpriteKey(key)
    try {
      addSpritePlaceholder(map, key, junk)
    } catch {
      /* ignore */
    }
  }
}

function mapRepaintSafe(map: maplibregl.Map): boolean {
  try {
    return map.isStyleLoaded() === true
  } catch {
    return false
  }
}

function syncTopoTerrain(map: maplibregl.Map, layer: LayerType) {
  if (!mapRepaintSafe(map)) {
    return
  }
  if (layer === 'topo') {
    try {
      try {
        map.setTerrain(null)
      } catch {
        /* clear style-embedded terrain before HUD DEM */
      }
      if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          url: maptilerTerrainRgbTileJson(),
          tileSize: 256,
        })
      }
      const applyHudTerrain = () => {
        if (!mapRepaintSafe(map)) return
        try {
          map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 })
        } catch (e) {
          console.warn('[MapCanvas] topo terrain sync failed', e)
        }
      }
      if (map.isSourceLoaded(TERRAIN_SOURCE_ID)) {
        applyHudTerrain()
      } else {
        map.once('sourcedata', (ev) => {
          if (ev.sourceId === TERRAIN_SOURCE_ID && ev.isSourceLoaded) applyHudTerrain()
        })
      }
    } catch (e) {
      console.warn('[MapCanvas] topo terrain sync failed', e)
    }
  } else {
    try {
      map.setTerrain(null)
      if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID)
    } catch {
      /* style churn */
    }
  }
}

/** Layer panel uses keys only; skip when same layer is already loaded (not URL string alone). */
function prepareBasemapSwitch(
  map: maplibregl.Map,
  styleKey: MapStyleKey,
  currentAppliedLayerRef: MutableRefObject<LayerType | null>,
): { skip: true } | { skip: false; style: string | maplibregl.StyleSpecification; delivery: BasemapDelivery } {
  if (currentAppliedLayerRef.current === styleKey) {
    try {
      if (map.isStyleLoaded()) return { skip: true }
    } catch {
      /* style churn */
    }
  }
  const resolved = resolveHudBasemapStyle(styleKey)
  return { skip: false, style: resolved.style, delivery: resolved.delivery }
}

/** Safari/WebKit often needs an explicit resize/repaint after `setStyle`. */
function nudgeMapRenderAfterStyleChange(map: maplibregl.Map): void {
  const repaint = () => {
    if (!mapRepaintSafe(map)) {
      return
    }
    try {
      map.resize()
    } catch {
      /* ignore */
    }
    try {
      ;(map as maplibregl.Map & { triggerRepaint?: () => void }).triggerRepaint?.()
    } catch {
      /* ignore */
    }
  }
  repaint()
  requestAnimationFrame(() => {
    repaint()
    if (isAppleWebKitMapSwitch()) {
      requestAnimationFrame(repaint)
    }
  })
}

function layerSwitchTimeouts(): { fallbackOverlayMs: number; stallMs: number; maxRetry: number } {
  const apple = isAppleWebKitMapSwitch()
  const iosField = isIosFieldHud()
  const { isAppleWebKit, isPWA } = getDeviceProfile()
  const iosLike = iosField || isAppleWebKit || isPWA
  return {
    fallbackOverlayMs: iosLike ? 1800 : 1400,
    stallMs: apple ? 10000 : iosLike ? 12000 : 12000,
    maxRetry: iosLike ? 1 : 0,
  }
}

function mapLibreErrorPayload(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'error' in raw) {
    return (raw as { error: unknown }).error
  }
  return raw
}

/** When MapTiler style.json fails, allow explicit emergency raster (single OSM preset only). */
function styleFailureWarrantsEmergencyFallback(raw: unknown): boolean {
  const err = mapLibreErrorPayload(raw)
  if (err == null) return false
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status: unknown }).status
    if (s === 401 || s === 403) return true
  }
  const msg = String(err instanceof Error ? err.message : err).toLowerCase()
  if (msg.includes('unauthorized') || msg.includes('forbidden')) return true
  if (msg.includes('unable to load style')) return true
  if (msg.includes('failed to parse style')) return true
  if (msg.includes('style could not be loaded')) return true
  return false
}

/**
 * Map rendering guardrails (see `src/.cursorrules` → MapLibre implementation):
 * - Styles come only from `lib/mapStyles.ts` (single source of truth).
 * - `setMap` on `load` + `ResizeObserver` + `resize()` after load (layout / Strict Mode).
 * - Do not add `!important` width/height on `.maplibregl-canvas` in global CSS.
 */
export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const startupResetAttemptsRef = useRef(0)
  const skipLayerSyncRef = useRef(true)
  const [staticFallbackVisible, setStaticFallbackVisible] = useState(true)
  const [debugClick, setDebugClick] = useState<{ lat: number; lng: number } | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const setDebugClickRef = useRef(setDebugClick)
  setDebugClickRef.current = setDebugClick
  const { map: mapInstance, setMap, setStatus, status: mapStatus } = useMapContext()
  /** Hide once booted — avoids stuck center overlay on iOS/Android PWA after style churn. */
  const showMapFallbackBubble =
    staticFallbackVisible && mapStatus === 'initial' && !mapReady
  const gps = useGPS()
  const gpsRef = useRef(gps)
  gpsRef.current = gps
  const initialOperationalCenterAppliedRef = useRef(false)
  const autoOperationalCenteringRef = useRef(false)
  const userHasTakenViewportControlRef = useRef(false)
  const restoredViewportRef = useRef(false)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const {
    state,
    addWaypoint,
    setPendingType,
    setNextWaypointLabel,
    selectWaypoint,
    setTrailSnapAssistCapable,
  } = useAppContext()
  const {
    activeLayer,
    pendingWaypointType,
    waypoints,
    nextWaypointLabel,
    keepWaypointToolArmed,
    clearLabelAfterDrop,
    snapToTrailEnabled,
  } = state

  const snapToTrailEnabledRef = useRef(false)
  snapToTrailEnabledRef.current = snapToTrailEnabled
  const snapPreviewGateRef = useRef(createTrailSnapPreviewGate())
  /** Latest sync fn so window-level events (pageshow/visibilitychange) can ping capability without re-binding map listeners. */
  const snapAssistSyncRef = useRef<(() => void) | null>(null)
  const snapPreviewCleanupRef = useRef<(() => void) | null>(null)

  function clearTrailSnapPreview() {
    snapPreviewCleanupRef.current?.()
    snapPreviewCleanupRef.current = null
    snapPreviewGateRef.current.unlock()
  }

  const { panels } = useCockpit()
  const waypointDropBlockedRef = useRef(false)
  const wpLayout = panels.waypoints
  waypointDropBlockedRef.current = wpLayout?.docked === true

  const activeLayerRef = useRef(activeLayer)
  activeLayerRef.current = activeLayer
  const pendingTypeRef = useRef(pendingWaypointType)
  pendingTypeRef.current = pendingWaypointType
  const waypointCountRef = useRef(waypoints.length)
  waypointCountRef.current = waypoints.length
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints
  const lastDropAtRef = useRef(0)
  const nextWaypointLabelRef = useRef(nextWaypointLabel)
  nextWaypointLabelRef.current = nextWaypointLabel
  const keepArmedRef = useRef(keepWaypointToolArmed)
  keepArmedRef.current = keepWaypointToolArmed
  const clearLabelAfterDropRef = useRef(clearLabelAfterDrop)
  clearLabelAfterDropRef.current = clearLabelAfterDrop
  const styleSwitchGenRef = useRef(0)
  /** Last applied basemap style URL — duplicate `setStyle` guard. */
  const currentStyleRef = useRef<string | null>(null)
  const currentAppliedLayerRef = useRef<LayerType | null>(null)
  const setStatusRef = useRef(setStatus)
  setStatusRef.current = setStatus
  const devResizeDiagRef = useRef({
    viewportTriggers: 0,
    mapResizeCalls: 0,
    resizeSuppressedSameBounds: 0,
    loggedAt: 0,
  })

  const persistViewport = (map: maplibregl.Map) => {
    try {
      const c = map.getCenter()
      const body: PersistedViewport = {
        lng: c.lng,
        lat: c.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        ts: Date.now(),
      }
      localStorage.setItem(MAP_VIEWPORT_KEY, JSON.stringify(body))
    } catch {
      /* ignore */
    }
  }

  const tryApplyInitialOperationalCenter = useCallback(() => {
    const map = mapRef.current
    if (!map) return false
    if (initialOperationalCenterAppliedRef.current) return false
    if (restoredViewportRef.current) return false
    if (userHasTakenViewportControlRef.current) return false

    const live = gpsRef.current
    const seed =
      live.lat != null && live.lng != null
        ? { lat: live.lat, lng: live.lng }
        : readCachedOperationalFix()
    if (!seed) return false

    map.jumpTo({
      center: [seed.lng, seed.lat],
      zoom: Math.max(14, map.getZoom()),
    })
    autoOperationalCenteringRef.current = true
    window.setTimeout(() => {
      autoOperationalCenteringRef.current = false
    }, 0)
    initialOperationalCenterAppliedRef.current = true
    return true
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    try {
      const w = window as Window & { __HUD_LOOP_DEBUG__?: number; HUD_LOOP_DEBUG?: number }
      if (
        localStorage.getItem('hud_tier1_debug') !== '1' &&
        w.__HUD_LOOP_DEBUG__ !== 1 &&
        w.HUD_LOOP_DEBUG !== 1
      ) {
        return
      }
    } catch {
      return
    }
    console.log('[MAP EFFECT] activeLayer changed:', activeLayer)
  }, [activeLayer])

  useEffect(() => {
    if (mapStatus === 'ready' || mapStatus === 'fallback') {
      setStaticFallbackVisible(false)
    }
  }, [mapStatus])

  useEffect(() => {
    if (activeLayer !== 'outdoor' || !mapRef.current) return
    const sync = snapAssistSyncRef.current
    if (typeof sync !== 'function') return
    const t1 = window.setTimeout(sync, 80)
    const t2 = window.setTimeout(sync, 600)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [activeLayer, mapReady])

  useEffect(() => {
    installMapLayerDiagHook(() => {
      const map = mapRef.current
      let styleLoaded = false
      try {
        styleLoaded = Boolean(map?.isStyleLoaded?.())
      } catch {
        /* ignore */
      }
      return {
        activeLayer,
        currentStyleUrl: currentStyleRef.current?.replace(/key=[^&]+/i, 'key=<redacted>') ?? null,
        mapReady,
        styleLoaded,
      }
    })
  }, [activeLayer, mapReady])

  // Create map once; swap style when base layer changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let hardResetting = false
    let readyOnce = false
    let fallbackLocked = false
    let map: maplibregl.Map | null = null
    let styleImageMissingHandler: ((e: { id: string }) => void) | null = null
    let lastTouchDropAt = 0
    let lastUserInteractionAt = Date.now()
    let touchMoved = false
    let multiTouchActive = false
    let touchStart: { x: number; y: number } | null = null
    let touchLast: { x: number; y: number } | null = null
    const isAppleWebKit = getDeviceProfile().isAppleWebKit
    const tapDiagnosticsEnabled =
      typeof window !== 'undefined' &&
      (window.location.search.includes('tapdiag=1') || localStorage.getItem('hud_tapdiag') === '1')
    const tapDiag = (msg: string) => {
      if (tapDiagnosticsEnabled) console.info(`[tapdiag] ${msg}`)
    }
    let watchdogTimer: number | null = null
    const markUserViewportControl = () => {
      if (userHasTakenViewportControlRef.current) return
      userHasTakenViewportControlRef.current = true
    }

    // Render blank maps are usually tied to WebGL/context or sizing churn.
    // Strategy: show static OSM until MapLibre reaches `idle` with tiles drawn.
    setStaticFallbackVisible(true)
    setStatus('initial')

    const initialView = readInitialMapView()

    /** Once per style (not `styledata`, which fires on every tile batch). */
    const onStyleLoad = () => {
      if (cancelled || !map) return
      syncTopoTerrain(map, activeLayerRef.current)
    }

    let lastRw = 0
    let lastRh = 0
    const resize = () => {
      try {
        if (!map) return
        const r = container.getBoundingClientRect()
        const rw = Math.round(r.width)
        const rh = Math.round(r.height)
        if (rw < 2 || rh < 2) return
        if (rw === lastRw && rh === lastRh) {
          if (import.meta.env.DEV) {
            devResizeDiagRef.current.resizeSuppressedSameBounds += 1
          }
          return
        }
        lastRw = rw
        lastRh = rh
        if (import.meta.env.DEV) {
          devResizeDiagRef.current.mapResizeCalls += 1
        }
        map.resize()
      } catch {
        /* ignore */
      }
    }

    const scheduleResize = () => {
      if (resizeRafRef.current != null) return
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null
        resize()
      })
    }

    const hardReset = () => {
      if (cancelled || hardResetting) return
      hardResetting = true

      // Clean up previous map instance to force a fresh WebGL context.
      try {
        map?.remove()
      } catch {
        /* ignore */
      }
      mapRef.current = null
      setMap(null)
      setStatus('fallback')

      // Re-init on next frame to avoid re-entrancy issues.
      requestAnimationFrame(() => {
        if (cancelled) return
        hardResetting = false
        initMap()
      })
    }

    const initMap = () => {
      if (cancelled) return

      // Some devices/browsers do not support MapLibre/WebGL reliably. In that case we
      // keep the static fallback visible and mark status so HUD can show MAP FALLBACK.
      const isSupported =
        typeof (maplibregl as any).supported === 'function'
          ? (maplibregl as any).supported()
          : true
      if (!isSupported) {
        console.warn('[MapCanvas] MapLibre not supported on this device — using static map only')
        setStaticFallbackVisible(true)
        setStatus('unsupported')
        return
      }

      container.replaceChildren()
      readyOnce = false
      setStaticFallbackVisible(true)
      setStatus('initial')

      const initLayer = activeLayerRef.current as MapStyleKey
      const offlineBoot =
        typeof navigator !== 'undefined' && navigator.onLine === false
      const bootBasemap = offlineBoot
        ? (() => {
            if (hasCorridorOutdoorCache()) {
              const corridorRaster = getMapTilerRasterDirectTilesStyle('outdoor')
              if (corridorRaster) {
                mapLayerDiag('boot-offline-corridor-raster', { layer: initLayer })
                return { style: corridorRaster, delivery: 'maptiler-raster' as BasemapDelivery }
              }
            }
            const emerg = validatedEmergencyFallbackStyle()
            if (emerg) {
              mapLayerDiag('boot-offline-emergency', { layer: initLayer })
              return { style: emerg, delivery: 'maptiler-raster' as BasemapDelivery }
            }
            return resolveHudBasemapStyle(initLayer)
          })()
        : resolveHudBasemapStyle(initLayer)
      const initialStyle = bootBasemap.style
      currentStyleRef.current =
        bootBasemap.delivery === 'vector' && typeof initialStyle === 'string' ? initialStyle : null
      currentAppliedLayerRef.current = null
      logActiveLayerTileDebug(initLayer)
      if (bootBasemap.delivery === 'maptiler-raster') {
        mapLayerDiag('boot-raster', { layer: initLayer })
      }

      hudObsMark('hud:map:boot:start')
      map = new maplibregl.Map({
        container,
        style: initialStyle,
        center: [initialView.lng, initialView.lat],
        zoom: Math.min(initialView.zoom, FIELD_MAX_MAP_ZOOM),
        maxZoom: FIELD_MAX_MAP_ZOOM,
        attributionControl: { compact: true },
        renderWorldCopies: false,
      })

      const clampFieldZoom = () => {
        if (!map) return
        try {
          const z = map.getZoom()
          if (typeof z === 'number' && z > FIELD_MAX_MAP_ZOOM) {
            map.setZoom(FIELD_MAX_MAP_ZOOM)
          }
        } catch {
          /* ignore */
        }
      }
      map.on('zoom', clampFieldZoom)
      map.on('zoomend', () => {
        clampFieldZoom()
        try {
          map?.resize()
        } catch {
          /* ignore */
        }
      })

      hudObsMark('hud:map:boot:constructed')
      mapRef.current = map
      skipLayerSyncRef.current = true
      map.on('style.load', onStyleLoad)
      styleImageMissingHandler = onStyleImageMissingFactory(map)
      map.on('styleimagemissing', styleImageMissingHandler)

      let renderTimer: number | null = window.setTimeout(() => {
        // Safari/WebKit can occasionally create a black map until a fresh context.
        // Perform one hard reset before locking into fallback mode.
        if (startupResetAttemptsRef.current < 1) {
          startupResetAttemptsRef.current += 1
          hardReset()
          return
        }
        fallbackLocked = true
        setStaticFallbackVisible(true)
        setStatus('fallback')
        try {
          const emerg = validatedEmergencyFallbackStyle()
          if (emerg) {
            currentStyleRef.current = null
            map?.setStyle(emerg, { diff: false })
          } else console.error('[MapCanvas] Startup timeout: emergency basemap missing')
        } catch {
          /* ignore */
        }
      }, 5000)

      const clearRenderTimer = () => {
        if (renderTimer != null) {
          window.clearTimeout(renderTimer)
          renderTimer = null
        }
      }

      const markReady = () => {
        if (cancelled || !map || readyOnce) return
        hudObsMark('hud:map:boot:ready')
        hudObsMeasure('hud:map:boot:ready', 'hud:map:boot:start', 'hud:map:boot:ready')
        readyOnce = true
        fallbackLocked = false
        clearRenderTimer()
        setStaticFallbackVisible(false)
        setStatus('ready')
        currentAppliedLayerRef.current = activeLayerRef.current
        try {
          // Ensure canvas dimensions are correct after first actual draw.
          scheduleResize()
          nudgeMapRenderAfterStyleChange(map)
        } catch {
          /* ignore */
        }
        // Only need the first successful idle.
        try {
          map.off('idle', onIdle)
        } catch {
          /* ignore */
        }
        try {
          map.off('data', onData)
        } catch {
          /* ignore */
        }
      }

      const onIdle = () => {
        markReady()
      }

      const onData = () => {
        // WebKit sometimes delays/skips `idle`; data/render means the map is live.
        if (!map) return
        if (map.isStyleLoaded()) markReady()
      }

      const onError = (e: unknown) => {
        // Avoid visible flicker from transient tile/style events after map is already usable.
        // Only force fallback when startup has not reached a ready map yet.
        if (readyOnce || fallbackLocked) {
          console.warn('[MapCanvas] non-fatal map error', e)
          return
        }
        console.warn('[MapCanvas] startup map error — emergency OSM raster only', e)
        fallbackLocked = true
        setStaticFallbackVisible(true)
        setStatus('fallback')
        try {
          const fb = validatedEmergencyFallbackStyle()
          if (fb) {
            currentStyleRef.current = null
            map?.setStyle(fb, { diff: false })
          } else console.error('[MapCanvas] startup error: emergency fallback missing')
        } catch {
          /* ignore */
        }
      }

      const onLoad = () => {
        if (!map) return
        hudObsMark('hud:map:boot:load')
        hudObsMeasure('hud:map:boot:load', 'hud:map:boot:start', 'hud:map:boot:load')
        startupResetAttemptsRef.current = 0
        setMapReady(true)
        setMap(map)
        const cachedFix = readCachedOperationalFix()
        const persisted = readPersistedViewport()
        if (cachedFix) {
          applyOperationalMapCenter(map, cachedFix, persisted)
          autoOperationalCenteringRef.current = true
          window.setTimeout(() => {
            autoOperationalCenteringRef.current = false
          }, 0)
          initialOperationalCenterAppliedRef.current = true
        } else if (persisted) {
          map.jumpTo({
            center: [persisted.lng, persisted.lat],
            zoom: persisted.zoom,
            bearing: persisted.bearing,
            pitch: persisted.pitch,
          })
          restoredViewportRef.current = true
          initialOperationalCenterAppliedRef.current = true
        } else {
          void tryApplyInitialOperationalCenter()
        }
        scheduleResize()
        syncSnapAssistCapability()
        // Safari fallback: do not wait exclusively for `idle`.
        window.setTimeout(() => {
          if (cancelled) return
          if (map && map.isStyleLoaded()) {
            markReady()
          }
        }, isAppleWebKit ? 220 : 320)
        if (watchdogTimer != null) window.clearTimeout(watchdogTimer)
        watchdogTimer = window.setTimeout(() => {
          if (cancelled || !map) return
          if (Date.now() - lastUserInteractionAt > 12000) {
            try {
              map.resize()
            } catch {
              // ignore
            }
            tapDiag('watchdog nudged map after inactivity window')
          }
        }, 13000)
      }

      map.once('load', onLoad)
      map.on('error', onError)
      map.on('idle', onIdle)
      map.on('data', onData)

      // CONTRACT-SENSITIVE (trail snap): capability state must re-evaluate
      // across `styledata` transitions, zoom changes, post-`idle`,
      // BFCache restore (`pageshow`), and tab visibility (iOS suspend/resume).
      // Listener registration is idempotent — `lastSnapCapable` dedup ensures
      // setState is only called when the capability boolean actually flips.
      let lastSnapCapable: boolean | null = null
      const syncSnapAssistCapability = () => {
        if (cancelled || !map) return
        const next = isSnapAvailable(map)
        if (next === lastSnapCapable) return
        lastSnapCapable = next
        setTrailSnapAssistCapable(next)
      }
      snapAssistSyncRef.current = syncSnapAssistCapability
      map.on('zoom', syncSnapAssistCapability)
      map.on('zoomend', syncSnapAssistCapability)
      map.on('styledata', syncSnapAssistCapability)
      map.on('idle', syncSnapAssistCapability)

      /**
       * DEV-ONLY one-shot diagnostic — `window.__hudSnapDiag()` returns the
       * live capability snapshot (zoom, style id/name, layer counts, rejection
       * reasons, and final capability). Resets the dedupe key so the next
       * capability change always logs. Production builds skip this entirely.
       */
      if (import.meta.env.DEV && typeof window !== 'undefined') {
        ;(window as unknown as { __hudSnapDiag?: () => unknown }).__hudSnapDiag = () => {
          if (!map) return { error: 'no map' }
          let zoom: number | null = null
          try { zoom = map.getZoom() } catch { /* ignore */ }
          let styleLoaded = false
          try { styleLoaded = Boolean(map.isStyleLoaded?.()) } catch { /* ignore */ }
          let probe: ReturnType<typeof __probeStyleForTrailLayersForTests> | null = null
          try { probe = __probeStyleForTrailLayersForTests(map) } catch { /* ignore */ }
          const available = isSnapAvailable(map)
          const snap = {
            available,
            zoom,
            minSnapZoom: MIN_SNAP_ZOOM,
            zoomOK: zoom != null && zoom >= MIN_SNAP_ZOOM,
            styleLoaded,
            activeLayer: activeLayerRef.current,
            currentStyleUrl: currentStyleRef.current,
            probe,
          }
          try { console.info('[hud-snap-diag]', snap) } catch { /* ignore */ }
          __resetSnapCapabilityDevLogForTests()
          syncSnapAssistCapability()
          return snap
        }
        ;(window as unknown as { __hudTrailRouteDiag?: () => unknown }).__hudTrailRouteDiag = () => {
          const wps = waypointsRef.current
          if (!map) return { error: 'no map' }
          if (wps.length < 2) return { error: 'need 2+ waypoints', count: wps.length }
          const route = computeTrailRoute(map, wps, isSnapAvailable(map))
          const legs = wps.slice(1).map((wp, i) => {
            const prev = wps[i]
            return diagnoseTrailLeg(map, { lat: prev.lat, lng: prev.lng }, { lat: wp.lat, lng: wp.lng })
          })
          const out = {
            capable: isSnapAvailable(map),
            allTrail: route.allTrail,
            coordCount: route.coordinates.length,
            totalMiles: route.totalDistance.miles,
            legs,
          }
          try { console.info('[hud-trail-route-diag]', out) } catch { /* ignore */ }
          return out
        }
      }

      // Some browsers (notably mobile) can hard-break WebGL; force recovery.
      ;(map as any).on?.('webglcontextlost', () => {
        setStaticFallbackVisible(true)
        setStatus('fallback')
        hardReset()
      })

      const placeWaypoint = (e: any, source: 'click' | 'touch'): boolean => {
        if (!map) return false
        if (isWaypointMarkerTouchActive()) return false
        // CONTRACT-SENSITIVE (trail snap): while a preview is open, ignore
        // further map taps — operator must use explicit buttons. Never queue
        // multiple previews; gate ensures no duplicate placement from stacked gestures.
        if (snapPreviewGateRef.current.isLocked()) return false
        // MapLibre native coordinates only (no unproject / client pixel math).
        const ll = e?.lngLat ?? e?.latlng
        if (!ll || typeof ll.lat !== 'number' || typeof ll.lng !== 'number') return false
        const lat = ll.lat
        const lng = ll.lng
        if (
          !isWaypointPlacementAllowed(
            waypointDropBlockedRef.current,
            pendingTypeRef.current,
          )
        ) {
          return false
        }
        const now = Date.now()
        // Stability guard: prevent accidental double-drops from rapid taps/clicks.
        if (now - lastDropAtRef.current < 220) return false
        lastDropAtRef.current = now

        // Ignore placement while camera is moving, except deliberate touch taps.
        if (source !== 'touch' && map.isMoving()) return false
        const nextIdx = waypointCountRef.current + 1
        const type = pendingTypeRef.current
        const manualLabel = nextWaypointLabelRef.current.trim().slice(0, 64)
        const autoBase =
          type === 'default'
            ? 'WP'
            : type === 'finish'
              ? 'FINISH'
              : type === 'start'
                ? 'START'
                : type === 'rest'
                  ? 'REST'
                  : type.toUpperCase()
        const label = manualLabel || `${autoBase}-${nextIdx}`
        const makeId = () => `wp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

        const commitWaypoint = (wp: Waypoint): boolean => {
          try {
            addWaypoint(wp)
          } catch (err) {
            console.error('[MapCanvas] waypoint add failed', err)
            return false
          }
          setDebugClickRef.current({ lat: wp.lat, lng: wp.lng })
          if (!keepArmedRef.current) setPendingType('default')
          if (clearLabelAfterDropRef.current && manualLabel) setNextWaypointLabel('')
          return true
        }

        const reportWaypointSnapObservation = (
          tier1: Parameters<typeof observeWaypointDropAfterCommit>[0]['tier1'],
        ) => {
          const g = gpsRef.current
          observeWaypointDropAfterCommit({
            getMap: () => mapRef.current,
            tapLat: lat,
            tapLng: lng,
            deviceGps:
              g.lat != null && g.lng != null
                ? {
                    lat: g.lat,
                    lng: g.lng,
                    accuracy: g.accuracy,
                    source: g.source,
                  }
                : undefined,
            tier1,
          })
        }

        // CONTRACT-SENSITIVE (trail snap): when enabled on Outdoor, snap pin to
        // nearest rendered trail within MAX_SNAP_RADIUS_M. No candidate → raw drop
        // (same as snap OFF). Checkbox OFF skips this block entirely.
        const tier1SnapAttempted =
          snapToTrailEnabledRef.current &&
          activeLayerRef.current === 'outdoor' &&
          isSnapAvailable(map)

        if (tier1SnapAttempted) {
          const cand = findNearestTrailCandidate(map, {
            lat,
            lng,
            radiusMeters: MAX_SNAP_RADIUS_M,
          })
          if (cand) {
            clearTrailSnapPreview()
            lastDropAtRef.current = Date.now()
            const placed = commitWaypoint({
              id: makeId(),
              lng: cand.snappedLng,
              lat: cand.snappedLat,
              rawLat: lat,
              rawLng: lng,
              source: 'snapped',
              snapDistanceMeters: cand.distanceMeters,
              label,
              type,
              createdAt: Date.now(),
            })
            if (placed) {
              reportWaypointSnapObservation({
                committed: true,
                source: 'snapped',
                lat: cand.snappedLat,
                lng: cand.snappedLng,
                rawLat: lat,
                rawLng: lng,
                snapDistanceMeters: cand.distanceMeters,
                tier1SnapAttempted: true,
                tier1SnapAccepted: true,
              })
            }
            return placed
          }
        }

        try {
          addWaypoint({
            id: makeId(),
            lng,
            lat,
            label,
            type,
            createdAt: Date.now(),
          })
        } catch (err) {
          console.error('[MapCanvas] waypoint add failed', err)
          return false
        }
        setDebugClickRef.current({ lat, lng })
        if (!keepArmedRef.current) setPendingType('default')
        if (clearLabelAfterDropRef.current && manualLabel) setNextWaypointLabel('')
        reportWaypointSnapObservation({
          committed: true,
          source: 'raw',
          lat,
          lng,
          rawLat: lat,
          rawLng: lng,
          snapDistanceMeters: null,
          tier1SnapAttempted,
          tier1SnapAccepted: false,
        })
        return true
      }

      const maybeDispatchTrailInspect = (e: { lngLat?: { lat: number; lng: number } }) => {
        if (activeLayerRef.current !== 'outdoor') return
        if (
          isWaypointPlacementAllowed(
            waypointDropBlockedRef.current,
            pendingTypeRef.current,
          )
        ) {
          return
        }
        const ll = e?.lngLat
        if (!ll || typeof ll.lat !== 'number' || typeof ll.lng !== 'number') return
        dispatchTrailInspectTap(ll.lat, ll.lng)
      }

      map.on('click', (e: any) => {
        lastUserInteractionAt = Date.now()
        markUserViewportControl()
        // iOS emits synthetic click shortly after a successful touch drop.
        if (Date.now() - lastTouchDropAt < 550) return
        maybeDispatchTrailInspect(e)
        selectWaypoint(null)
        tapDiag('click placement attempt')
        placeWaypoint(e, 'click')
      })
      map.on('touchstart', (e: any) => {
        lastUserInteractionAt = Date.now()
        markUserViewportControl()
        const pointCount = Array.isArray(e?.points) ? e.points.length : 0
        multiTouchActive = pointCount > 1
        const p = e?.points?.[0]
        touchStart = p ? { x: p.x, y: p.y } : null
        touchLast = touchStart
        touchMoved = false
        tapDiag(`touchstart points=${pointCount}`)
      })
      map.on('touchmove', (e: any) => {
        lastUserInteractionAt = Date.now()
        const p = e?.points?.[0]
        if (!p || !touchStart) return
        touchLast = { x: p.x, y: p.y }
        const moveTolerance = isAppleWebKit ? 18 : 10
        if (Math.hypot(p.x - touchStart.x, p.y - touchStart.y) > moveTolerance) {
          touchMoved = true
          tapDiag('touchmove crossed drag tolerance')
        }
      })
      map.on('touchend', (e: any) => {
        lastUserInteractionAt = Date.now()
        if (multiTouchActive) {
          const remaining = Array.isArray(e?.points) ? e.points.length : 0
          if (remaining <= 1) multiTouchActive = false
          return
        }
        if (touchMoved) return
        maybeDispatchTrailInspect(e)
        selectWaypoint(null)
        const dropped = placeWaypoint(e, 'touch')
        if (dropped) lastTouchDropAt = Date.now()
        tapDiag(`touchend dropped=${String(dropped)}`)
      })
      map.on('dragstart', markUserViewportControl)
      map.on('zoomstart', markUserViewportControl)
      map.on('rotatestart', markUserViewportControl)
      map.on('pitchstart', markUserViewportControl)
      map.on('movestart', () => {
        if (autoOperationalCenteringRef.current) return
        markUserViewportControl()
      })
      map.on('moveend', () => {
        if (!map) return
        if (!userHasTakenViewportControlRef.current) return
        persistViewport(map)
      })
    }

    roRef.current = new ResizeObserver(() => {
      scheduleResize()
    })
    roRef.current.observe(container)

    const vv = window.visualViewport
    const onVisualViewportChange = () => {
      if (import.meta.env.DEV) {
        const diag = devResizeDiagRef.current
        diag.viewportTriggers += 1
        const now = Date.now()
        if (now - diag.loggedAt >= 2500) {
          const noisyViewport = diag.viewportTriggers >= 18
          const noisyResize = diag.mapResizeCalls >= 12
          if (noisyViewport || noisyResize) {
            console.info('[HUD DEV] viewport-resize-churn', {
              viewportTriggers: diag.viewportTriggers,
              mapResizeCalls: diag.mapResizeCalls,
              resizeSuppressedSameBounds: diag.resizeSuppressedSameBounds,
              windowSize: { w: window.innerWidth, h: window.innerHeight },
              visualViewport: {
                w: Math.round(window.visualViewport?.width ?? window.innerWidth),
                h: Math.round(window.visualViewport?.height ?? window.innerHeight),
              },
            })
          }
          diag.viewportTriggers = 0
          diag.mapResizeCalls = 0
          diag.resizeSuppressedSameBounds = 0
          diag.loggedAt = now
        }
      }
      scheduleResize()
    }
    vv?.addEventListener('resize', onVisualViewportChange)
    vv?.addEventListener('scroll', onVisualViewportChange)
    window.addEventListener('orientationchange', onVisualViewportChange)

    /**
     * CONTRACT-SENSITIVE (trail snap, iOS): On tab visibility resume, resize the
     * WebGL canvas *and* re-run snap capability (single `visibilitychange`
     * listener — deduped with resize path). BFCache restore uses `pageshow`
     * below because it does not always pair with `visibilitychange`.
     */
    const onVisibilityChange = function onVisibilityChange() {
      if (document.hidden) return
      if (document.visibilityState !== 'visible') return
      if (cancelled) return
      if (!map) return
      scheduleResize()
      if (typeof navigator !== 'undefined' && !navigator.onLine && hasCorridorOutdoorCache()) {
        applyOfflineCorridorBasemapIfNeeded(map)
      }
      nudgeMapRenderAfterStyleChange(map)
      mapLayerDiag('visibility-resume', { layer: activeLayerRef.current })
      const fn = snapAssistSyncRef.current
      if (typeof fn === 'function') fn()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    /**
     * CONTRACT-SENSITIVE (trail snap, iOS): BFCache restore (`pageshow` with
     * `persisted=true`) does NOT re-fire `style.load` / `styledata`, so a
     * stale `false` set during navigation away can stick.
     */
    const onSnapAssistPageshow = (ev: PageTransitionEvent) => {
      if (!map || cancelled) return
      if (ev.persisted || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        applyOfflineCorridorBasemapIfNeeded(map)
        scheduleResize()
      }
      const fn = snapAssistSyncRef.current
      if (typeof fn === 'function') fn()
    }
    window.addEventListener('pageshow', onSnapAssistPageshow)

    initMap()

    return () => {
      setMapReady(false)
      setTrailSnapAssistCapable(false)
      clearTrailSnapPreview()
      vv?.removeEventListener('resize', onVisualViewportChange)
      vv?.removeEventListener('scroll', onVisualViewportChange)
      window.removeEventListener('orientationchange', onVisualViewportChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onSnapAssistPageshow)
      if (import.meta.env.DEV && typeof window !== 'undefined') {
        try {
          delete (window as unknown as { __hudSnapDiag?: unknown }).__hudSnapDiag
        } catch {
          /* ignore */
        }
      }
      snapAssistSyncRef.current = null
      roRef.current?.disconnect()
      roRef.current = null
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
      if (watchdogTimer != null) {
        window.clearTimeout(watchdogTimer)
        watchdogTimer = null
      }
      cancelled = true
      try {
        if (map && styleImageMissingHandler) {
          map.off('styleimagemissing', styleImageMissingHandler)
        }
      } catch {
        /* ignore */
      }
      styleImageMissingHandler = null
      try {
        map?.off('style.load', onStyleLoad)
      } catch {
        /* ignore */
      }
      try {
        setMap(null)
      } catch {
        /* ignore */
      }
      setStatus('initial')
      mapRef.current = null
      try {
        map?.remove()
      } catch {
        /* ignore */
      }
      map = null
    }
  }, [setMap, addWaypoint, setPendingType, setNextWaypointLabel, selectWaypoint, setTrailSnapAssistCapable])

  // React to layer preset changes (streets / topo / outdoor / satellite)
  useEffect(() => {
    if (!mapRef.current) return
    // Capture for nested handlers — ref may be cleared on unmount; handlers only run while effect is active.
    const mapCtl: maplibregl.Map = mapRef.current

    if (skipLayerSyncRef.current) {
      skipLayerSyncRef.current = false
      return
    }

    const layerKey = activeLayer as MapStyleKey

    const gen = ++styleSwitchGenRef.current
    const prepared = prepareBasemapSwitch(mapCtl, layerKey, currentAppliedLayerRef)
    if (prepared.skip) {
      tier1Debug('map-layer', 'validated-switch-skip-duplicate', {
        layer: activeLayer,
        applied: currentAppliedLayerRef.current,
      })
      syncTopoTerrain(mapCtl, activeLayer)
      nudgeMapRenderAfterStyleChange(mapCtl)
      return
    }
    const nextStyle = prepared.style
    const switchDelivery = prepared.delivery
    const vectorStyleUrl = getStyleUrl(layerKey)
    logActiveLayerTileDebug(activeLayer)
    logLayerSelection(
      activeLayer,
      typeof nextStyle === 'string' ? nextStyle : vectorStyleUrl,
      { gen, delivery: switchDelivery },
    )
    const fp = mapStyleFingerprint(nextStyle)
    tier1Debug('map-layer', 'validated-switch', { layer: activeLayer, fp })
    const { fallbackOverlayMs, stallMs, maxRetry } = layerSwitchTimeouts()
    const switchStartedAt = Date.now()
    let urlForThisGen = typeof nextStyle === 'string' ? nextStyle : vectorStyleUrl
    let appliedFpForThisGen = fp
    let cancelled = false
    let styleFallbackTimer: number | null = null
    let stallRecoverTimer: number | null = null
    let styleReady = false
    let styleLoadSeen = false
    let recoveryMode: 'none' | 'maptiler-raster' | 'osm-emergency' = 'none'
    let vectorRetryCount = 0

    function msSinceStart(): number {
      return Date.now() - switchStartedAt
    }

    function markStyleReady(phase: 'load' | 'idle' | 'data') {
      if (cancelled || gen !== styleSwitchGenRef.current || styleReady) return
      if (activeLayerRef.current !== layerKey) return
      logStyleSwitchTiming(activeLayer, phase, msSinceStart(), { recoveryMode })
      hudObsMark(`hud:map:style:${gen}:ready`)
      hudObsMeasure(`hud:map:style:${gen}`, `hud:map:style:${gen}:start`, `hud:map:style:${gen}:ready`)
      styleReady = true
      if (recoveryMode === 'none') {
        currentStyleRef.current = urlForThisGen
      } else if (recoveryMode === 'maptiler-raster') {
        currentStyleRef.current = null
      } else {
        currentStyleRef.current = null
      }
      if (styleFallbackTimer != null) {
        window.clearTimeout(styleFallbackTimer)
        styleFallbackTimer = null
      }
      if (stallRecoverTimer != null) {
        window.clearTimeout(stallRecoverTimer)
        stallRecoverTimer = null
      }
      setStaticFallbackVisible(false)
      setStatusRef.current('ready')
      currentAppliedLayerRef.current = layerKey
      syncTopoTerrain(mapCtl, layerKey)
      nudgeMapRenderAfterStyleChange(mapCtl)
      logLayerActivation(activeLayer, recoveryMode === 'none' ? 'ready' : recoveryMode === 'maptiler-raster' ? 'raster-fallback' : 'osm-emergency', {
        fp: appliedFpForThisGen,
        ms: msSinceStart(),
      })
      const snapSync = snapAssistSyncRef.current
      if (typeof snapSync === 'function') snapSync()
      try {
        mapCtl.off('data', onData)
      } catch {
        // ignore
      }
      try {
        mapCtl.off('error', onStyleError)
      } catch {
        // ignore
      }
      try {
        mapCtl.off('style.load', onStyleLoadOnce)
      } catch {
        // ignore
      }
    }

    function onData() {
      if (!styleLoadSeen) return
      if (mapCtl.isStyleLoaded()) markStyleReady('data')
    }

    function onIdleOnce() {
      if (cancelled || gen !== styleSwitchGenRef.current) return
      if (!styleLoadSeen) return
      markStyleReady('idle')
    }

    function onStyleLoadOnce() {
      if (cancelled || gen !== styleSwitchGenRef.current) return
      if (activeLayerRef.current !== layerKey) return
      styleLoadSeen = true
      const afterStylePaint = () => {
        if (cancelled || gen !== styleSwitchGenRef.current) return
        if (activeLayerRef.current !== layerKey) return
        try {
          mapCtl.setTerrain(null)
        } catch {
          /* drop MapTiler embedded terrain before HUD DEM */
        }
        try {
          syncTopoTerrain(mapCtl, layerKey)
        } catch {
          /* ignore */
        }
        nudgeMapRenderAfterStyleChange(mapCtl)
      }
      mapCtl.once('idle', afterStylePaint)
    }

    function bindStyleReadyHandlers() {
      styleLoadSeen = false
      mapCtl.once('idle', onIdleOnce)
      mapCtl.on('data', onData)
      mapCtl.once('style.load', onStyleLoadOnce)
    }

    function unbindStyleReadyHandlers() {
      try {
        mapCtl.off('idle', onIdleOnce)
      } catch {
        /* ignore */
      }
      try {
        mapCtl.off('data', onData)
      } catch {
        // ignore
      }
      try {
        mapCtl.off('style.load', onStyleLoadOnce)
      } catch {
        // ignore
      }
    }

    function applyStyleTarget(
      target: string | maplibregl.StyleSpecification,
      mode: typeof recoveryMode,
    ) {
      recoveryMode = mode
      appliedFpForThisGen = mapStyleFingerprint(target)
      urlForThisGen = typeof target === 'string' ? target : appliedFpForThisGen
      unbindStyleReadyHandlers()
      try {
        mapCtl.setTerrain(null)
      } catch {
        /* drop embedded terrain before style swap */
      }
      mapCtl.setStyle(target, { diff: false })
      bindStyleReadyHandlers()
      // Repaint only after style.load/idle — immediate nudge races terrainDepth (shaderPreludeCode).
    }

    function applyMapTilerRasterFallback(reason: string): boolean {
      const raster = getMapTilerRasterFallbackStyle(layerKey)
      if (!raster) return false
      console.warn(
        `[MapCanvas] ${reason} — MapTiler raster fallback for "${activeLayer}" (iOS/WebKit recovery)`,
      )
      mapLayerDiag('raster-fallback', { layer: activeLayer, reason, ms: msSinceStart() })
      try {
        applyStyleTarget(raster, 'maptiler-raster')
        return true
      } catch {
        return false
      }
    }

    function applyEmergencyFallback(reason: string) {
      if (cancelled || gen !== styleSwitchGenRef.current) return
      if (recoveryMode !== 'none') return
      if (applyMapTilerRasterFallback(reason)) return
      recoveryMode = 'osm-emergency'
      console.warn(`[MapCanvas] ${reason} — emergency OSM raster (MapTiler preset "${activeLayer}" failed)`)
      const r = validatedEmergencyFallbackStyle()
      if (!r) {
        console.error('[MapCanvas] Emergency recovery: no validated style')
        setStaticFallbackVisible(true)
        setStatusRef.current('fallback')
        logLayerActivation(activeLayer, 'error', { reason })
        return
      }
      appliedFpForThisGen = mapStyleFingerprint(r)
      tier1Debug('map-layer', 'validated-switch', { layer: activeLayer, fp: appliedFpForThisGen, recovery: true })
      try {
        applyStyleTarget(r, 'osm-emergency')
      } catch {
        setStaticFallbackVisible(true)
        setStatusRef.current('fallback')
      }
    }

    function scheduleStallTimer() {
      if (stallRecoverTimer != null) {
        window.clearTimeout(stallRecoverTimer)
      }
      stallRecoverTimer = window.setTimeout(() => {
        if (cancelled || gen !== styleSwitchGenRef.current) return
        if (styleReady) return
        logStyleSwitchTiming(activeLayer, 'timeout', msSinceStart())
        logLayerActivation(activeLayer, 'stalled', { ms: msSinceStart() })
        if (retryVectorStyle('Style load stalled (timeout)')) return
        applyEmergencyFallback('Style load stalled (timeout)')
      }, stallMs)
    }

    function retryVectorStyle(reason: string): boolean {
      if (vectorRetryCount >= maxRetry) return false
      if (switchDelivery === 'maptiler-raster') {
        return false
      }
      vectorRetryCount += 1
      logLayerActivation(activeLayer, 'retry', { reason, attempt: vectorRetryCount })
      mapLayerDiag('vector-retry', { layer: activeLayer, reason, attempt: vectorRetryCount })
      try {
        scheduleStallTimer()
        applyStyleTarget(vectorStyleUrl, 'none')
        return true
      } catch {
        return false
      }
    }

    function onStyleError(e: unknown) {
      if (cancelled || gen !== styleSwitchGenRef.current) return
      if (recoveryMode !== 'none') return
      logStyleSwitchTiming(activeLayer, 'error', msSinceStart(), { error: String(e) })
      if (!styleFailureWarrantsEmergencyFallback(e)) {
        mapLayerDiag('non-fatal-style-error', { layer: activeLayer, error: String(e) })
        return
      }
      if (retryVectorStyle('MapTiler / style load error')) return
      applyEmergencyFallback('MapTiler / style load error')
    }

    function beginLayerSwitch() {
      if (
        typeof nextStyle === 'string' &&
        !nextStyle &&
        switchDelivery === 'vector'
      ) {
        applyEmergencyFallback('MapTiler vector URL missing for layer')
        return
      }
      setStatusRef.current('initial')
      currentAppliedLayerRef.current = null
      mapCtl.on('error', onStyleError)
      styleFallbackTimer = window.setTimeout(() => {
        if (cancelled || gen !== styleSwitchGenRef.current) return
        if (styleReady) return
        setStaticFallbackVisible(true)
      }, fallbackOverlayMs)

      scheduleStallTimer()

      hudObsMark(`hud:map:style:${gen}:start`)
      logStyleSwitchTiming(activeLayer, 'start', 0, {
        fp,
        stallMs,
        fallbackOverlayMs,
        delivery: switchDelivery,
      })
      applyStyleTarget(
        nextStyle,
        switchDelivery === 'maptiler-raster' ? 'maptiler-raster' : 'none',
      )
    }

    const onLayerPageshow = (ev: PageTransitionEvent) => {
      if (!ev.persisted || cancelled || gen !== styleSwitchGenRef.current) return
      currentAppliedLayerRef.current = null
      try {
        const resolved = resolveHudBasemapStyle(layerKey)
        applyStyleTarget(
          resolved.style,
          resolved.delivery === 'maptiler-raster' ? 'maptiler-raster' : 'none',
        )
        nudgeMapRenderAfterStyleChange(mapCtl)
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pageshow', onLayerPageshow)

    try {
      beginLayerSwitch()
    } catch (e) {
      console.warn('[MapCanvas] setStyle failed', e)
      try {
        mapCtl.off('error', onStyleError)
      } catch {
        /* ignore */
      }
      if (retryVectorStyle('setStyle threw')) return
      if (applyMapTilerRasterFallback('setStyle threw')) return
      try {
        const r = validatedEmergencyFallbackStyle()
        if (!r) {
          console.error('[MapCanvas] setStyle catch: emergency fallback missing')
          setStaticFallbackVisible(true)
          setStatusRef.current('fallback')
        } else {
          recoveryMode = 'osm-emergency'
          appliedFpForThisGen = mapStyleFingerprint(r)
          currentStyleRef.current = null
          applyStyleTarget(r, 'osm-emergency')
        }
      } catch {
        setStaticFallbackVisible(true)
        setStatusRef.current('fallback')
      }
    }

    return () => {
      cancelled = true
      window.removeEventListener('pageshow', onLayerPageshow)
      if (styleFallbackTimer != null) {
        window.clearTimeout(styleFallbackTimer)
      }
      if (stallRecoverTimer != null) {
        window.clearTimeout(stallRecoverTimer)
      }
      unbindStyleReadyHandlers()
      try {
        mapCtl.off('error', onStyleError)
      } catch {
        // ignore
      }
    }
  }, [activeLayer])

  // Debug: MapLibre circle at last native click/touch lngLat (set `hud_debug_waypoints=1`).
  useEffect(() => {
    const map = mapInstance
    if (!map) return
    const debugOverlayEnabled = () =>
      (typeof localStorage !== 'undefined' && localStorage.getItem('hud_debug_waypoints') === '1') ||
      (typeof window !== 'undefined' && window.location.search.includes('debug_click=1'))

    const clear = () => {
      try {
        if (map.getLayer(HUD_DEBUG_CLICK_LAYER)) map.removeLayer(HUD_DEBUG_CLICK_LAYER)
        if (map.getSource(HUD_DEBUG_CLICK_SRC)) map.removeSource(HUD_DEBUG_CLICK_SRC)
      } catch {
        /* ignore */
      }
    }

    const apply = () => {
      try {
        if (!map.getStyle()) return
        if (!map.isStyleLoaded()) return
      } catch {
        return
      }
      if (!debugOverlayEnabled() || !debugClick) {
        clear()
        return
      }
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Point',
              coordinates: [debugClick.lng, debugClick.lat],
            },
          },
        ],
      }
      try {
        const existing = map.getSource(HUD_DEBUG_CLICK_SRC) as GeoJSONSource | undefined
        if (existing) {
          existing.setData(fc)
          if (!map.getLayer(HUD_DEBUG_CLICK_LAYER)) {
            map.addLayer({
              id: HUD_DEBUG_CLICK_LAYER,
              type: 'circle',
              source: HUD_DEBUG_CLICK_SRC,
              paint: {
                'circle-radius': 4,
                'circle-color': '#ff00ff',
                'circle-opacity': 0.95,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff',
              },
            })
          }
        } else {
          map.addSource(HUD_DEBUG_CLICK_SRC, { type: 'geojson', data: fc })
          map.addLayer({
            id: HUD_DEBUG_CLICK_LAYER,
            type: 'circle',
            source: HUD_DEBUG_CLICK_SRC,
            paint: {
              'circle-radius': 4,
              'circle-color': '#ff00ff',
              'circle-opacity': 0.95,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
            },
          })
        }
      } catch {
        /* style churn */
      }
    }

    apply()
    map.on('styledata', apply)
    return () => {
      map.off('styledata', apply)
      clear()
    }
  }, [mapInstance, debugClick])

  useEffect(() => {
    const map = mapInstance
    if (!mapReady) return
    if (!map) return
    if (gps.lat == null || gps.lng == null) return
    if (!userMarkerRef.current) {
      const el = createUserMarkerEl()
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([gps.lng, gps.lat])
        .addTo(map)
      tier1Debug('map', 'user marker created')
      return
    }
    userMarkerRef.current.setLngLat([gps.lng, gps.lat])
  }, [mapReady, mapInstance, gps.lat, gps.lng])

  useEffect(() => {
    if (!mapReady) return
    if (restoredViewportRef.current) return
    if (userHasTakenViewportControlRef.current) return
    if (initialOperationalCenterAppliedRef.current) return
    void tryApplyInitialOperationalCenter()
  }, [mapReady, gps.lat, gps.lng, tryApplyInitialOperationalCenter])

  useEffect(() => {
    return () => {
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        width: '100%',
        height: '100%',
        minHeight: '100dvh',
        background: '#1a1f24',
      }}
    >
      {showMapFallbackBubble && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'opacity 220ms ease, visibility 220ms ease',
            background: 'transparent',
            pointerEvents: 'none',
            zIndex: 2,
            color: '#b9d4dd',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontSize: 11,
            textShadow: '0 0 10px rgba(0,0,0,0.55)',
          }}
        >
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid rgba(148,193,207,0.35)',
              background: 'rgba(8,14,18,0.28)',
              backdropFilter: 'blur(2px)',
            }}
          >
            Map fallback active
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
          transform: 'none',
          filter: 'none',
        }}
      />
    </div>
  )
}
