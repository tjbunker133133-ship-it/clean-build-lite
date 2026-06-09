/**
 * Balanced Panels Hook — render shell only.
 * Route / mission / tool truth from OSG selectors; waypoint CRUD via AppContext → OSG.
 */

import { useCallback, useState, useEffect, useRef, useSyncExternalStore, useMemo } from 'react'
import { useAppContext } from '../../../context/AppContext'
import { useOperationalSession } from '../../../context/OperationalSessionContext'
import { useOverlayContext } from '../../../context/OverlayContext'
import type { Waypoint, WaypointType, LayerType } from '../../../types'
import { selectOsgMission, selectOsgRoute } from '../../../lib/osgSelectors'
import { subscribeOperationalGraph } from '../../../lib/operationalStateGraph'
import { armBalancedWaypointDrop } from '../../../lib/balancedToolBridge'
import {
  setRouteName as osgSetRouteName,
} from '../../../lib/mapInteractionController'
import { getRadarEnabled, setRadarEnabled, setRadarOpacity } from '../../../lib/modernRadarStore'

const BASE_LAYER_MAP: Record<string, LayerType> = {
  streets: 'streets',
  topo: 'topo',
  outdoor: 'outdoor',
  satellite: 'satellite',
}

type BalancedPanelId = 'route' | 'waypoints' | 'overlays' | 'mission' | 'tools'

export interface OverlayPanelState {
  activeBaseLayer: string
  terrainOverlay: boolean
  weatherOverlay: boolean
  satelliteHeatmap: boolean
  overlayOpacity: number
}

interface OverlayOnlyState {
  overlays: OverlayPanelState
  selectedWaypointId: string | null
  checkInInterval: number
  corridorEnabled: boolean
  corridorWidth: number
}

const STORAGE_KEY = 'hud_balanced_panels_v1'

const DEFAULT_OVERLAY_STATE: OverlayOnlyState = {
  overlays: {
    activeBaseLayer: 'streets',
    terrainOverlay: false,
    weatherOverlay: false,
    satelliteHeatmap: false,
    overlayOpacity: 0.7,
  },
  selectedWaypointId: null,
  checkInInterval: 30,
  corridorEnabled: false,
  corridorWidth: 50,
}

function loadPersistedOverlayState(): Partial<OverlayOnlyState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      overlays: parsed.overlays as OverlayPanelState | undefined,
      selectedWaypointId: typeof parsed.selectedWaypointId === 'string' ? parsed.selectedWaypointId : null,
      checkInInterval: typeof parsed.checkInInterval === 'number' ? parsed.checkInInterval : undefined,
      corridorEnabled: typeof parsed.corridorEnabled === 'boolean' ? parsed.corridorEnabled : undefined,
      corridorWidth: typeof parsed.corridorWidth === 'number' ? parsed.corridorWidth : undefined,
    }
  } catch {
    return null
  }
}

