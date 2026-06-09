/**
 * Modern ERL lifecycle — activates service in immersive mode only.
 * Reads FIM outputs + movement engine; never writes GPS or rescue state.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useAppContext } from '../../../context/AppContext'
import { useMapContext } from '../../../context/MapContext'
import { useOverlayContext } from '../../../context/OverlayContext'
import { usePanelData } from '../../../context/PanelDataContext'
import { useHudPresentation } from '../../../context/HudPresentationContext'
import { useOperationalSession } from '../../../context/OperationalSessionContext'
import { useMovementEngine } from '../../../hooks/useMovementEngine'
import { useWeatherAtmosphere } from '../../../hooks/useWeatherAtmosphere'
import { useTrailRoute } from '../../../context/TrailRouteContext'
import { getFieldIntent } from '../../../lib/fieldIntentStore'
import { detectOffRoute } from '../../../lib/offRoute'
import { getDeviceEnvironment } from '../../../utils/device'
import { getEnvironmentalRelationshipLayer } from './EnvironmentalRelationshipLayer'
import { isModernERLEnabled } from './modernERLFlags'
import { querySpatialFeatures } from './spatialQueries'
import type { Waypoint } from '../../../types'
import type { ERLTickContext, LatLng } from './types'
import type { Map } from 'maplibre-gl'
import type { WeatherAtmosphere } from '../../../hooks/useWeatherAtmosphere'
import type { MovementSnapshot } from '../../../hooks/useMovementEngine'

const DESKTOP_DEV_SIM_TICK_MS = 2000
const DESKTOP_DEV_WALK_MPS = 1.2
const DESKTOP_DEV_TRAIL_OFFSET_M = 180

function offsetLatLngMeters(from: LatLng, headingDeg: number, meters: number): LatLng {
  const θ = (headingDeg * Math.PI) / 180
  const δ = meters / 6_371_000
  const φ1 = (from.lat * Math.PI) / 180
  const λ1 = (from.lng * Math.PI) / 180
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  )
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    )
  return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI }
}

type ERLContextSnapshot = {
  userLocation: { lat: number; lng: number } | null
  movement: MovementSnapshot
  atmosphere: WeatherAtmosphere
  map: Map | null
  campingEnabled: boolean
  fireEnabled: boolean
  waypoints: Waypoint[]
  deadManActive: boolean
  sessionPhase: string
  routePolyline: LatLng[]
  hasTrailGeometry: boolean
  sosActive: boolean
}

function buildTickContext(erl: ReturnType<typeof getEnvironmentalRelationshipLayer>, snap: ERLContextSnapshot): ERLTickContext | null {
  const simPos = erl.getSimulatedPosition()
  const position: LatLng | null =
    snap.userLocation != null
      ? { lat: snap.userLocation.lat, lng: snap.userLocation.lng }
      : simPos

  const simFim = erl.getSimulatedFimSnapshot()

  const offRoute =
    position != null
      ? detectOffRoute(position.lat, position.lng, snap.routePolyline, {
          hasTrailGeometry: snap.hasTrailGeometry,
        })
      : { distanceFeet: Infinity, thresholdFeet: 2640, offRoute: false, advisory: null }

  const spatial = querySpatialFeatures({
    map: snap.map,
    position,
    waypoints: snap.waypoints,
    campingEnabled: snap.campingEnabled,
    fireEnabled: snap.fireEnabled,
    weatherCentroid: position,
  })

  const gpsUncertain =
    simFim?.gpsUncertain ??
    (snap.movement.state === 'unknown' || snap.movement.lastUpdateMs > 12_000)

  return {
    fim: {
      position,
      headingDeg:
        simFim?.headingDeg ??
        (snap.movement.hasHeading ? snap.movement.headingDeg : null),
      hasHeading: simFim?.hasHeading ?? snap.movement.hasHeading,
      speedMps: simFim?.speedMps ?? snap.movement.speedMs,
      fieldIntent: simFim?.fieldIntent ?? getFieldIntent(),
      gpsUncertain: position != null && simFim?.position ? false : gpsUncertain,
      navigating: simFim?.navigating ?? snap.sessionPhase === 'navigating',
    },
    atmosphere: snap.atmosphere,
    spatialFeatures: spatial.features,
    activeWaypoint: spatial.activeWaypoint,
    routePolyline: snap.routePolyline,
    offRouteDistanceFeet: offRoute.distanceFeet,
    offRouteThresholdFeet: offRoute.thresholdFeet,
    nearestTrailDistanceM: spatial.nearestTrailDistanceM,
    nearestCampDistanceM: spatial.nearestCampDistanceM,
    campingOverlayEnabled: snap.campingEnabled,
    fireOverlayEnabled: snap.fireEnabled,
    sosActive: snap.sosActive,
    tickIntervalSec: 2,
  }
}

export function useModernERLRuntime(): void {
  const { mode } = useHudPresentation()
  const immersive = mode === 'immersive'
  const enabled = isModernERLEnabled(immersive)
  const { userLocation } = usePanelData()
  const movement = useMovementEngine()
  const atmosphere = useWeatherAtmosphere()
  const { map } = useMapContext()
  const { toggles } = useOverlayContext()
  const { state: appState } = useAppContext()
  const { session } = useOperationalSession()
  const trailRoute = useTrailRoute()
  const sosActiveRef = useRef(false)
  const ctxSnapRef = useRef<ERLContextSnapshot>({
    userLocation: null,
    movement,
    atmosphere,
    map: null,
    campingEnabled: toggles.camping,
    fireEnabled: toggles.fire_firms,
    waypoints: appState.waypoints,
    deadManActive: appState.deadManActive,
    sessionPhase: session.phase,
    routePolyline: [],
    hasTrailGeometry: false,
    sosActive: false,
  })

  useEffect(() => {
    const onArm = () => {
      sosActiveRef.current = true
    }
    const onDisarm = () => {
      sosActiveRef.current = false
    }
    window.addEventListener('hud:sos-arm', onArm)
    window.addEventListener('hud:sos-disarm', onDisarm)
    return () => {
      window.removeEventListener('hud:sos-arm', onArm)
      window.removeEventListener('hud:sos-disarm', onDisarm)
    }
  }, [])

  const routePolyline = useMemo((): LatLng[] => {
    if (trailRoute.coordinates.length >= 2) {
      return trailRoute.coordinates.map(([lng, lat]) => ({ lat, lng }))
    }
    return appState.waypoints
      .filter((w) => w.status !== 'archived')
      .map((w) => ({ lat: w.lat, lng: w.lng }))
  }, [trailRoute.coordinates, appState.waypoints])

  // Keep latest FIM inputs in a ref — tick reads this without tearing down ERL.
  useEffect(() => {
    ctxSnapRef.current = {
      userLocation,
      movement,
      atmosphere,
      map,
      campingEnabled: toggles.camping,
      fireEnabled: toggles.fire_firms,
      waypoints: appState.waypoints,
      deadManActive: appState.deadManActive,
      sessionPhase: session.phase,
      routePolyline,
      hasTrailGeometry: trailRoute.coordinates.length >= 2,
      sosActive: sosActiveRef.current || appState.deadManActive,
    }
  }, [
    userLocation,
    movement,
    atmosphere,
    map,
    toggles.camping,
    toggles.fire_firms,
    appState.waypoints,
    appState.deadManActive,
    session.phase,
    routePolyline,
    trailRoute.coordinates.length,
  ])

  // Refresh context provider when inputs change — no deactivate (preserves smoothed state).
  useEffect(() => {
    if (!enabled) return
    const erl = getEnvironmentalRelationshipLayer()
    erl.setContextProvider(() => buildTickContext(erl, ctxSnapRef.current))
  }, [
    enabled,
    userLocation,
    movement,
    atmosphere,
    map,
    toggles.camping,
    toggles.fire_firms,
    appState.waypoints,
    appState.deadManActive,
    session.phase,
    routePolyline,
    trailRoute.coordinates.length,
  ])

  // Lifecycle + desktop dev sim — only when immersive ERL enabled toggles.
  useEffect(() => {
    const erl = getEnvironmentalRelationshipLayer()

    if (!enabled) {
      erl.deactivate()
      return
    }

    erl.setContextProvider(() => buildTickContext(erl, ctxSnapRef.current))
    erl.activate()

    let desktopSimHeading = 0
    let desktopSimInterval: number | null = null

    if (import.meta.env.DEV && !getDeviceEnvironment().isMobileEnvironment) {
      const injectDesktopDevSim = () => {
        const center = ctxSnapRef.current.map?.getCenter()
        if (!center) return
        const position = { lat: center.lat, lng: center.lng }
        const trailPos = offsetLatLngMeters(position, desktopSimHeading, DESKTOP_DEV_TRAIL_OFFSET_M)
        erl.injectSimulatedMovement(
          {
            position,
            headingDeg: desktopSimHeading,
            hasHeading: true,
            speedMps: DESKTOP_DEV_WALK_MPS,
            gpsUncertain: false,
            navigating: true,
            fieldIntent: 'NAVIGATION_ACTIVE',
          },
          {
            nearestTrailDistanceM: DESKTOP_DEV_TRAIL_OFFSET_M,
            spatialFeatures: [{ id: 'trail:dev-desktop', kind: 'trail', position: trailPos }],
            approachTarget: trailPos,
          },
        )
      }

      injectDesktopDevSim()
      desktopSimInterval = window.setInterval(() => {
        desktopSimHeading = (desktopSimHeading + 20) % 360
        injectDesktopDevSim()
      }, DESKTOP_DEV_SIM_TICK_MS)
    }

    return () => {
      if (desktopSimInterval != null) window.clearInterval(desktopSimInterval)
      erl.deactivate()
    }
  }, [enabled])
}
