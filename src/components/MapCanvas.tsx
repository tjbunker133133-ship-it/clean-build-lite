import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { useGPS } from '../hooks/useGPS'
import type { LayerType, Waypoint } from '../types'
import {
  getStyleUrl,
  type MapStyleKey,
  logActiveLayerTileDebug,
  mapStyleFingerprint,
  maptilerTerrainRgbTileJson,
  validatedEmergencyFallbackStyle,
} from '../lib/mapStyles'
import { tier1Debug } from '../lib/tier1DebugLog'
import {
  __probeStyleForTrailLayersForTests,
  __resetSnapCapabilityDevLogForTests,
  createTrailSnapPreviewGate,
  findNearestTrailCandidate,
  isSnapAvailable,
  MAX_SNAP_RADIUS_M,
  MIN_SNAP_ZOOM,
} from '../lib/snapToTrail'
import { hudObsMark, hudObsMeasure } from '../diag/hudObs'
import { getDeviceProfile } from '../runtime/deviceProfile'

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

/** Placeholder icons when sprite entries fail (network / CORS / ad block). */
function onStyleImageMissingFactory(map: maplibregl.Map) {
  return (e: { id: string }) => {
    if (map.hasImage(e.id)) return
    console.warn('[MAP] Missing sprite image:', e.id)
    try {
      const size = 32
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(210, 72, 72, 0.9)'
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 4, 0, Math.PI * 2)
      ctx.fill()
      map.addImage(e.id, ctx.getImageData(0, 0, size, size))
    } catch {
      /* ignore */
    }
  }
}

function syncTopoTerrain(map: maplibregl.Map, layer: LayerType) {
  if (layer === 'topo') {
    try {
      if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          url: maptilerTerrainRgbTileJson(),
          tileSize: 256,
        })
      }
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 })
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

