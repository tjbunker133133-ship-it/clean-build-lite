import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import type { AppState, AppAction, Waypoint, LayerType, WaypointType } from '../types'
import { tier1Debug } from '../lib/tier1DebugLog'
import { emitWaypointRemoved } from '../lib/missionSync/waypointSyncEvents'
import {
  osgAddRouteWaypoint,
  osgConfirmWaypointArrival,
  osgGetPendingWaypointType,
  osgRemoveRouteWaypoint,
  osgRestoreArchivedRouteWaypoint,
  osgSetPendingWaypointType,
  osgSetRouteWaypoints,
  osgUpdateRouteWaypoint,
  subscribeOperationalGraph,
} from '../lib/operationalStateGraph'
import {
  getOsgRouteWaypointsSnapshot,
  subscribeOsgRouteWaypoints,
} from '../lib/osgRouteWaypointCache'

const DEAD_MAN_DURATION = 300
const UI_PREFS_KEY = 'hud_ui_prefs_v1'
const VALID_LAYERS = ['streets', 'topo', 'outdoor', 'satellite'] as const

type UiPrefsState = Omit<AppState, 'waypoints' | 'pendingWaypointType'>

const initialUiState: UiPrefsState = {
  activeLayer: 'outdoor',
  selectedWaypointId: null,
  nextWaypointLabel: '',
  keepWaypointToolArmed: false,
  clearLabelAfterDrop: true,
  showMapLabels: true,
  showMapDistances: true,
  snapToTrailEnabled: false,
  trailSnapAssistCapable: false,
  deadManTimeLeft: DEAD_MAN_DURATION,
  deadManActive: false,
}

function uiReducer(state: UiPrefsState, action: AppAction): UiPrefsState {
  switch (action.type) {
    case 'SELECT_WAYPOINT':
      return { ...state, selectedWaypointId: action.payload }
    case 'SET_LAYER':
      if (!isLayerType(action.payload)) return state
      if (state.activeLayer === action.payload && !action.force) return state
      return { ...state, activeLayer: action.payload }
    case 'SET_NEXT_WAYPOINT_LABEL':
      return { ...state, nextWaypointLabel: action.payload }
    case 'SET_KEEP_WAYPOINT_TOOL_ARMED':
      return { ...state, keepWaypointToolArmed: action.payload }
    case 'SET_CLEAR_LABEL_AFTER_DROP':
      return { ...state, clearLabelAfterDrop: action.payload }
    case 'SET_SHOW_MAP_LABELS':
      return { ...state, showMapLabels: action.payload }
    case 'SET_SHOW_MAP_DISTANCES':
      return { ...state, showMapDistances: action.payload }
    case 'SET_SNAP_TO_TRAIL':
      return { ...state, snapToTrailEnabled: action.payload }
    case 'SET_TRAIL_SNAP_ASSIST_CAPABLE':
      return { ...state, trailSnapAssistCapable: action.payload }
    case 'SET_DEAD_MAN_TIME':
      return { ...state, deadManTimeLeft: action.payload }
    case 'RESET_DEAD_MAN':
      return { ...state, deadManTimeLeft: DEAD_MAN_DURATION, deadManActive: false }
    case 'SET_DEAD_MAN_ACTIVE':
      return { ...state, deadManActive: action.payload }
    default:
      return state
  }
}

