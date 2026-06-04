import type { Waypoint } from '../../types'
import { sanitizeWaypointForSync } from './sanitize'

export type MissionMergeResult = {
  merged: Waypoint[]
  added: number
  updated: number
  archived: number
  unchanged: number
}

/**
 * Merge peer waypoints into local list — additive Tier 2 only.
 * Never deletes local waypoints; updates when peer copy is newer by createdAt.
 */
export function mergeMissionWaypoints(local: Waypoint[], remote: Waypoint[]): MissionMergeResult {
  const localById = new Map(local.map((w) => [w.id, w]))
  let added = 0
  let updated = 0
  let archived = 0
  let unchanged = 0

  for (const raw of remote) {
    const peer = sanitizeWaypointForSync(raw)
    const cur = localById.get(peer.id)
    if (!cur) {
      localById.set(peer.id, peer)
      if (peer.status === 'archived') archived += 1
      else added += 1
      continue
    }
    if (peer.createdAt >= cur.createdAt) {
      const nextStatus = peer.status ?? 'pending'
      const curStatus = cur.status ?? 'pending'
      const changed =
        cur.lat !== peer.lat ||
        cur.lng !== peer.lng ||
        cur.label !== peer.label ||
        cur.type !== peer.type ||
        curStatus !== nextStatus
      if (changed) {
        localById.set(peer.id, { ...cur, ...peer, id: cur.id })
        if (nextStatus === 'archived' && curStatus !== 'archived') archived += 1
        else updated += 1
      } else {
        unchanged += 1
      }
    } else {
      unchanged += 1
    }
  }

  const merged = [...localById.values()].sort((a, b) => a.createdAt - b.createdAt)
  return { merged, added, updated, archived, unchanged }
}
