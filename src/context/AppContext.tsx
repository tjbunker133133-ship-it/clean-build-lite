import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode
} from 'react'
import type { AppState, AppAction, Waypoint, LayerType, WaypointType } from '../types'

const DEAD_MAN_DURATION = 300

const initialState: AppState = {
  waypoints: [],
  activeLayer: 'streets',
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
    case 'ADD_WAYPOINT':
      return {
        ...state,
        waypoints: [...state.waypoints, action.payload],
      }
    case 'SET_WAYPOINTS':
      return {
        ...state,
        waypoints: action.payload,
      }
    case 'REMOVE_WAYPOINT':
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)

  const addWaypoint = useCallback((wp: Waypoint) => {
    dispatch({ type: 'ADD_WAYPOINT', payload: wp })
  }, [])

  const setWaypoints = useCallback((wps: Waypoint[]) => {
    dispatch({ type: 'SET_WAYPOINTS', payload: wps })
  }, [])

  const removeWaypoint = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_WAYPOINT', payload: id })
  }, [])

  const selectWaypoint = useCallback((id: string | null) => {
    dispatch({ type: 'SELECT_WAYPOINT', payload: id })
  }, [])

  const setLayer = useCallback((layer: LayerType) => {
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

  return (
    <AppContext.Provider
      value={{
        state,
        addWaypoint,
        setWaypoints,
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
