import type { Waypoint } from '../types'
import { haversineDistance } from './haversine'

/** Locked arrival radius — within this distance triggers an arrival candidate (not auto-complete). */
export const ARRIVAL_RADIUS_FEET = 50

/** Keep this many completed waypoints visible before archiving older ones. */
export const VISIBLE_COMPLETED_LIMIT = 3

export type WaypointNavStatus = 'pending' | 'active' | 'completed' | 'archived'

export function normalizeWaypointStatus(raw: unknown): WaypointNavStatus {
  if (raw === 'active' || raw === 'completed' || raw === 'archived' || raw === 'pending') {
    return raw
  }
  return 'pending'
}

/** Assign statuses to legacy waypoints: first is active, rest pending. */
export function migrateLegacyWaypointStatuses(waypoints: Waypoint[]): Waypoint[] {
  if (waypoints.length === 0) return waypoints
  let hasActive = waypoints.some((w) => w.status === 'active')
  return waypoints.map((wp, idx) => {
    const status = normalizeWaypointStatus(wp.status)
    if (status !== 'pending') return { ...wp, status }
    if (!hasActive && idx === 0) {
      hasActive = true
      return { ...wp, status: 'active' as const }
    }
    return { ...wp, status: 'pending' as const }
  })
}

export function getActiveWaypoint(waypoints: Waypoint[]): Waypoint | null {
  return waypoints.find((w) => w.status === 'active') ?? null
}

export function getNextPendingWaypoint(waypoints: Waypoint[]): Waypoint | null {
  const activeIdx = waypoints.findIndex((w) => w.status === 'active')
  const start = activeIdx >= 0 ? activeIdx + 1 : 0
  for (let i = start; i < waypoints.length; i++) {
    if (waypoints[i].status === 'pending') return waypoints[i]
  }
  for (let i = 0; i < waypoints.length; i++) {
    if (waypoints[i].status === 'pending') return waypoints[i]
  }
  return null
}

export function visibleWaypoints(waypoints: Waypoint[]): Waypoint[] {
  return waypoints.filter((w) => w.status !== 'archived')
}

export function archivedWaypoints(waypoints: Waypoint[]): Waypoint[] {
  return waypoints.filter((w) => w.status === 'archived')
}

export type ArrivalCandidate = {
  waypoint: Waypoint
  distanceFeet: number
}

/**
 * Returns arrival candidate when within radius of the active waypoint.
 * Does NOT auto-complete — operator must confirm.
 */
export function checkArrivalCandidate(
  userLat: number,
  userLng: number,
  waypoints: Waypoint[],
  radiusFeet = ARRIVAL_RADIUS_FEET,
): ArrivalCandidate | null {
  const active = getActiveWaypoint(waypoints)
  if (!active) return null
  const { feet } = haversineDistance(userLat, userLng, active.lat, active.lng)
  if (feet > radiusFeet) return null
  return { waypoint: active, distanceFeet: feet }
}

export function distanceToActiveWaypoint(
  userLat: number,
  userLng: number,
  waypoints: Waypoint[],
): { waypoint: Waypoint; miles: number; feet: number } | null {
  const active = getActiveWaypoint(waypoints)
  if (!active) return null
  const dist = haversineDistance(userLat, userLng, active.lat, active.lng)
  return { waypoint: active, ...dist }
}

/** Status for a newly added waypoint — active only if no active exists. */
export function statusForNewWaypoint(waypoints: Waypoint[]): WaypointNavStatus {
  return getActiveWaypoint(waypoints) ? 'pending' : 'active'
}

/** After user confirms arrival: complete active, activate next pending, archive excess completed. */
export function applyWaypointArrivalConfirmation(waypoints: Waypoint[]): Waypoint[] {
  const activeIdx = waypoints.findIndex((w) => w.status === 'active')
  if (activeIdx < 0) return waypoints

  const next = waypoints.map((w) => ({ ...w }))
  next[activeIdx] = { ...next[activeIdx], status: 'completed' as const }

  let nextPendingIdx = -1
  for (let i = activeIdx + 1; i < next.length; i++) {
    if (next[i].status === 'pending') {
      nextPendingIdx = i
      break
    }
  }
  if (nextPendingIdx < 0) {
    for (let i = 0; i < next.length; i++) {
      if (next[i].status === 'pending') {
        nextPendingIdx = i
        break
      }
    }
  }
  if (nextPendingIdx >= 0) {
    next[nextPendingIdx] = { ...next[nextPendingIdx], status: 'active' as const }
  }

  return archiveExcessCompleted(next)
}

export function archiveExcessCompleted(waypoints: Waypoint[]): Waypoint[] {
  const completedIndices: number[] = []
  waypoints.forEach((w, i) => {
    if (w.status === 'completed') completedIndices.push(i)
  })
  if (completedIndices.length <= VISIBLE_COMPLETED_LIMIT) return waypoints

  const toArchive = completedIndices.slice(0, completedIndices.length - VISIBLE_COMPLETED_LIMIT)
  if (toArchive.length === 0) return waypoints

  const archiveSet = new Set(toArchive)
  return waypoints.map((w, i) =>
    archiveSet.has(i) ? { ...w, status: 'archived' as const } : w,
  )
}

export function restoreArchivedWaypoint(waypoints: Waypoint[], id: string): Waypoint[] {
  return waypoints.map((w) =>
    w.id === id && w.status === 'archived' ? { ...w, status: 'completed' as const } : w,
  )
}
