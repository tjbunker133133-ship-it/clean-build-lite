import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { FALLBACK_MAP_STYLE, MAP_STYLES } from '../lib/mapStyles'
import { mapScreenFilter } from '../lib/cockpitScreenHue'

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
  const { setMap, setStatus } = useMapContext()
  const {
    state,
    addWaypoint,
    setPendingType,
    setNextWaypointLabel,
  } = useAppContext()
  const { prefs } = useCockpit()
  const {
    activeLayer,
    pendingWaypointType,
    waypoints,
    nextWaypointLabel,
    keepWaypointToolArmed,
    clearLabelAfterDrop,
  } = state

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

  // Create map once; swap style when base layer changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let hardResetting = false
    let readyOnce = false
    let fallbackLocked = false
    let map: maplibregl.Map | null = null
    let lastTouchAt = 0
    let touchMoved = false
    let multiTouchActive = false
    let touchStart: { x: number; y: number } | null = null
    let touchLast: { x: number; y: number } | null = null
    const isAppleWebKit =
      typeof navigator !== 'undefined' &&
      /AppleWebKit/i.test(navigator.userAgent || '') &&
      /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent || '')

    // Render blank maps are usually tied to WebGL/context or sizing churn.
    // Strategy: show static OSM until MapLibre reaches `idle` with tiles drawn.
    setStaticFallbackVisible(true)
    setStatus('initial')

    const STATIC_CENTER = { lng: -105.7821, lat: 39.5501 }

    let lastRw = 0
    let lastRh = 0
    const resize = () => {
      try {
        if (!map) return
        const r = container.getBoundingClientRect()
        const rw = Math.round(r.width)
        const rh = Math.round(r.height)
        if (rw < 2 || rh < 2) return
        if (rw === lastRw && rh === lastRh) return
        lastRw = rw
        lastRh = rh
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

      const initialStyle =
        MAP_STYLES[activeLayerRef.current] ?? FALLBACK_MAP_STYLE

      map = new maplibregl.Map({
        container,
        style: initialStyle,
        center: [STATIC_CENTER.lng, STATIC_CENTER.lat],
        zoom: 10,
        attributionControl: { compact: true },
        renderWorldCopies: false,
      })

      mapRef.current = map
      skipLayerSyncRef.current = true

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
          map?.setStyle(FALLBACK_MAP_STYLE)
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
        console.warn('[MapCanvas] startup map error — falling back to OSM', e)
        fallbackLocked = true
        setStaticFallbackVisible(true)
        setStatus('fallback')
        try {
          map?.setStyle(FALLBACK_MAP_STYLE)
        } catch {
          /* ignore */
        }
      }

      const onLoad = () => {
        startupResetAttemptsRef.current = 0
        setMap(map)
        scheduleResize()
        scheduleResize()
        // Safari fallback: do not wait exclusively for `idle`.
        window.setTimeout(() => {
          if (cancelled) return
          if (map && map.isStyleLoaded()) {
            markReady()
          }
        }, isAppleWebKit ? 220 : 320)
      }

      map.once('load', onLoad)
      map.on('error', onError)
      map.on('idle', onIdle)
      map.on('data', onData)

      // Some browsers (notably mobile) can hard-break WebGL; force recovery.
      ;(map as any).on?.('webglcontextlost', () => {
        setStaticFallbackVisible(true)
        setStatus('fallback')
        hardReset()
      })

      const placeWaypoint = (
        e: { lngLat?: { lng: number; lat: number }; points?: Array<{ x: number; y: number }> } | null,
        source: 'click' | 'touch',
      ) => {
        if (!map) return
        let lngLat = e?.lngLat
        if (!lngLat) {
          const p = e?.points?.[0] ?? touchLast ?? touchStart
          if (p) {
            const unproj = map.unproject([p.x, p.y])
            lngLat = { lng: unproj.lng, lat: unproj.lat }
          }
        }
        if (!lngLat) return
        const now = Date.now()
        // Stability guard: prevent accidental double-drops from rapid taps/clicks.
        if (now - lastDropAtRef.current < 220) return
        lastDropAtRef.current = now

        // Ignore placement while camera is moving, except deliberate touch taps.
        if (source !== 'touch' && map.isMoving()) return
        // Allow iOS/mobile waypoint drops even when the panel is docked.
        // Users may keep the tool rail docked while actively placing pins.
        const nextIdx = waypointCountRef.current + 1
        const type = pendingTypeRef.current
        if (type === 'default') return
        const manualLabel = nextWaypointLabelRef.current.trim().slice(0, 64)
        const autoBase =
          type === 'finish'
            ? 'FINISH'
            : type === 'rest'
              ? 'REST'
              : type.toUpperCase()
        try {
          addWaypoint({
            id: `wp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            lng: lngLat.lng,
            lat: lngLat.lat,
            label: manualLabel || `${autoBase}-${nextIdx}`,
            type,
            createdAt: Date.now(),
          })
        } catch (err) {
          console.error('[MapCanvas] waypoint add failed', err)
          return
        }
        if (!keepArmedRef.current) setPendingType('default')
        if (clearLabelAfterDropRef.current && manualLabel) setNextWaypointLabel('')
      }

      map.on('click', (e: any) => {
        // iOS emits synthetic click shortly after touchend; suppress duplicate drops.
        if (Date.now() - lastTouchAt < 550) return
        placeWaypoint(e, 'click')
      })
      map.on('touchstart', (e: any) => {
        const pointCount = Array.isArray(e?.points) ? e.points.length : 0
        multiTouchActive = pointCount > 1
        const p = e?.points?.[0]
        touchStart = p ? { x: p.x, y: p.y } : null
        touchLast = touchStart
        touchMoved = false
      })
      map.on('touchmove', (e: any) => {
        const p = e?.points?.[0]
        if (!p || !touchStart) return
        touchLast = { x: p.x, y: p.y }
        const moveTolerance = isAppleWebKit ? 18 : 10
        if (Math.hypot(p.x - touchStart.x, p.y - touchStart.y) > moveTolerance) {
          touchMoved = true
        }
      })
      map.on('touchend', (e: any) => {
        lastTouchAt = Date.now()
        if (multiTouchActive) {
          const remaining = Array.isArray(e?.points) ? e.points.length : 0
          if (remaining <= 1) multiTouchActive = false
          return
        }
        if (touchMoved) return
        placeWaypoint(e, 'touch')
      })
    }

    roRef.current = new ResizeObserver(() => {
      scheduleResize()
    })
    roRef.current.observe(container)

    const vv = window.visualViewport
    const onVisualViewportChange = () => {
      scheduleResize()
    }
    vv?.addEventListener('resize', onVisualViewportChange)
    vv?.addEventListener('scroll', onVisualViewportChange)
    window.addEventListener('orientationchange', onVisualViewportChange)

    initMap()

    return () => {
      vv?.removeEventListener('resize', onVisualViewportChange)
      vv?.removeEventListener('scroll', onVisualViewportChange)
      window.removeEventListener('orientationchange', onVisualViewportChange)
      roRef.current?.disconnect()
      roRef.current = null
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
      cancelled = true
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
  }, [setMap, addWaypoint, setPendingType, setNextWaypointLabel])

  // React to layer preset changes (streets / topo / outdoor / satellite)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (skipLayerSyncRef.current) {
      skipLayerSyncRef.current = false
      return
    }

    const style = MAP_STYLES[activeLayer] ?? FALLBACK_MAP_STYLE
    let cancelled = false
    let styleFallbackTimer: number | null = null
    let styleReady = false

    const markStyleReady = () => {
      if (cancelled || styleReady) return
      styleReady = true
      if (styleFallbackTimer != null) {
        window.clearTimeout(styleFallbackTimer)
        styleFallbackTimer = null
      }
      setStaticFallbackVisible(false)
      setStatus('ready')
      try {
        map.resize()
      } catch {
        // ignore resize errors
      }
      try {
        map.off('data', onData)
      } catch {
        // ignore
      }
    }

    const onData = () => {
      if (!map) return
      if (map.isStyleLoaded()) markStyleReady()
    }

    try {
      // Do not flash fallback immediately on style switches.
      // Only show fallback if style change stalls.
      setStatus('initial')
      styleFallbackTimer = window.setTimeout(() => {
        if (cancelled) return
        setStaticFallbackVisible(true)
      }, 1400)
      map.setStyle(style)
      map.once('load', () => {
        if (cancelled) return
        markStyleReady()
      })
      map.once('idle', () => {
        markStyleReady()
      })
      map.on('data', onData)
    } catch (e) {
      console.warn('[MapCanvas] setStyle failed', e)
      setStaticFallbackVisible(true)
      setStatus('fallback')
    }

    return () => {
      cancelled = true
      if (styleFallbackTimer != null) {
        window.clearTimeout(styleFallbackTimer)
      }
      try {
        map.off('data', onData)
      } catch {
        // ignore
      }
    }
  }, [activeLayer, setStatus])

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
        ...mapScreenFilter(prefs.screen_hue, prefs),
        transition: 'filter 180ms var(--cockpit-ease, ease)',
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
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
        }}
      />
    </div>
  )
}
