import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode
} from 'react'
import type { AppState, AppAction, Waypoint, LayerType, WaypointType } from '../types'
import { tier1Debug } from '../lib/tier1DebugLog'

const DEAD_MAN_DURATION = 300
const APP_STORAGE_KEY = 'tactical_hud_app_state_v1'
const VALID_LAYERS = ['streets', 'topo', 'outdoor', 'satellite'] as const

const initialState: AppState = {
  waypoints: [],
  activeLayer: 'satellite',
  selectedWaypointId: null,
  pendingWaypointType: 'default',
  nextWaypointLabel: '',
  keepWaypointToolArmed: false,
  clearLabelAfterDrop: true,
  showMapLabels: true,
  showMapDistances: true,
  deadManTimeLeft: DEAD_MAN_DURATION,
  deadManActive: true,
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_WAYPOINT': {
      const wp = action.payload
      tier1Debug('waypoint', 'add', { id: wp.id, lat: wp.lat, lng: wp.lng, type: wp.type })
      return {
        ...state,
        waypoints: [...state.waypoints, wp],
      }
    }
    case 'SET_WAYPOINTS': {
      const next = action.payload
      tier1Debug('waypoint', 'set-all', { count: next.length })
      const sel =
        next.length === 0
          ? null
          : state.selectedWaypointId != null && next.some((w) => w.id === state.selectedWaypointId)
            ? state.selectedWaypointId
            : null
      return {
        ...state,
        waypoints: next,
        selectedWaypointId: sel,
      }
    }
    case 'UPDATE_WAYPOINT':
      return {
        ...state,
        waypoints: state.waypoints.map((w) =>
          w.id === action.payload.id ? { ...w, ...action.payload.patch } : w,
        ),
      }
    case 'REMOVE_WAYPOINT':
      tier1Debug('waypoint', 'remove', { id: action.payload })
      return {
        ...state,
        waypoints: state.waypoints.filter((w) => w.id !== action.payload),
        selectedWaypointId:
          state.selectedWaypointId === action.payload
            ? null
            : state.selectedWaypointId,
      }
    case 'SELECT_WAYPOINT':
      return { ...state, selectedWaypointId: action.payload }
    case 'SET_LAYER':
      if (!isLayerType(action.payload)) return state
      if (state.activeLayer === action.payload) return state
      return { ...state, activeLayer: action.payload }
    case 'SET_PENDING_TYPE':
      return { ...state, pendingWaypointType: action.payload }
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
    case 'SET_DEAD_MAN_TIME':
      return { ...state, deadManTimeLeft: action.payload }
    case 'RESET_DEAD_MAN':
      return { ...state, deadManTimeLeft: DEAD_MAN_DURATION, deadManActive: true }
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
  setLayer: (layer: LayerType) => void
  setPendingType: (type: WaypointType) => void
  setNextWaypointLabel: (label: string) => void
  setKeepWaypointToolArmed: (keep: boolean) => void
  setClearLabelAfterDrop: (clear: boolean) => void
  setShowMapLabels: (show: boolean) => void
  setShowMapDistances: (show: boolean) => void
  setDeadManTime: (t: number) => void
  resetDeadMan: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

function isWaypointType(value: unknown): value is WaypointType {
  return value === 'default' || value === 'camp' || value === 'water' || value === 'rest' || value === 'finish'
}

function isLayerType(value: unknown): value is LayerType {
  return typeof value === 'string' && (VALID_LAYERS as readonly string[]).includes(value)
}

function sanitizeWaypoint(raw: unknown): Waypoint | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<Waypoint>
  if (typeof item.id !== 'string' || typeof item.label !== 'string') return null
  if (typeof item.lng !== 'number' || !Number.isFinite(item.lng)) return null
  if (typeof item.lat !== 'number' || !Number.isFinite(item.lat)) return null
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) return null
  if (!isWaypointType(item.type)) return null
  return {
    id: item.id,
    lng: item.lng,
    lat: item.lat,
    label: item.label.slice(0, 64),
    type: item.type,
    createdAt: item.createdAt,
  }
}

function loadInitialState(): AppState {
  if (typeof window === 'undefined') return initialState
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY)
    if (!raw) return initialState
    const parsed = JSON.parse(raw) as Partial<AppState> | null
    if (!parsed || typeof parsed !== 'object') return initialState
    const waypoints = Array.isArray(parsed.waypoints)
      ? parsed.waypoints.map(sanitizeWaypoint).filter((v): v is Waypoint => Boolean(v))
      : []
    return {
      ...initialState,
      waypoints,
      activeLayer: isLayerType(parsed.activeLayer) ? parsed.activeLayer : initialState.activeLayer,
      selectedWaypointId: typeof parsed.selectedWaypointId === 'string' ? parsed.selectedWaypointId : null,
      pendingWaypointType: isWaypointType(parsed.pendingWaypointType) ? parsed.pendingWaypointType : initialState.pendingWaypointType,
      nextWaypointLabel: typeof parsed.nextWaypointLabel === 'string' ? parsed.nextWaypointLabel.slice(0, 64) : '',
      keepWaypointToolArmed: typeof parsed.keepWaypointToolArmed === 'boolean' ? parsed.keepWaypointToolArmed : initialState.keepWaypointToolArmed,
      clearLabelAfterDrop: typeof parsed.clearLabelAfterDrop === 'boolean' ? parsed.clearLabelAfterDrop : initialState.clearLabelAfterDrop,
      showMapLabels: typeof parsed.showMapLabels === 'boolean' ? parsed.showMapLabels : initialState.showMapLabels,
      showMapDistances: typeof parsed.showMapDistances === 'boolean' ? parsed.showMapDistances : initialState.showMapDistances,
      deadManTimeLeft:
        typeof parsed.deadManTimeLeft === 'number' && Number.isFinite(parsed.deadManTimeLeft)
          ? Math.max(0, Math.min(72 * 3600, Math.round(parsed.deadManTimeLeft)))
          : initialState.deadManTimeLeft,
      deadManActive: typeof parsed.deadManActive === 'boolean' ? parsed.deadManActive : initialState.deadManActive,
    }
  } catch {
    return initialState
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState, loadInitialState)

  const addWaypoint = useCallback((wp: Waypoint) => {
    dispatch({ type: 'ADD_WAYPOINT', payload: wp })
  }, [])

  const setWaypoints = useCallback((wps: Waypoint[]) => {
    dispatch({ type: 'SET_WAYPOINTS', payload: wps })
  }, [])

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
    dispatch({ type: 'UPDATE_WAYPOINT', payload: { id, patch } })
  }, [])

  const removeWaypoint = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_WAYPOINT', payload: id })
  }, [])

  const selectWaypoint = useCallback((id: string | null) => {
    dispatch({ type: 'SELECT_WAYPOINT', payload: id })
  }, [])

  const setLayer = useCallback((layer: LayerType) => {
    console.log('[SET LAYER DISPATCH]', layer, Date.now())
    dispatch({ type: 'SET_LAYER', payload: layer })
  }, [])

  const setPendingType = useCallback((type: WaypointType) => {
    dispatch({ type: 'SET_PENDING_TYPE', payload: type })
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

  const setDeadManTime = useCallback((t: number) => {
    dispatch({ type: 'SET_DEAD_MAN_TIME', payload: t })
  }, [])

  const resetDeadMan = useCallback(() => {
    dispatch({ type: 'RESET_DEAD_MAN' })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Ignore storage failures (private mode/quota).
    }
  }, [state])

  return (
    <AppContext.Provider
      value={{
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
        setDeadManTime,
        resetDeadMan,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}
