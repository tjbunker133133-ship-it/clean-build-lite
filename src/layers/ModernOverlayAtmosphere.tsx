/**
 * ModernOverlayAtmosphere — grounded environmental visual language.
 * Trails emerge on approach; camps feel warm; fire distorts atmosphere locally.
 */

import { useEffect, useRef } from 'react'
import { useMapContext } from '../context/MapContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useOverlayContext } from '../context/OverlayContext'
import { ENVIRONMENTAL_OVERLAY_IDS } from '../lib/environmentalOverlays/catalog'
import { envLayerId } from '../lib/environmentalOverlays/mapOverlayRuntime'
import { getERLState } from '../hud/modernMode/erl/erlStore'
import { ERL_PHASE_CALIBRATION } from '../hud/modernMode/erl/erlCalibration'

const TRANSITION = { duration: 2200, delay: 0 }

/** Fire — atmospheric haze, not polygon emphasis */
const IMMERSIVE_RASTER_PAINT: Record<string, Record<string, number>> = {
  fire_firms: {
    'raster-opacity': 0.22,
    'raster-contrast': -0.52,
    'raster-saturation': -0.62,
    'raster-brightness-min': 0.18,
    'raster-brightness-max': 0.58,
  },
  relief_usgs: {
    'raster-opacity': 0.42,
    'raster-contrast': -0.18,
    'raster-saturation': -0.22,
  },
  forest_usfs: {
    'raster-opacity': 0.28,
    'raster-contrast': -0.22,
    'raster-saturation': -0.28,
  },
  public_lands: {
    'raster-opacity': 0.24,
    'raster-contrast': -0.24,
    'raster-saturation': -0.3,
  },
}

/** Earthy discovered paths — zoom proximity fade, soft blur */
const BIKE_FLOW_PAINT: Record<string, unknown> = {
  'line-color': '#8a9a7a',
  'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 12, 2, 15, 3.2, 17, 4.5],
  'line-blur': 6,
  'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.03, 11, 0.14, 14, 0.28, 17, 0.38],
}

const TRAIL_FLOW_PAINT: Record<string, unknown> = {
  'line-color': '#6a7d62',
  'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 12, 1.8, 15, 3],
  'line-blur': 5,
  'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.04, 12, 0.18, 15, 0.32],
}

const RAIL_FLOW_PAINT: Record<string, unknown> = {
  'line-color': '#7a7068',
  'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 13, 1.6],
  'line-blur': 4,
  'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.04, 13, 0.18],
}

const MINE_ANCHOR_PAINT: Record<string, unknown> = {
  'circle-color': '#a87858',
  'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5],
  'circle-blur': 1.2,
  'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.12, 14, 0.28],
  'circle-stroke-width': 0,
}

function trailEmergenceBoost(): number {
  return 1 + getERLState().trailApproach * ERL_PHASE_CALIBRATION.trailEmergence
}

function scaleOpacityPaint(
  paint: Record<string, unknown>,
  boost: number,
): Record<string, unknown> {
  const next = { ...paint }
  for (const [key, value] of Object.entries(next)) {
    if (!key.includes('opacity') || !Array.isArray(value)) continue
    const scaled = [...value]
    const last = scaled[scaled.length - 1]
    if (typeof last === 'number') {
      scaled[scaled.length - 1] = Math.min(0.55, last * boost)
    }
    next[key] = scaled
  }
  return next
}

function applyPaint(map: maplibregl.Map, layerId: string, paint: Record<string, unknown>) {
  if (!map.getLayer(layerId)) return
  for (const [key, value] of Object.entries(paint)) {
    try {
      map.setPaintProperty(layerId, key, value)
      if (key.includes('opacity') || key.includes('blur') || key.includes('width')) {
        map.setPaintProperty(layerId, key + '-transition', TRANSITION)
      }
    } catch {
      // layer type may not support property
    }
  }
}

