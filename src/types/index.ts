export type WaypointType = 'default' | 'camp' | 'water' | 'rest' | 'finish'

export interface Waypoint {
  id: string
  lng: number
  lat: number
  label: string
  type: WaypointType
  createdAt: number
  /** Operator tap before snap — present only when `source === 'snapped'`. */
  rawLat?: number
  rawLng?: number
  source?: 'manual' | 'snapped'
  snapDistanceMeters?: number
}

export type LayerType = 'streets' | 'satellite' | 'topo' | 'outdoor'

export interface AppState {
  waypoints: Waypoint[]
  activeLayer: LayerType
  selectedWaypointId: string | null
  pendingWaypointType: WaypointType
  nextWaypointLabel: string
  keepWaypointToolArmed: boolean
  clearLabelAfterDrop: boolean
  showMapLabels: boolean
  showMapDistances: boolean
  /** Default OFF — preview-only trail snap assist (Phase 1). */
  snapToTrailEnabled: boolean
  /** Ephemeral — not restored from storage; MapCanvas sets from MapLibre style + zoom. */
  trailSnapAssistCapable: boolean
  deadManTimeLeft: number
  deadManActive: boolean
}

export type AppAction =
  | { type: 'ADD_WAYPOINT'; payload: Waypoint }
  | { type: 'SET_WAYPOINTS'; payload: Waypoint[] }
  | { type: 'UPDATE_WAYPOINT'; payload: { id: string; patch: Partial<Waypoint> } }
  | { type: 'REMOVE_WAYPOINT'; payload: string }
  | { type: 'SELECT_WAYPOINT'; payload: string | null }
  | { type: 'SET_LAYER'; payload: LayerType }
  | { type: 'SET_PENDING_TYPE'; payload: WaypointType }
  | { type: 'SET_NEXT_WAYPOINT_LABEL'; payload: string }
  | { type: 'SET_KEEP_WAYPOINT_TOOL_ARMED'; payload: boolean }
  | { type: 'SET_CLEAR_LABEL_AFTER_DROP'; payload: boolean }
  | { type: 'SET_SHOW_MAP_LABELS'; payload: boolean }
  | { type: 'SET_SHOW_MAP_DISTANCES'; payload: boolean }
  | { type: 'SET_SNAP_TO_TRAIL'; payload: boolean }
  | { type: 'SET_TRAIL_SNAP_ASSIST_CAPABLE'; payload: boolean }
  | { type: 'SET_DEAD_MAN_TIME'; payload: number }
  | { type: 'RESET_DEAD_MAN' }
  | { type: 'SET_DEAD_MAN_ACTIVE'; payload: boolean }