/** Layer panel / state use keys only (`LayerType` ≡ `MapStyleKey`); URLs come from `getStyleUrl`. */
function prepareBasemapSwitch(
  map: maplibregl.Map,
  styleKey: MapStyleKey,
  currentStyleRef: MutableRefObject<string | null>,
): { skip: true } | { skip: false; url: string } {
  const nextStyle = getStyleUrl(styleKey)
  // Never re-apply the same style URL while a load is in flight (`isStyleLoaded` is false).
  if (currentStyleRef.current === nextStyle) {
    return { skip: true }
  }
  currentStyleRef.current = nextStyle
  return { skip: false, url: nextStyle }
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
  const { map: mapInstance, setMap, setStatus } = useMapContext()
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
  const lastDropAtRef = useRef(0)
  const nextWaypointLabelRef = useRef(nextWaypointLabel)
  nextWaypointLabelRef.current = nextWaypointLabel
  const keepArmedRef = useRef(keepWaypointToolArmed)
  keepArmedRef.current = keepWaypointToolArmed
  const clearLabelAfterDropRef = useRef(clearLabelAfterDrop)
  clearLabelAfterDropRef.current = clearLabelAfterDrop
  const [watchdogNotice, setWatchdogNotice] = useState(false)
  const styleSwitchGenRef = useRef(0)
  /** Last applied basemap style URL — duplicate `setStyle` guard. */
  const currentStyleRef = useRef<string | null>(null)
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

    const STATIC_CENTER = { lng: -105.7821, lat: 39.5501 }

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

      const initLayer = activeLayerRef.current
      const initialStyle = getStyleUrl(initLayer as MapStyleKey)
      currentStyleRef.current = initialStyle
      logActiveLayerTileDebug(initLayer)

      hudObsMark('hud:map:boot:start')
      map = new maplibregl.Map({
        container,
        style: initialStyle,
        center: [STATIC_CENTER.lng, STATIC_CENTER.lat],
        zoom: 10,
        attributionControl: { compact: true },
        renderWorldCopies: false,
      })

      hudObsMark('hud:map:boot:constructed')
      mapRef.current = map
      skipLayerSyncRef.current = true
      setWatchdogNotice(false)
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
        try {
          // Ensure canvas dimensions are correct after first actual draw.
          scheduleResize()
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
        const persisted = readPersistedViewport()
        if (persisted) {
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
            setWatchdogNotice(true)
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
      }

      // Some browsers (notably mobile) can hard-break WebGL; force recovery.
      ;(map as any).on?.('webglcontextlost', () => {
        setStaticFallbackVisible(true)
        setStatus('fallback')
        hardReset()
      })

      const placeWaypoint = (e: any, source: 'click' | 'touch'): boolean => {
        if (!map) return false
        // CONTRACT-SENSITIVE (trail snap): while a preview is open, ignore
        // further map taps — operator must use explicit buttons. Never queue
        // multiple previews; gate ensures no duplicate placement from stacked gestures.
        if (snapPreviewGateRef.current.isLocked()) return false
        // MapLibre native coordinates only (no unproject / client pixel math).
        const ll = e?.lngLat ?? e?.latlng
        if (!ll || typeof ll.lat !== 'number' || typeof ll.lng !== 'number') return false
        const lat = ll.lat
        const lng = ll.lng
        if (waypointDropBlockedRef.current) {
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

        // CONTRACT-SENSITIVE (trail snap): preview-only path. When OFF or
        // unavailable, this block is skipped — behavior matches pre-snap
        // byte-for-byte. Failure to find a candidate must fall through to raw.
        // Snap failure / gate failure never blocks placement; only explicit
        // preview confirmation writes snapped coordinates.
        if (snapToTrailEnabledRef.current && isSnapAvailable(map)) {
          const cand = findNearestTrailCandidate(map, {
            lat,
            lng,
            radiusMeters: MAX_SNAP_RADIUS_M,
          })
          if (cand) {
            clearTrailSnapPreview()
            if (!snapPreviewGateRef.current.tryLock()) return false

            const rawEl = document.createElement('div')
            rawEl.style.cssText =
              'width:14px;height:14px;border-radius:50%;background:#fb923c;border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.5)'
            const snapEl = document.createElement('div')
            snapEl.style.cssText =
              'width:14px;height:14px;border-radius:50%;background:#5eead4;border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.5)'

            const rawMarker = new maplibregl.Marker({ element: rawEl })
              .setLngLat([lng, lat])
              .addTo(map)
            const snapMarker = new maplibregl.Marker({ element: snapEl })
              .setLngLat([cand.snappedLng, cand.snappedLat])
              .addTo(map)

            const bar = document.createElement('div')
            bar.setAttribute('data-trail-snap-preview', '1')
            bar.style.cssText =
              'position:absolute;bottom:28px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:10px;background:rgba(8,12,18,0.92);border:1px solid rgba(94,234,212,0.45);pointer-events:auto'
            const mkBtn = (text: string, primary: boolean) => {
              const b = document.createElement('button')
              b.type = 'button'
              b.setAttribute('data-no-drag', '1')
              b.textContent = text
              b.style.cssText = [
                'cursor:pointer',
                'font-weight:800',
                'letter-spacing:0.06em',
                'font-size:11px',
                'padding:10px 14px',
                'border-radius:8px',
                primary
                  ? 'border:1px solid rgba(94,234,212,0.7);background:rgba(94,234,212,0.15);color:#ccfbf1'
                  : 'border:1px solid rgba(148,163,184,0.5);background:rgba(30,41,59,0.6);color:#e2e8f0',
              ].join(';')
              return b
            }
            const btnSnap = mkBtn('Use Snapped', true)
            const btnRaw = mkBtn('Use Raw', false)
            bar.appendChild(btnSnap)
            bar.appendChild(btnRaw)
            map.getContainer().appendChild(bar)

            const finish = (mode: 'snapped' | 'raw') => {
              clearTrailSnapPreview()
              lastDropAtRef.current = Date.now()
              if (mode === 'snapped') {
                commitWaypoint({
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
              } else {
                commitWaypoint({
                  id: makeId(),
                  lng,
                  lat,
                  label,
                  type,
                  createdAt: Date.now(),
                })
              }
            }
            btnSnap.addEventListener('click', (ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              finish('snapped')
            })
            btnRaw.addEventListener('click', (ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              finish('raw')
            })

            snapPreviewCleanupRef.current = () => {
              rawMarker.remove()
              snapMarker.remove()
              bar.remove()
            }
            return true
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
        return true
      }

      map.on('click', (e: any) => {
        lastUserInteractionAt = Date.now()
        markUserViewportControl()
        // iOS emits synthetic click shortly after a successful touch drop.
        if (Date.now() - lastTouchDropAt < 550) return
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
      const fn = snapAssistSyncRef.current
      if (typeof fn === 'function') fn()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    /**
     * CONTRACT-SENSITIVE (trail snap, iOS): BFCache restore (`pageshow` with
     * `persisted=true`) does NOT re-fire `style.load` / `styledata`, so a
     * stale `false` set during navigation away can stick.
     */
    const onSnapAssistPageshow = () => {
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

    const nextStyleUrl = getStyleUrl(activeLayer as MapStyleKey)
    if (currentStyleRef.current === nextStyleUrl) {
      tier1Debug('map-layer', 'skip-duplicate-style-url', {
        layer: activeLayer,
        fp: mapStyleFingerprint(nextStyleUrl),
      })
      return
    }

    const gen = ++styleSwitchGenRef.current
    const prepared = prepareBasemapSwitch(mapCtl, activeLayer as MapStyleKey, currentStyleRef)
    if (prepared.skip) {
      tier1Debug('map-layer', 'validated-switch-skip-duplicate', {
        layer: activeLayer,
        fp: mapStyleFingerprint(getStyleUrl(activeLayer as MapStyleKey)),
      })
      return
    }
    const nextStyle = prepared.url
    logActiveLayerTileDebug(activeLayer)
    const fp = mapStyleFingerprint(nextStyle)
    tier1Debug('map-layer', 'validated-switch', { layer: activeLayer, fp })
    let urlForThisGen = nextStyle
    let appliedFpForThisGen = fp
    let cancelled = false
    let styleFallbackTimer: number | null = null
    let stallRecoverTimer: number | null = null
    let styleReady = false
    let recoveredToRaster = false

    function markStyleReady() {
      if (cancelled || gen !== styleSwitchGenRef.current || styleReady) return
      hudObsMark(`hud:map:style:${gen}:ready`)
      hudObsMeasure(`hud:map:style:${gen}`, `hud:map:style:${gen}:start`, `hud:map:style:${gen}:ready`)
      styleReady = true
      if (!recoveredToRaster) {
        currentStyleRef.current = urlForThisGen
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
      try {
        mapCtl.resize()
      } catch {
        // ignore resize errors
      }
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
    }

    function onData() {
      if (mapCtl.isStyleLoaded()) markStyleReady()
    }

    function onLoadOnce() {
      if (cancelled || gen !== styleSwitchGenRef.current) return
      markStyleReady()
    }

    function onIdleOnce() {
      if (cancelled || gen !== styleSwitchGenRef.current) return
      markStyleReady()
    }

    function applyEmergencyFallback(reason: string) {
      if (cancelled || recoveredToRaster || gen !== styleSwitchGenRef.current) return
      recoveredToRaster = true
      console.warn(`[MapCanvas] ${reason} — emergency OSM raster only (MapTiler preset "${activeLayer}" failed)`)
      const r = validatedEmergencyFallbackStyle()
      if (!r) {
        console.error('[MapCanvas] Emergency recovery: no validated style')
        setStaticFallbackVisible(true)
        setStatusRef.current('fallback')
        return
      }
      appliedFpForThisGen = mapStyleFingerprint(r)
      tier1Debug('map-layer', 'validated-switch', { layer: activeLayer, fp: appliedFpForThisGen, recovery: true })
      try {
        mapCtl.off('load', onLoadOnce)
        mapCtl.off('idle', onIdleOnce)
      } catch {
        /* ignore */
      }
      try {
        mapCtl.setStyle(r, { diff: false })
        mapCtl.once('load', onLoadOnce)
        mapCtl.once('idle', onIdleOnce)
      } catch {
        setStaticFallbackVisible(true)
        setStatusRef.current('fallback')
      }
    }

    function onStyleError(e: unknown) {
      if (cancelled || gen !== styleSwitchGenRef.current) return
      if (recoveredToRaster) return
      if (!styleFailureWarrantsEmergencyFallback(e)) return
      applyEmergencyFallback('MapTiler / style load error')
    }

    try {
      // Do not flash fallback immediately on style switches.
      // Only show fallback if style change stalls.
      setStatusRef.current('initial')
      mapCtl.on('error', onStyleError)
      styleFallbackTimer = window.setTimeout(() => {
        if (cancelled || gen !== styleSwitchGenRef.current) return
        setStaticFallbackVisible(true)
      }, 1400)

      stallRecoverTimer = window.setTimeout(() => {
        if (cancelled || gen !== styleSwitchGenRef.current) return
        if (styleReady) return
        applyEmergencyFallback('Style load stalled (timeout)')
      }, 12000)

      hudObsMark(`hud:map:style:${gen}:start`)
      mapCtl.setStyle(nextStyle, { diff: false })
      mapCtl.once('load', onLoadOnce)
      mapCtl.once('idle', onIdleOnce)
      mapCtl.on('data', onData)
    } catch (e) {
      console.warn('[MapCanvas] setStyle failed', e)
      try {
        mapCtl.off('error', onStyleError)
      } catch {
        /* ignore */
      }
      try {
        const r = validatedEmergencyFallbackStyle()
        if (!r) {
          console.error('[MapCanvas] setStyle catch: emergency fallback missing')
          setStaticFallbackVisible(true)
          setStatusRef.current('fallback')
        } else {
          recoveredToRaster = true
          appliedFpForThisGen = mapStyleFingerprint(r)
          currentStyleRef.current = null
          mapCtl.setStyle(r, { diff: false })
          mapCtl.once('load', onLoadOnce)
          mapCtl.once('idle', onIdleOnce)
          mapCtl.on('data', onData)
        }
      } catch {
        setStaticFallbackVisible(true)
        setStatusRef.current('fallback')
      }
    }

    return () => {
      cancelled = true
      if (styleFallbackTimer != null) {
        window.clearTimeout(styleFallbackTimer)
      }
      if (stallRecoverTimer != null) {
        window.clearTimeout(stallRecoverTimer)
      }
      try {
        mapCtl.off('load', onLoadOnce)
      } catch {
        /* ignore */
      }
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
      if (!map.isStyleLoaded()) return
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
      console.log('[USER MARKER CREATED]')
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
      {staticFallbackVisible && (
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
      {watchdogNotice && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 16,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 3,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              borderRadius: 10,
              border: '1px solid rgba(125,255,138,0.5)',
              background: 'rgba(8,14,10,0.86)',
              color: '#d8f4db',
              fontSize: 11,
              letterSpacing: '0.05em',
              padding: '8px 10px',
            }}
          >
            MAP INPUT WATCHDOG ACTIVE
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
