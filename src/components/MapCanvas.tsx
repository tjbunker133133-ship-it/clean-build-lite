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
  const skipLayerSyncRef = useRef(true)
  const [staticFallbackVisible, setStaticFallbackVisible] = useState(true)
  const { setMap, setStatus } = useMapContext()
  const {
    state,
    addWaypoint,
    setPendingType,
    setNextWaypointLabel,
  } = useAppContext()
  const { panels, prefs } = useCockpit()
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
  const waypointDockedRef = useRef(!!panels.waypoints?.docked)
  waypointDockedRef.current = !!panels.waypoints?.docked

  // Create map once; swap style when base layer changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let hardResetting = false
    let renderedOnce = false
    let map: maplibregl.Map | null = null

    // Render blank maps are usually tied to WebGL/context or sizing churn.
    // Strategy: show a static OSM image until we get a real `render` from MapLibre.
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
      renderedOnce = false
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
        // If we never got a render, keep the static fallback visible and
        // try OSM raster fallback to improve chances of recovery.
        setStaticFallbackVisible(true)
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

      const onRender = () => {
        if (cancelled || !map || renderedOnce) return
        renderedOnce = true
        clearRenderTimer()
        setStaticFallbackVisible(false)
        setStatus('ready')
        try {
          // Ensure canvas dimensions are correct after first actual draw.
          requestAnimationFrame(resize)
        } catch {
          /* ignore */
        }
        // Only need the first render.
        try {
          map.off('render', onRender)
        } catch {
          /* ignore */
        }
      }

      const onError = (e: unknown) => {
        console.warn('[MapCanvas] tile/style error — falling back to OSM', e)
        setStaticFallbackVisible(true)
        setStatus('fallback')
        try {
          map?.setStyle(FALLBACK_MAP_STYLE)
        } catch {
          /* ignore */
        }
      }

      const onLoad = () => {
        setMap(map)
        requestAnimationFrame(() => {
          resize()
          requestAnimationFrame(resize)
        })
      }

      map.once('load', onLoad)
      map.on('error', onError)
      map.on('render', onRender)

      // Some browsers (notably mobile) can hard-break WebGL; force recovery.
      ;(map as any).on?.('webglcontextlost', () => {
        setStaticFallbackVisible(true)
        setStatus('fallback')
        hardReset()
      })

      map.on('click', (e) => {
        if (!map) return
        const now = Date.now()
        // Stability guard: prevent accidental double-drops from rapid taps/clicks.
        if (now - lastDropAtRef.current < 220) return
        lastDropAtRef.current = now

        // Ignore placement while map camera is moving (drag/pan/kinetic movement).
        if (map.isMoving()) return
        if (waypointDockedRef.current) return
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
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
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
      })
    }

    roRef.current = new ResizeObserver(() => {
      requestAnimationFrame(resize)
    })
    roRef.current.observe(container)

    const vv = window.visualViewport
    const onVisualViewportChange = () => {
      requestAnimationFrame(resize)
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

    try {
      map.setStyle(style)
      map.once('load', () => {
        map.resize()
      })
    } catch (e) {
      console.warn('[MapCanvas] setStyle failed', e)
    }
  }, [activeLayer])

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
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />
      <img
        alt="OpenStreetMap fallback"
        src="https://staticmap.openstreetmap.de/staticmap.php?center=39.5501,-105.7821&zoom=10&size=1024x640&markers=39.5501,-105.7821,red-pushpin"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: staticFallbackVisible ? 'block' : 'none',
          border: 0,
          background: '#0b0b10',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
