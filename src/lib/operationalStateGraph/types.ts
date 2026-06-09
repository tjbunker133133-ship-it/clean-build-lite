import type { Waypoint } from '../../types'
import type { MissionSession, MissionWaypointRef } from '../missionController/types'

export type OperationalMode = 'idle' | 'measure' | 'route' | 'mission' | 'navigation' | 'radial'

export type PointerOwner = 'map' | 'radial' | 'route' | 'measure' | 'mission' | null

export type InteractionSurface = 'balanced' | 'modern' | 'classic' | 'none'

export type InteractionToolVariant = 'drop' | 'inspect' | 'plan' | null

export type RadialAnchor = {
  x: number
  y: number
  lng: number
  lat: number
}

export type MeasureUnits = 'imperial' | 'metric'

export type MapSurfacePulse = {
  lat: number
  lng: number
  at: number
}

export type MeasurementState = {
  id: string
  points: Array<{ lat: number; lng: number }>
  createdAt: number
  lastUpdated: number
  modeContext: 'measure'
  surface: InteractionSurface
}

export type OperationalStateGraph = {
  mode: OperationalMode
  interaction: {
    pointerOwner: PointerOwner
    activeTool: OperationalMode
    toolVariant: InteractionToolVariant
    locked: boolean
    surface: InteractionSurface
    preRadialTool: OperationalMode
    preRadialVariant: InteractionToolVariant
    radialActive: boolean
    /** Map-anchored radial menu position — set on open, cleared on close. */
    radialAnchor: RadialAnchor | null
    /** Armed waypoint type for drop/route tools (OSG-owned). */
    pendingWaypointType: string
    /** Transient Modern map-tap spatial pulse (read by HUD, auto-expires). */
    mapSurfacePulse: MapSurfacePulse | null
  }
  session: {
    mission: MissionSession
    routeId: string | null
    routeName: string
    /** Canonical route geometry (OSG truth). */
    routeWaypoints: Waypoint[]
    /** Mission binding refs — derived from routeWaypoints. */
    waypoints: MissionWaypointRef[]
    activeMeasurement: MeasurementState | null
  }
  runtime: {
    gps: MissionSession['gps']
    environment: MissionSession['environment']
    mapSession: MissionSession['mapSession']
    /** Distance/speed display preference — default imperial (miles/feet). */
    measureUnits: MeasureUnits
  }
  control: {
    lastTransition: number
    transitionSource: string
    lastRejection: string | null
    /** Stable mode before last committed mode transition (for perception hop elimination). */
    lastTransitionFrom: OperationalMode | null
    /** Logical OSG path including intermediate hops. */
    lastTransitionPath: OperationalMode[]
    conflictResolutionMode: 'strict' | 'soft'
  }
}

export type OperationalTransition = {
  mode?: OperationalMode
  interaction?: Partial<OperationalStateGraph['interaction']>
  session?: Partial<{
    mission: Partial<MissionSession>
    routeId: string | null
    routeName: string
    routeWaypoints: Waypoint[]
    waypoints: MissionWaypointRef[]
    activeMeasurement: MeasurementState | null
  }>
  runtime?: Partial<OperationalStateGraph['runtime']>
  control?: Partial<OperationalStateGraph['control']>
}
