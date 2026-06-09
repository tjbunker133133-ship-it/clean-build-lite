/**
 * RouteAtmosphereLayer — Modern Layer Only
 *
 * Adds a subtle glow layer below the existing tactical route line.
 * References the existing 'tactical-route-source' (already owned by RouteLayer)
 * using a secondary MapLibre layer — no new data source needed.
 *
 * Visual behavior:
 *   - Stationary / no route: opacity 0 (invisible)
 *   - Moving slow:           soft glow, opacity 0.25
 *   - Moving fast:           reduced glow (map clarity priority), opacity 0.18
 *   - Storm weather:         glow shifts toward blue-white, intensity +0.08
 *
 * Performance contract:
 *   - No data source — references existing route source
 *   - All opacity changes via MapLibre paint transitions (GPU)
 *   - Only inserted when route source exists
 *   - Self-removes when route is empty
 *   - Respects reduced-motion (static opacity, no pulse)
 */

import { useEffect, useRef } from 'react'
import { useMapContext } from '../context/MapContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useMovementEngine } from '../hooks/useMovementEngine'
import { useOperationalPerception } from '../hooks/useOperationalPerception'
import { useWeatherAtmosphere } from '../hooks/useWeatherAtmosphere'
import { useReducedMotion } from '../hooks/useReducedMotion'

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUTE_SOURCE_ID = 'tactical-route-source'
const GLOW_LAYER_ID = 'hud-modern-route-glow'

const TRANSITION = { duration: 1800, delay: 0 }

// ─── Target opacities ─────────────────────────────────────────────────────────

function targetOpacity(
  movementState: string,
  hasActiveWeather: boolean,
  tone: string,
): number {
  let base = 0
  switch (movementState) {
    case 'moving_slow': base = 0.52; break
    case 'moving_fast': base = 0.38; break
    case 'stationary':  base = 0.28; break
    default:            base = 0.12; break
  }
  // Boost slightly during active weather (route stands out more)
  if (hasActiveWeather && tone !== 'fog') {
    base = Math.min(base + 0.08, 0.4)
  }
  return base
}

function glowColor(tone: string): string {
  switch (tone) {
    case 'storm':   return '#80a8ff' // blue-white in storms
    case 'rain':
    case 'showers': return '#60c8e8' // cool aqua in rain
    case 'snow':    return '#c0d8ff' // icy in snow
    default:        return '#00ffb4' // standard teal
  }
}

// ─── Layer management ─────────────────────────────────────────────────────────

function ensureGlowLayer(map: maplibregl.Map, color: string) {
  if (map.getLayer(GLOW_LAYER_ID)) return
  if (!map.getSource(ROUTE_SOURCE_ID)) return

  // Find route layer to insert below it
  const style = map.getStyle()
  const routeLayer = style?.layers?.find((l) => l.id === 'tactical-route-layer')

  map.addLayer(
    {
      id: GLOW_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 14, 18, 22],
        'line-blur': 10,
        'line-opacity': 0,
        'line-opacity-transition': TRANSITION,
      },
    },
    routeLayer?.id ?? undefined,
  )
}

function removeGlowLayer(map: maplibregl.Map) {
  try {
    if (map.getLayer(GLOW_LAYER_ID)) map.removeLayer(GLOW_LAYER_ID)
  } catch {
    // ignore
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RouteAtmosphereLayer() {
  const { map } = useMapContext()
  const { mode } = useHudPresentation()
  const movement = useMovementEngine()
  const perception = useOperationalPerception()
  const atmosphere = useWeatherAtmosphere()
  const reducedMotion = useReducedMotion()

  const isImmersive = mode === 'immersive'
  const layerReadyRef = useRef(false)

  // ── Initialize layer when route source appears ─────────────────────────────
  useEffect(() => {
    if (!map || !isImmersive) return

    const tryInit = () => {
      if (map.getSource(ROUTE_SOURCE_ID) && !map.getLayer(GLOW_LAYER_ID)) {
        const color = glowColor(atmosphere.tone)
        ensureGlowLayer(map, color)
        layerReadyRef.current = true
      }
    }

    const onStyleData = () => {
      layerReadyRef.current = false
      tryInit()
    }

    // Check immediately and on every style/source change
    if (map.isStyleLoaded()) tryInit()
    map.on('sourcedata', tryInit)
    map.on('styledata', onStyleData)

    return () => {
      map.off('sourcedata', tryInit)
      map.off('styledata', onStyleData)
    }
  }, [map, isImmersive, atmosphere.tone])

  // ── Update opacity based on movement + weather ─────────────────────────────
  useEffect(() => {
    if (!map || !isImmersive) return
    if (!map.getLayer(GLOW_LAYER_ID)) return

    const baseOpacity = targetOpacity(
      movement.state,
      atmosphere.hasActiveWeather,
      atmosphere.tone,
    )
    const accent = perception.tone.pathGlowAccent
    const rawOpacity = baseOpacity * accent
    const opacity = reducedMotion ? Math.min(rawOpacity, 0.14) : Math.min(rawOpacity, 0.48)

    try {
      map.setPaintProperty(GLOW_LAYER_ID, 'line-opacity', opacity)
    } catch {
      // ignore
    }
  }, [
    map,
    isImmersive,
    movement.state,
    atmosphere.hasActiveWeather,
    atmosphere.tone,
    reducedMotion,
    perception.tone.pathGlowAccent,
    perception.mode,
  ])

  // ── Update glow color on atmosphere change ─────────────────────────────────
  useEffect(() => {
    if (!map || !isImmersive) return
    if (!map.getLayer(GLOW_LAYER_ID)) return

    const color = glowColor(atmosphere.tone)
    try {
      map.setPaintProperty(GLOW_LAYER_ID, 'line-color', color)
    } catch {
      // ignore
    }
  }, [map, isImmersive, atmosphere.tone])

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (map) removeGlowLayer(map)
    }
  }, [map])

  return null
}

export default RouteAtmosphereLayer