function saveOverlayState(state: OverlayOnlyState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

function subscribeOsg(listener: () => void) {
  return subscribeOperationalGraph(listener)
}

export function useBalancedPanels(onWaypointSelect?: (id: string) => void) {
  const persisted = useRef(loadPersistedOverlayState())
  const osgRoute = useSyncExternalStore(subscribeOsg, selectOsgRoute, selectOsgRoute)
  const osgMission = useSyncExternalStore(subscribeOsg, selectOsgMission, selectOsgMission)

  const {
    state: appState,
    addWaypoint: addAppWaypoint,
    removeWaypoint: removeAppWaypoint,
    setWaypoints: setAppWaypoints,
    setLayer: setAppLayer,
  } = useAppContext()
  const { session, setShowLabels, setShowDistances } = useOperationalSession()
  const { setEnabled, toggles } = useOverlayContext()

  const [overlayState, setOverlayState] = useState<OverlayOnlyState>(() => ({
    ...DEFAULT_OVERLAY_STATE,
    ...persisted.current,
    overlays: { ...DEFAULT_OVERLAY_STATE.overlays, ...persisted.current?.overlays },
  }))

  useEffect(() => {
    const timer = setTimeout(() => saveOverlayState(overlayState), 500)
    return () => clearTimeout(timer)
  }, [overlayState])

  useEffect(() => {
    if (overlayState.overlays.activeBaseLayer === appState.activeLayer) return
    setOverlayState((prev) => ({
      ...prev,
      overlays: { ...prev.overlays, activeBaseLayer: appState.activeLayer },
    }))
  }, [appState.activeLayer, overlayState.overlays.activeBaseLayer])

  useEffect(() => {
    const radarOn = getRadarEnabled()
    if (overlayState.overlays.weatherOverlay === radarOn) return
    setOverlayState((prev) => ({
      ...prev,
      overlays: { ...prev.overlays, weatherOverlay: radarOn },
    }))
  }, [overlayState.overlays.weatherOverlay])

  // Keep tray terrain toggle aligned with canonical overlay runtime (relief_usgs).
  useEffect(() => {
    const terrainOn = toggles.relief_usgs === true
    if (overlayState.overlays.terrainOverlay === terrainOn) return
    setOverlayState((prev) => ({
      ...prev,
      overlays: { ...prev.overlays, terrainOverlay: terrainOn },
    }))
  }, [toggles.relief_usgs, overlayState.overlays.terrainOverlay])

  const state = useMemo(
    () => ({
      route: {
        activeRouteId: osgRoute.routeId,
        routeName: osgRoute.routeName,
        legs: osgRoute.legs,
        totalDistance: osgRoute.totalDistance,
        estimatedDuration: osgRoute.estimatedDuration,
        corridorEnabled: overlayState.corridorEnabled,
        corridorWidth: overlayState.corridorWidth,
      },
      waypoints: {
        waypoints: osgRoute.waypoints,
        selectedWaypointId: overlayState.selectedWaypointId,
        pendingWaypointType: appState.pendingWaypointType,
        showLabels: appState.showMapLabels,
        showDistances: appState.showMapDistances,
      },
      overlays: overlayState.overlays,
      mission: {
        missionName: osgMission.missionName,
        teamMembers: [] as string[],
        checkInInterval: overlayState.checkInInterval,
        lastCheckIn: null as string | null,
      },
    }),
    [osgRoute, osgMission, overlayState, appState.pendingWaypointType, appState.showMapLabels, appState.showMapDistances],
  )

  const setRouteName = useCallback((name: string) => {
    osgSetRouteName(name)
  }, [])

  const setCorridorEnabled = useCallback((enabled: boolean) => {
    setOverlayState((prev) => ({ ...prev, corridorEnabled: enabled }))
  }, [])

  const setCorridorWidth = useCallback((width: number) => {
    setOverlayState((prev) => ({ ...prev, corridorWidth: width }))
  }, [])

  const addWaypoint = useCallback(
    (lat: number, lng: number, type: WaypointType, label?: string): Waypoint => {
      const newWaypoint: Waypoint = {
        id: `wp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        lat,
        lng,
        type,
        label: label || `${type.charAt(0).toUpperCase() + type.slice(1)} Point`,
        createdAt: Date.now(),
        status: 'active',
      }
      addAppWaypoint(newWaypoint)
      return newWaypoint
    },
    [addAppWaypoint],
  )

  const deleteWaypoint = useCallback(
    (id: string) => {
      removeAppWaypoint(id)
      setOverlayState((prev) =>
        prev.selectedWaypointId === id ? { ...prev, selectedWaypointId: null } : prev,
      )
    },
    [removeAppWaypoint],
  )

  const clearAllWaypoints = useCallback(() => {
    setAppWaypoints([])
    setOverlayState((prev) => ({ ...prev, selectedWaypointId: null }))
  }, [setAppWaypoints])

  const selectWaypoint = useCallback(
    (id: string | null) => {
      setOverlayState((prev) => ({ ...prev, selectedWaypointId: id }))
      if (id && onWaypointSelect) onWaypointSelect(id)
    },
    [onWaypointSelect],
  )

  const setPendingWaypointType = useCallback((type: string | null) => {
    const resolved = type && type !== 'default' ? type : 'pin'
    armBalancedWaypointDrop(resolved)
  }, [])

  const toggleWaypointLabels = useCallback(() => {
    setShowLabels(!session.showLabels)
  }, [session.showLabels, setShowLabels])

  const toggleWaypointDistances = useCallback(() => {
    setShowDistances(!session.showDistances)
  }, [session.showDistances, setShowDistances])

  const setBaseLayer = useCallback(
    (layer: string) => {
      const mapped = BASE_LAYER_MAP[layer]
      if (mapped) setAppLayer(mapped)
      setOverlayState((prev) => ({
        ...prev,
        overlays: { ...prev.overlays, activeBaseLayer: mapped ?? layer },
      }))
    },
    [setAppLayer],
  )

  const toggleTerrainOverlay = useCallback(() => {
    const next = !overlayState.overlays.terrainOverlay
    setEnabled('relief_usgs', next)
    setOverlayState((prev) => ({
      ...prev,
      overlays: { ...prev.overlays, terrainOverlay: next },
    }))
  }, [overlayState.overlays.terrainOverlay, setEnabled])

  const toggleWeatherOverlay = useCallback(() => {
    const next = !overlayState.overlays.weatherOverlay
    setRadarEnabled(next)
    setOverlayState((prev) => ({
      ...prev,
      overlays: { ...prev.overlays, weatherOverlay: next },
    }))
  }, [overlayState.overlays.weatherOverlay])

  const setOverlayOpacity = useCallback((opacity: number) => {
    setRadarOpacity(opacity)
    setOverlayState((prev) => ({
      ...prev,
      overlays: { ...prev.overlays, overlayOpacity: opacity },
    }))
  }, [])

  const setMissionName = useCallback((_name: string) => {
    // Mission name authority: OSG mission session via MissionSheet / missionController
  }, [])

  const setCheckInInterval = useCallback((minutes: number) => {
    setOverlayState((prev) => ({ ...prev, checkInInterval: minutes }))
  }, [])

  return {
    state,
    setRouteName,
    setCorridorEnabled,
    setCorridorWidth,
    addWaypoint,
    deleteWaypoint,
    clearAllWaypoints,
    selectWaypoint,
    setPendingWaypointType,
    toggleWaypointLabels,
    toggleWaypointDistances,
    setBaseLayer,
    toggleTerrainOverlay,
    toggleWeatherOverlay,
    setOverlayOpacity,
    setMissionName,
    setCheckInInterval,
  }
}

export type { BalancedPanelId }
