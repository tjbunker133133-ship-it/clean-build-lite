export type WaypointType = 'default' | 'camp' | 'water' | 'danger'

export interface Waypoint {
  id: string
  lng: number
  lat: number
  label: string
  type: WaypointType
  createdAt: number
}

export type LayerType = 'streets' | 'satellite' | 'topo'

export interface AppState {
  waypoints: Waypoint[]
  activeLayer: LayerType
  selectedWaypointId: string | null
  pendingWaypointType: WaypointType
  deadManTimeLeft: number
  deadManActive: boolean
}

export type AppAction =
  | { type: 'ADD_WAYPOINT'; payload: Waypoint }
  | { type: 'REMOVE_WAYPOINT'; payload: string }
  | { type: 'SELECT_WAYPOINT'; payload: string | null }
  | { type: 'SET_LAYER'; payload: LayerType }
  | { type: 'SET_PENDING_TYPE'; payload: WaypointType }
  | { type: 'SET_DEAD_MAN_TIME'; payload: number }
  | { type: 'RESET_DEAD_MAN' }
  | { type: 'SET_DEAD_MAN_ACTIVE'; payload: boolean }