interface AppContextValue {
  state: AppState
  addWaypoint: (wp: Waypoint) => void
  setWaypoints: (wps: Waypoint[]) => void
  updateWaypoint: (id: string, patch: Partial<Waypoint>) => void
  removeWaypoint: (id: string) => void
  selectWaypoint: (id: string | null) => void
  setLayer: (layer: LayerType, options?: { force?: boolean }) => void
  setPendingType: (type: WaypointType) => void
  setNextWaypointLabel: (label: string) => void
  setKeepWaypointToolArmed: (keep: boolean) => void
  setClearLabelAfterDrop: (clear: boolean) => void
  setShowMapLabels: (show: boolean) => void
  setShowMapDistances: (show: boolean) => void
  setSnapToTrail: (enabled: boolean) => void
  setTrailSnapAssistCapable: (capable: boolean) => void
  confirmWaypointArrival: () => void
  restoreArchivedWaypoint: (id: string) => void
  setDeadManTime: (t: number) => void
  resetDeadMan: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

function isLayerType(value: unknown): value is LayerType {
  return typeof value === 'string' && (VALID_LAYERS as readonly string[]).includes(value)
}

function isWaypointType(value: unknown): value is WaypointType {
  return (
    value === 'default' ||
    value === 'start' ||
    value === 'camp' ||
    value === 'water' ||
    value === 'rest' ||
    value === 'poi' ||
    value === 'pin' ||
    value === 'finish'
  )
}

function loadUiPrefs(): UiPrefsState {
  if (typeof window === 'undefined') return initialUiState
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY)
    if (!raw) return initialUiState
    const parsed = JSON.parse(raw) as Partial<UiPrefsState> | null
    if (!parsed || typeof parsed !== 'object') return initialUiState
    return {
      ...initialUiState,
      activeLayer: isLayerType(parsed.activeLayer) ? parsed.activeLayer : initialUiState.activeLayer,
      selectedWaypointId: typeof parsed.selectedWaypointId === 'string' ? parsed.selectedWaypointId : null,
      nextWaypointLabel: typeof parsed.nextWaypointLabel === 'string' ? parsed.nextWaypointLabel.slice(0, 64) : '',
      keepWaypointToolArmed: typeof parsed.keepWaypointToolArmed === 'boolean' ? parsed.keepWaypointToolArmed : initialUiState.keepWaypointToolArmed,
      clearLabelAfterDrop: typeof parsed.clearLabelAfterDrop === 'boolean' ? parsed.clearLabelAfterDrop : initialUiState.clearLabelAfterDrop,
      showMapLabels: typeof parsed.showMapLabels === 'boolean' ? parsed.showMapLabels : initialUiState.showMapLabels,
      showMapDistances: typeof parsed.showMapDistances === 'boolean' ? parsed.showMapDistances : initialUiState.showMapDistances,
      snapToTrailEnabled:
        typeof parsed.snapToTrailEnabled === 'boolean'
          ? parsed.snapToTrailEnabled
          : initialUiState.snapToTrailEnabled,
      trailSnapAssistCapable: false,
      deadManTimeLeft:
        typeof parsed.deadManTimeLeft === 'number' && Number.isFinite(parsed.deadManTimeLeft)
          ? Math.max(0, Math.min(72 * 3600, Math.round(parsed.deadManTimeLeft)))
          : initialUiState.deadManTimeLeft,
      deadManActive: typeof parsed.deadManActive === 'boolean' ? parsed.deadManActive : initialUiState.deadManActive,
    }
  } catch {
    return initialUiState
  }
}

function subscribeOsgPendingType(listener: () => void): () => void {
  return subscribeOperationalGraph(listener)
}

