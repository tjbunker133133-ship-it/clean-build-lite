import type { Waypoint } from '../../types'
import { sanitizeWaypointForSync } from './sanitize'

export type MissionMergeResult = {
  merged: Waypoint[]
  added: number
  updated: number
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
  let unchanged = 0

  for (const raw of remote) {
    const peer = sanitizeWaypointForSync(raw)
    const cur = localById.get(peer.id)
    if (!cur) {
      localById.set(peer.id, peer)
      added += 1
      continue
    }
    if (peer.createdAt >= cur.createdAt) {
      const changed =
        cur.lat !== peer.lat ||
        cur.lng !== peer.lng ||
        cur.label !== peer.label ||
        cur.type !== peer.type ||
        (cur.status ?? 'pending') !== (peer.status ?? 'pending')
      if (changed) {
        localById.set(peer.id, { ...cur, ...peer, id: cur.id })
        updated += 1
      } else {
        unchanged += 1
      }
    } else {
      unchanged += 1
    }
  }

  const merged = [...localById.values()].sort((a, b) => a.createdAt - b.createdAt)
  return { merged, added, updated, unchanged }
}