function applyCampgroundField(map: maplibregl.Map, base: string, pulse: number): void {
  const warmOpacity = 0.05 + pulse * 0.06
  const glowOpacity = 0.14 + pulse * 0.1
  applyPaint(map, `${base}-points`, {
    'circle-color': '#c8a070',
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 14, 22, 17, 28],
    'circle-blur': 1.8,
    'circle-opacity': glowOpacity * 0.28,
    'circle-stroke-width': 0,
  })
  applyPaint(map, `${base}-polygons-fill`, {
    'fill-color': '#a88858',
    'fill-opacity': warmOpacity,
  })
  applyPaint(map, `${base}-polygons-outline`, {
    'line-color': '#b89868',
    'line-width': 0.6,
    'line-blur': 5,
    'line-opacity': warmOpacity * 1.4,
  })
}

export function ModernOverlayAtmosphere() {
  const { map } = useMapContext()
  const { mode } = useHudPresentation()
  const { toggles } = useOverlayContext()
  const isImmersive = mode === 'immersive'
  const pulseRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastCampPulseRef = useRef(0)

  useEffect(() => {
    if (!map || !isImmersive) return

    const soften = () => {
      if (toggles.fire_firms) {
        document.documentElement.setAttribute('data-field-fire', 'active')
      } else {
        document.documentElement.removeAttribute('data-field-fire')
      }
      if (toggles.bike_paths) {
        document.documentElement.setAttribute('data-field-bike', 'active')
      } else {
        document.documentElement.removeAttribute('data-field-bike')
      }
      if (toggles.camping) {
        document.documentElement.setAttribute('data-field-camp', 'active')
      } else {
        document.documentElement.removeAttribute('data-field-camp')
      }

      for (const id of ENVIRONMENTAL_OVERLAY_IDS) {
        if (!toggles[id]) continue

        const rasterPaint = IMMERSIVE_RASTER_PAINT[id]
        if (rasterPaint) {
          applyPaint(map, envLayerId(id), rasterPaint)
        }

        const trailBoost = trailEmergenceBoost()
        if (id === 'bike_paths') {
          applyPaint(map, envLayerId(id), scaleOpacityPaint(BIKE_FLOW_PAINT, trailBoost))
        }
        if (id === 'hiking_trails') {
          applyPaint(map, envLayerId(id), scaleOpacityPaint(TRAIL_FLOW_PAINT, trailBoost))
        }
        if (id === 'abandoned_rail') {
          applyPaint(map, envLayerId(id), scaleOpacityPaint(RAIL_FLOW_PAINT, trailBoost))
        }
        if (id === 'mines') {
          applyPaint(map, envLayerId(id), MINE_ANCHOR_PAINT)
        }

        if (id === 'camping') {
          applyCampgroundField(map, envLayerId(id), pulseRef.current)
        }
      }
    }

    soften()
    map.on('styledata', soften)
    map.on('sourcedata', soften)

    let lastTrailBoost = 1
    const tick = (ts: number) => {
      pulseRef.current = (Math.sin(ts / 5200) + 1) * 0.5
      const trailBoost = trailEmergenceBoost()
      if (
        (toggles.bike_paths || toggles.hiking_trails || toggles.abandoned_rail) &&
        Math.abs(trailBoost - lastTrailBoost) > 0.02
      ) {
        lastTrailBoost = trailBoost
        soften()
      }
      if (
        toggles.camping &&
        map.getLayer(`${envLayerId('camping')}-points`) &&
        Math.abs(pulseRef.current - lastCampPulseRef.current) > 0.08
      ) {
        lastCampPulseRef.current = pulseRef.current
        applyCampgroundField(map, envLayerId('camping'), pulseRef.current)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      map.off('styledata', soften)
      map.off('sourcedata', soften)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      document.documentElement.removeAttribute('data-field-fire')
      document.documentElement.removeAttribute('data-field-bike')
      document.documentElement.removeAttribute('data-field-camp')
    }
  }, [map, isImmersive, toggles])

  return null
}

export default ModernOverlayAtmosphere