function getOsgPendingTypeSnapshot(): WaypointType {
  const t = osgGetPendingWaypointType()
  return isWaypointType(t) ? t : 'pin'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [uiState, dispatch] = useReducer(uiReducer, initialUiState, loadUiPrefs)
  const waypoints = useSyncExternalStore(
    subscribeOsgRouteWaypoints,
    getOsgRouteWaypointsSnapshot,
    getOsgRouteWaypointsSnapshot,
  )
  const pendingWaypointType = useSyncExternalStore(
    subscribeOsgPendingType,
    getOsgPendingTypeSnapshot,
    getOsgPendingTypeSnapshot,
  )

  const state: AppState = useMemo(
    () => ({ ...uiState, waypoints, pendingWaypointType }),
    [uiState, waypoints, pendingWaypointType],
  )

  const addWaypoint = useCallback((wp: Waypoint) => {
    tier1Debug('waypoint', 'add', { id: wp.id, lat: wp.lat, lng: wp.lng, type: wp.type })
    osgAddRouteWaypoint(wp)
  }, [])

  const setWaypoints = useCallback((wps: Waypoint[]) => {
    tier1Debug('waypoint', 'set-all', { count: wps.length })
    osgSetRouteWaypoints(wps)
    dispatch({
      type: 'SELECT_WAYPOINT',
      payload:
        wps.length === 0
          ? null
          : uiState.selectedWaypointId != null && wps.some((w) => w.id === uiState.selectedWaypointId)
            ? uiState.selectedWaypointId
            : null,
    })
  }, [uiState.selectedWaypointId])

  useEffect(() => {
    const w = window as Window & {
      __FORCE_CLEAR_ROUTE__?: () => void
      __DEBUG_CLEAR_ROUTE__?: () => void
    }
    const clearAll = () => {
      tier1Debug('waypoint', 'clear-route-global')
      setWaypoints([])
    }
    w.__FORCE_CLEAR_ROUTE__ = clearAll
    w.__DEBUG_CLEAR_ROUTE__ = clearAll
    return () => {
      delete w.__FORCE_CLEAR_ROUTE__
      delete w.__DEBUG_CLEAR_ROUTE__
    }
  }, [setWaypoints])

  const updateWaypoint = useCallback((id: string, patch: Partial<Waypoint>) => {
    osgUpdateRouteWaypoint(id, patch)
  }, [])

  const removeWaypoint = useCallback((id: string) => {
    tier1Debug('waypoint', 'remove', { id })
    osgRemoveRouteWaypoint(id)
    emitWaypointRemoved(id)
    if (uiState.selectedWaypointId === id) {
      dispatch({ type: 'SELECT_WAYPOINT', payload: null })
    }
  }, [uiState.selectedWaypointId])

  const selectWaypoint = useCallback((id: string | null) => {
    dispatch({ type: 'SELECT_WAYPOINT', payload: id })
  }, [])

  const setLayer = useCallback((layer: LayerType, options?: { force?: boolean }) => {
    dispatch({ type: 'SET_LAYER', payload: layer, force: options?.force })
  }, [])

  const setPendingType = useCallback((type: WaypointType) => {
    osgSetPendingWaypointType(type)
  }, [])

  const setNextWaypointLabel = useCallback((label: string) => {
    dispatch({ type: 'SET_NEXT_WAYPOINT_LABEL', payload: label })
  }, [])

  const setKeepWaypointToolArmed = useCallback((keep: boolean) => {
    dispatch({ type: 'SET_KEEP_WAYPOINT_TOOL_ARMED', payload: keep })
  }, [])

  const setClearLabelAfterDrop = useCallback((clear: boolean) => {
    dispatch({ type: 'SET_CLEAR_LABEL_AFTER_DROP', payload: clear })
  }, [])

  const setShowMapLabels = useCallback((show: boolean) => {
    dispatch({ type: 'SET_SHOW_MAP_LABELS', payload: show })
  }, [])

  const setShowMapDistances = useCallback((show: boolean) => {
    dispatch({ type: 'SET_SHOW_MAP_DISTANCES', payload: show })
  }, [])

  const setSnapToTrail = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_SNAP_TO_TRAIL', payload: enabled })
  }, [])

  const setTrailSnapAssistCapable = useCallback((capable: boolean) => {
    dispatch({ type: 'SET_TRAIL_SNAP_ASSIST_CAPABLE', payload: capable })
  }, [])

  const confirmWaypointArrival = useCallback(() => {
    tier1Debug('waypoint', 'confirm-arrival', { count: waypoints.length })
    osgConfirmWaypointArrival()
  }, [waypoints.length])

  const restoreArchivedWaypointById = useCallback((id: string) => {
    osgRestoreArchivedRouteWaypoint(id)
  }, [])

  const setDeadManTime = useCallback((t: number) => {
    dispatch({ type: 'SET_DEAD_MAN_TIME', payload: t })
  }, [])

  const resetDeadMan = useCallback(() => {
    dispatch({ type: 'RESET_DEAD_MAN' })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiState))
    } catch {
      // Ignore storage failures (private mode/quota).
    }
  }, [uiState])

  const value = useMemo(
    () => ({
      state,
      addWaypoint,
      setWaypoints,
      updateWaypoint,
      removeWaypoint,
      selectWaypoint,
      setLayer,
      setPendingType,
      setNextWaypointLabel,
      setKeepWaypointToolArmed,
      setClearLabelAfterDrop,
      setShowMapLabels,
      setShowMapDistances,
      setSnapToTrail,
      setTrailSnapAssistCapable,
      confirmWaypointArrival,
      restoreArchivedWaypoint: restoreArchivedWaypointById,
      setDeadManTime,
      resetDeadMan,
    }),
    [
      state,
      addWaypoint,
      setWaypoints,
      updateWaypoint,
      removeWaypoint,
      selectWaypoint,
      setLayer,
      setPendingType,
      setNextWaypointLabel,
      setKeepWaypointToolArmed,
      setClearLabelAfterDrop,
      setShowMapLabels,
      setShowMapDistances,
      setSnapToTrail,
      setTrailSnapAssistCapable,
      confirmWaypointArrival,
      restoreArchivedWaypointById,
      setDeadManTime,
      resetDeadMan,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}
