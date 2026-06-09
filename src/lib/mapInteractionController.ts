/**
 * @deprecated Adapter — delegates to operationalStateGraph (canonical truth).
 */

import {
  __resetOperationalStateGraphForTests,
  getOperationalGraphSnapshot,
  osgAddMeasurePoint,
  osgClearInteraction,
  osgEnterIdleInspect,
  osgEnterMeasure,
  osgEnterNavigation,
  osgEnterRouteMode,
  osgExitMeasure,
  osgFinalizeMeasureInteraction,
  osgGetInteractionMode,
  osgGetInteractionSurface,
  osgGetMeasurePoints,
  osgGetPointerOwner,
  osgGetRadialAnchor,
  osgSetRadialAnchor,
  osgSetPendingWaypointType,
  osgGetPendingWaypointType,
  osgArmWaypointDrop,
  osgSetRouteName,
  osgSyncSessionWaypoints,
  osgGetSessionWaypoints,
  osgGetRouteWaypoints,
  osgSetRouteWaypoints,
  osgAddRouteWaypoint,
  osgUpdateRouteWaypoint,
  osgRemoveRouteWaypoint,
  osgRouteMapClick,
  osgSetRadialActive,
  osgShouldBlockLongPress,
  osgShouldBlockTrailInspect,
  osgShouldBlockWaypointPlacement,
  osgClearMeasurePoints,
  osgSyncBalancedTool,
  osgSyncModernMeasure,
  subscribeOperationalGraph,
  type InteractionSurface,
  type InteractionToolVariant,
  type MapInteractionMode,
  type RadialAnchor,
} from './operationalStateGraph'

export type { MapInteractionMode }
export type MapInteractionSurface = InteractionSurface
export type MeasurePoint = { lat: number; lng: number }

export const subscribeMapInteraction = subscribeOperationalGraph

type MapInteractionSnapshot = {
  mode: MapInteractionMode
  pointerOwner: ReturnType<typeof osgGetPointerOwner>
  surface: InteractionSurface
  measurePoints: MeasurePoint[]
  radialActive: boolean
  radialAnchor: RadialAnchor | null
  pendingWaypointType: string
}

const EMPTY_MEASURE_POINTS: MeasurePoint[] = []

let cachedInteractionSnapshot: MapInteractionSnapshot = {
  mode: 'none',
  pointerOwner: 'none',
  surface: 'none',
  measurePoints: EMPTY_MEASURE_POINTS,
  radialActive: false,
  radialAnchor: null,
  pendingWaypointType: 'pin',
}

function measurePointsEqual(a: MeasurePoint[], b: readonly MeasurePoint[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => p.lat === b[i].lat && p.lng === b[i].lng)
}

function radialAnchorEqual(a: RadialAnchor | null, b: RadialAnchor | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return a.x === b.x && a.y === b.y && a.lat === b.lat && a.lng === b.lng
}

function rebuildMapInteractionSnapshot(): void {
  const osg = getOperationalGraphSnapshot()
  const mode = osgGetInteractionMode()
  const pointerOwner = osgGetPointerOwner()
  const surface = osgGetInteractionSurface()
  const rawPoints = osgGetMeasurePoints()
  const radialActive = osg.interaction.radialActive
  const radialAnchor = osgGetRadialAnchor()
  const pendingWaypointType = osgGetPendingWaypointType()
  const prev = cachedInteractionSnapshot

  if (
    prev.mode === mode &&
    prev.pointerOwner === pointerOwner &&
    prev.surface === surface &&
    prev.radialActive === radialActive &&
    prev.pendingWaypointType === pendingWaypointType &&
    radialAnchorEqual(prev.radialAnchor, radialAnchor) &&
    measurePointsEqual(prev.measurePoints, rawPoints)
  ) {
    return
  }

  const measurePoints =
    rawPoints.length === 0
      ? EMPTY_MEASURE_POINTS
      : rawPoints.map((p) => ({ lat: p.lat, lng: p.lng }))

  cachedInteractionSnapshot = {
    mode,
    pointerOwner,
    surface,
    measurePoints,
    radialActive,
    radialAnchor,
    pendingWaypointType,
  }
}

subscribeOperationalGraph(rebuildMapInteractionSnapshot)
rebuildMapInteractionSnapshot()

