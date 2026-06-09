import type { LayerType } from '../../types'

export type MissionStatus = 'inactive' | 'active' | 'paused' | 'completed'

export type MissionKind = 'solo' | 'team'

export type MissionWaypointRef = {
  id: string
  lat: number
  lng: number
  label?: string
  type: string
}

export type MissionGpsBinding = {
  lat: number | null
  lng: number | null
  accuracy: number | null
  updatedAt: number | null
}

export type MissionEnvironmentContext = {
  online: boolean
  activeOverlays: string[]
  terrainOverlayEnabled: boolean
  weatherAvailable: boolean
}

export type MissionMapSession = {
  presentationMode: string
  basemap: LayerType | string
  routeName: string
}

export type MissionSession = {
  missionId: string | null
  missionName: string
  status: MissionStatus
  kind: MissionKind
  startTime: number | null
  endTime: number | null
  pausedAt: number | null
  activeRouteId: string | null
  activeWaypointIds: string[]
  waypoints: MissionWaypointRef[]
  mapSession: MissionMapSession | null
  gps: MissionGpsBinding
  environment: MissionEnvironmentContext
  teamMissionId: string | null
}

export const DEFAULT_MISSION_SESSION: MissionSession = {
  missionId: null,
  missionName: 'Field mission',
  status: 'inactive',
  kind: 'solo',
  startTime: null,
  endTime: null,
  pausedAt: null,
  activeRouteId: null,
  activeWaypointIds: [],
  waypoints: [],
  mapSession: null,
  gps: { lat: null, lng: null, accuracy: null, updatedAt: null },
  environment: {
    online: true,
    activeOverlays: [],
    terrainOverlayEnabled: false,
    weatherAvailable: false,
  },
  teamMissionId: null,
}

export type EnterMissionInput = {
  missionName: string
  kind: MissionKind
  missionId?: string
  teamMissionId?: string | null
  routeName?: string
  waypoints?: MissionWaypointRef[]
  mapSession?: MissionMapSession | null
}

export type UpdateMissionInput = Partial<
  Pick<
    MissionSession,
    | 'waypoints'
    | 'activeWaypointIds'
    | 'activeRouteId'
    | 'mapSession'
    | 'gps'
    | 'environment'
    | 'missionName'
    | 'teamMissionId'
  >
>
