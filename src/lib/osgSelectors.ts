/**
 * OSG projection selectors — read-only derived views for UI layers.
 * Snapshots are referentially stable for useSyncExternalStore (cached until OSG emits).
 */

import type { Waypoint } from '../types'
import type { MissionWaypointRef } from './missionController/types'
import {
  getBalancedToolFromOsg,
  getMapInteractionSnapshot,
  getSessionWaypoints,
} from './mapInteractionController'
import { getMissionSnapshot } from './missionController'
import { getOperationalGraphSnapshot, subscribeOperationalGraph } from './operationalStateGraph'
import { haversineMeters } from './haversine'

export type OsgRouteView = {
  routeId: string
  routeName: string
  waypoints: ReadonlyArray<Waypoint>
  legs: Array<{ from: { lat: number; lng: number }; to: { lat: number; lng: number }; distance: number }>
  totalDistance: number
  estimatedDuration: number | null
}

export type OsgMissionView = {
  missionId: string | null
  missionName: string
  status: string
  kind: string
  active: boolean
}

function computeOsgRouteView(): OsgRouteView {
  const osg = getOperationalGraphSnapshot()
  const waypoints = osg.session.routeWaypoints
  const active = waypoints.filter((w) => w.status !== 'archived')
  let totalDistance = 0
  const legs: OsgRouteView['legs'] = []
  for (let i = 1; i < active.length; i++) {
    const from = active[i - 1]
    const to = active[i]
    const distance = haversineMeters(from.lat, from.lng, to.lat, to.lng)
    totalDistance += distance
    legs.push({ from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng }, distance })
  }
  const walkMps = 1.4
  return {
    routeId: osg.session.routeId,
    routeName: osg.session.routeName,
    waypoints,
    legs,
    totalDistance,
    estimatedDuration: active.length >= 2 ? Math.round(totalDistance / walkMps) : null,
  }
}

function computeOsgMissionView(): OsgMissionView {
  const snap = getMissionSnapshot()
  return {
    missionId: snap.missionId,
    missionName: snap.missionName,
    status: snap.status,
    kind: snap.kind,
    active: snap.status === 'active' || snap.status === 'paused',
  }
}

let cachedRouteView: OsgRouteView | null = null
let cachedMissionView: OsgMissionView | null = null

function routeViewChanged(prev: OsgRouteView, next: OsgRouteView): boolean {
  return (
    prev.routeId !== next.routeId ||
    prev.routeName !== next.routeName ||
    prev.waypoints !== next.waypoints ||
    prev.totalDistance !== next.totalDistance ||
    prev.estimatedDuration !== next.estimatedDuration
  )
}

function missionViewChanged(prev: OsgMissionView, next: OsgMissionView): boolean {
  return (
    prev.missionId !== next.missionId ||
    prev.missionName !== next.missionName ||
    prev.status !== next.status ||
    prev.kind !== next.kind ||
    prev.active !== next.active
  )
}

function rebuildOsgSelectorCaches(): void {
  const nextRoute = computeOsgRouteView()
  if (!cachedRouteView || routeViewChanged(cachedRouteView, nextRoute)) {
    cachedRouteView = nextRoute
  }

  const nextMission = computeOsgMissionView()
  if (!cachedMissionView || missionViewChanged(cachedMissionView, nextMission)) {
    cachedMissionView = nextMission
  }
}

subscribeOperationalGraph(rebuildOsgSelectorCaches)
rebuildOsgSelectorCaches()

export function selectOsgRoute(): OsgRouteView {
  if (!cachedRouteView) rebuildOsgSelectorCaches()
  return cachedRouteView!
}

export function selectOsgMission(): OsgMissionView {
  if (!cachedMissionView) rebuildOsgSelectorCaches()
  return cachedMissionView!
}

export function __resetOsgSelectorCachesForTests(): void {
  cachedRouteView = null
  cachedMissionView = null
  rebuildOsgSelectorCaches()
}

export function selectOsgActiveTool() {
  return getBalancedToolFromOsg()
}

export function selectOsgInteraction() {
  return getMapInteractionSnapshot()
}

export function selectOsgRouteWaypoints(): ReadonlyArray<Waypoint> {
  return getOperationalGraphSnapshot().session.routeWaypoints
}

export function selectOsgWaypointRefs(): ReadonlyArray<MissionWaypointRef> {
  return getSessionWaypoints()
}