export function getMapInteractionSnapshot(): MapInteractionSnapshot {
  return cachedInteractionSnapshot
}

export function getInteractionMode(): MapInteractionMode {
  return osgGetInteractionMode()
}

export function getPointerOwner(): MapInteractionMode {
  const owner = osgGetPointerOwner()
  return owner === 'mission' ? 'none' : owner
}

export function getMeasurePoints(): readonly MeasurePoint[] {
  return osgGetMeasurePoints()
}

export function ownsMapPointer(): boolean {
  return osgGetPointerOwner() !== 'none'
}

export const shouldBlockWaypointPlacement = osgShouldBlockWaypointPlacement
export const shouldBlockTrailInspect = osgShouldBlockTrailInspect
export const shouldBlockLongPress = osgShouldBlockLongPress

export function enterMeasure(surface: InteractionSurface, options?: { resetPoints?: boolean }): void {
  osgEnterMeasure(surface, options?.resetPoints !== false)
}

export function exitMeasure(_reason = 'explicit'): void {
  osgExitMeasure()
}

export function finalizeMeasureInteraction(): void {
  osgFinalizeMeasureInteraction()
}

export function enterRouteMode(surface: InteractionSurface): void {
  osgEnterRouteMode(surface, 'plan')
}

export function enterNavigationMode(surface: InteractionSurface = 'modern'): boolean {
  return osgEnterNavigation(surface)
}

export function enterDropMode(surface: InteractionSurface): void {
  osgEnterRouteMode(surface, 'drop')
}

export function enterInspectMode(surface: InteractionSurface): void {
  osgEnterIdleInspect(surface)
}

export function clearInteractionMode(_reason = 'clear'): void {
  osgClearInteraction()
}
export const setRadialInteractionActive = osgSetRadialActive
export const addMeasurePoint = osgAddMeasurePoint
export const routeMapClick = osgRouteMapClick
export const syncBalancedTool = osgSyncBalancedTool
export const syncModernMeasure = osgSyncModernMeasure

export const clearMeasurePoints = osgClearMeasurePoints
export const setRadialAnchor = osgSetRadialAnchor
export const getRadialAnchor = osgGetRadialAnchor
export const setPendingWaypointType = osgSetPendingWaypointType
export const getPendingWaypointType = osgGetPendingWaypointType
export const armWaypointDrop = osgArmWaypointDrop
export const setRouteName = osgSetRouteName
export const syncSessionWaypoints = osgSyncSessionWaypoints
export const getSessionWaypoints = osgGetSessionWaypoints
export const getRouteWaypoints = osgGetRouteWaypoints
export const setRouteWaypoints = osgSetRouteWaypoints
export const addRouteWaypoint = osgAddRouteWaypoint
export const updateRouteWaypoint = osgUpdateRouteWaypoint
export const removeRouteWaypoint = osgRemoveRouteWaypoint

export function osgModeToBalancedTool(
  mode: MapInteractionMode,
  toolVariant: InteractionToolVariant | null = null,
  pendingWaypointType: string = 'default',
): 'inspect' | 'route' | 'waypoint' | 'measure' | 'none' {
  if (mode === 'measure') return 'measure'
  if (mode === 'drop') return 'waypoint'
  if (mode === 'route') return 'route'
  if (mode === 'inspect' || toolVariant === 'inspect') {
    return pendingWaypointType !== 'default' ? 'waypoint' : 'inspect'
  }
  if (mode === 'radial' || mode === 'none') return toolVariant === 'inspect' ? 'inspect' : 'none'
  return 'none'
}

export function getBalancedToolFromOsg(): 'inspect' | 'route' | 'waypoint' | 'measure' | 'none' {
  const osg = getOperationalGraphSnapshot()
  return osgModeToBalancedTool(
    osgGetInteractionMode(),
    osg.interaction.toolVariant,
    osg.interaction.pendingWaypointType,
  )
}

export function __resetMapInteractionControllerForTests(): void {
  __resetOperationalStateGraphForTests()
  cachedInteractionSnapshot = {
    mode: 'none',
    pointerOwner: 'none',
    surface: 'none',
    measurePoints: EMPTY_MEASURE_POINTS,
    radialActive: false,
    radialAnchor: null,
    pendingWaypointType: 'pin',
  }
  rebuildMapInteractionSnapshot()
}
