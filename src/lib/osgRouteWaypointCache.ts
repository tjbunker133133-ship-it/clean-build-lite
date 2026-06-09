/**
 * Stable OSG route-waypoint snapshot for useSyncExternalStore.
 * getSnapshot MUST return the same reference until OSG route waypoints change.
 */

import type { Waypoint } from '../types'
import { osgGetRouteWaypoints, subscribeOperationalGraph } from './operationalStateGraph'

const EMPTY_WAYPOINTS: readonly Waypoint[] = []

let cachedWaypoints: readonly Waypoint[] = EMPTY_WAYPOINTS
let cacheRevision = ''

function waypointsRevision(wps: ReadonlyArray<Waypoint>): string {
  if (wps.length === 0) return ''
  return wps
    .map(
      (w) =>
        `${w.id}|${w.lat}|${w.lng}|${w.status ?? ''}|${w.label ?? ''}|${w.type ?? ''}`,
    )
    .join(';')
}

function rebuildWaypointCache(): void {
  const next = osgGetRouteWaypoints()
  const revision = waypointsRevision(next)
  if (revision === cacheRevision) return
  cacheRevision = revision
  cachedWaypoints = next.length === 0 ? EMPTY_WAYPOINTS : next.map((w) => ({ ...w }))
}

subscribeOperationalGraph(rebuildWaypointCache)
rebuildWaypointCache()

export function subscribeOsgRouteWaypoints(listener: () => void): () => void {
  return subscribeOperationalGraph(listener)
}

/** Stable reference — only changes when route waypoints change. */
export function getOsgRouteWaypointsSnapshot(): readonly Waypoint[] {
  return cachedWaypoints
}

export function __resetOsgRouteWaypointCacheForTests(): void {
  cacheRevision = ''
  cachedWaypoints = EMPTY_WAYPOINTS
  rebuildWaypointCache()
}
