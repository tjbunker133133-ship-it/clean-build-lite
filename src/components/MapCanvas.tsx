import { useEffect, useRef } from 'react'
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
  const { setMap } = useMapContext()
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

    container.replaceChildren()

    const initialStyle =
      MAP_STYLES[activeLayerRef.current] ?? FALLBACK_MAP_STYLE

    const map = new maplibregl.Map({
      container,
      style: initialStyle,
      center: [-105.7821, 39.5501],
      zoom: 10,
      attributionControl: { compact: true },
      renderWorldCopies: false,
    })

    mapRef.current = map
    skipLayerSyncRef.current = true

    const resize = () => {
      try {
        map.resize()
      } catch {
        /* ignore */
      }
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

    const onLoad = () => {
      setMap(map)
      requestAnimationFrame(() => {
        resize()
        requestAnimationFrame(resize)
      })
    }

    const onError = (e: unknown) => {
      console.warn('[MapCanvas] tile/style error — falling back to OSM', e)
      try {
        map.setStyle(FALLBACK_MAP_STYLE)
      } catch {
        /* ignore */
      }
    }

    map.once('load', onLoad)
    map.on('error', onError)
    map.on('click', (e) => {
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

    return () => {
      map.off('error', onError)
      vv?.removeEventListener('resize', onVisualViewportChange)
      vv?.removeEventListener('scroll', onVisualViewportChange)
      window.removeEventListener('orientationchange', onVisualViewportChange)
      roRef.current?.disconnect()
      roRef.current = null
      setMap(null)
      mapRef.current = null
      map.remove()
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
      ref={containerRef}
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
    />
  )
}
