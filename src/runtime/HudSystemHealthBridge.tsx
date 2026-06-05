import { useEffect, useMemo, useRef } from 'react'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import { useOverlayContext } from '../context/OverlayContext'
import { useTrailRoute } from '../context/TrailRouteContext'
import { ENVIRONMENTAL_OVERLAY_CATALOG } from '../lib/environmentalOverlays/catalog'
import { envLayerId } from '../lib/environmentalOverlays/mapOverlayRuntime'
import {
  __probeStyleForTrailLayersForTests,
  MIN_SNAP_ZOOM,
  OVERLAY_SNAP_LAYER_IDS,
} from '../lib/snapToTrail'
import { getDeviceProfile } from './deviceProfile'
import { recomputeHudSystemHealth, reportRouteLayerObservation } from './hudSystemHealth'
import { useDeviceHeading } from '../hooks/useDeviceHeading'

/**
 * Single integration point — derives health from existing hooks/contexts.
 * No UI, no duplicate sensor listeners, no polling.
 */
export default function HudSystemHealthBridge() {
  const { heading, status } = useDeviceHeading()
  const { state } = useAppContext()
  const { waypoints, snapToTrailEnabled, trailSnapAssistCapable } = state
  const trailRoute = useTrailRoute()
  const { map } = useMapContext()
  const { toggles, status: overlayStatus } = useOverlayContext()
  const { panels } = useCockpit()
  const profile = getDeviceProfile()

  const visibleWaypointCount = useMemo(
    () => waypoints.filter((w) => w.status !== 'archived').length,
    [waypoints],
  )

  const trailLegTrailModeCount = useMemo(
    () => trailRoute.legs.filter((leg) => leg.mode === 'trail').length,
    [trailRoute.legs],
  )

  const overlayLayers = useMemo(() => {
    return ENVIRONMENTAL_OVERLAY_CATALOG.map((def) => {
      const layerId = envLayerId(def.id)
      let layerOnMap = false
      try {
        layerOnMap = Boolean(map?.getLayer(layerId))
      } catch {
        layerOnMap = false
      }
      const st = overlayStatus[def.id]
      return {
        id: def.id,
        toggle: toggles[def.id],
        loading: st?.loading ?? false,
        error: st?.error ?? null,
        layerOnMap,
        stale: st?.stale ?? false,
      }
    })
  }, [map, toggles, overlayStatus])

  const mapSignals = useMemo(() => {
    if (!map) {
      return {
        mapPresent: false,
        mapZoom: null as number | null,
        styleHasVectorTrails: false,
        overlaySnapLayersActive: false,
      }
    }
    let mapZoom: number | null = null
    try {
      mapZoom = map.getZoom()
    } catch {
      mapZoom = null
    }
    let styleHasVectorTrails = false
    try {
      const probe = __probeStyleForTrailLayersForTests(map)
      styleHasVectorTrails =
        probe.matchedTransportationSourceLayers > 0 || probe.matchedTrailIdLayers > 0
    } catch {
      styleHasVectorTrails = false
    }
    let overlaySnapLayersActive = false
    for (const id of OVERLAY_SNAP_LAYER_IDS) {
      try {
        if (map.getLayer(id)) {
          overlaySnapLayersActive = true
          break
        }
      } catch {
        /* ignore */
      }
    }
    return { mapPresent: true, mapZoom, styleHasVectorTrails, overlaySnapLayersActive }
  }, [map])

  useEffect(() => {
    reportRouteLayerObservation({ waypointCount: visibleWaypointCount })
  }, [visibleWaypointCount])

  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const panelLayoutSig = useMemo(() => {
    return Object.entries(panels)
      .filter(([, p]) => p?.docked)
      .map(([id, p]) => `${id}:${p!.x}:${p!.y}:${p!.w}:${p!.h}`)
      .sort()
      .join('|')
  }, [panels])

  useEffect(() => {
    const base = {
      heading,
      compassStatus: status,
      snapToggleCapable: trailSnapAssistCapable,
      snapToggleEnabled: snapToTrailEnabled,
      trailLegCount: trailRoute.legs.length,
      trailLegTrailModeCount,
      overlayLayers,
      vw: profile.width,
      vh: profile.height,
      isMobile: profile.interactionMode === 'mobile',
      mapZoom: mapSignals.mapZoom,
      minSnapZoom: MIN_SNAP_ZOOM,
      styleHasVectorTrails: mapSignals.styleHasVectorTrails,
      overlaySnapLayersActive: mapSignals.overlaySnapLayersActive,
      mapPresent: mapSignals.mapPresent,
    }
    recomputeHudSystemHealth({ ...base, panels: panelsRef.current })
    const timer = window.setTimeout(() => {
      recomputeHudSystemHealth({ ...base, panels: panelsRef.current })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [
    heading,
    status,
    trailSnapAssistCapable,
    snapToTrailEnabled,
    trailRoute.legs.length,
    trailLegTrailModeCount,
    overlayLayers,
    panelLayoutSig,
    profile.width,
    profile.height,
    profile.interactionMode,
    mapSignals,
  ])

  return null
}
