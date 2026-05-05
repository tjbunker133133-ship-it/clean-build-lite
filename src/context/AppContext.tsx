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
  removeWaypoint: (id: string) => void
  selectWaypoint: (id: string | null) => void
  setLayer: (layer: LayerType) => void
  setPendingType: (type: WaypointType) => void
  setDeadManTime: (t: number) => void
  resetDeadMan: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)

  const addWaypoint = useCallback((wp: Waypoint) => {
    dispatch({ type: 'ADD_WAYPOINT', payload: wp })
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
        removeWaypoint,
        selectWaypoint,
        setLayer,
        setPendingType,
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
