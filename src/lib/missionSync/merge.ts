import type { Waypoint } from '../../types'
import type { MissionSnapshot } from './types'
import { sanitizeWaypointForSync } from './sanitize'

export type MissionMergeResult = {
  merged: Waypoint[]
  added: number
  updated: number
  archived: number
  unchanged: number
  removed: number
}

export type MergeMissionOptions = {
  /** Locally deleted ids — ignore re-add from peer until peer drops them from snapshot. */
  suppressedIds?: ReadonlySet<string>
}

/**
 * Merge peer waypoints into local list — additive Tier 2 only.
 * Never deletes local waypoints; updates when peer copy is newer by createdAt.
 */
export function mergeMissionWaypoints(
  local: Waypoint[],
  remote: Waypoint[],
  options?: MergeMissionOptions,
): MissionMergeResult {
  const suppressed = options?.suppressedIds
  const localById = new Map(local.map((w) => [w.id, w]))
  let added = 0
  let updated = 0
  let archived = 0
  let unchanged = 0

  for (const raw of remote) {
    const peer = sanitizeWaypointForSync(raw)
    if (suppressed?.has(peer.id)) continue
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
  return { merged, added, updated, archived, unchanged, removed: 0 }
}

export type PeerSnapshotState = {
  revision: number
  ids: Set<string>
}

/**
 * When a peer's snapshot revision advances, drop local copies of waypoints they
 * previously shared but no longer include (operator deleted on their device).
 */
export function reconcilePeerSnapshotRemovals(
  local: Waypoint[],
  snapshot: MissionSnapshot,
  prevPeer: PeerSnapshotState | null,
): { local: Waypoint[]; removed: number } {
  if (!prevPeer || snapshot.revision <= prevPeer.revision) {
    return { local, removed: 0 }
  }
  const remoteIds = new Set(snapshot.waypoints.map((w) => w.id))
  let removed = 0
  const next = local.filter((w) => {
    if (!prevPeer.ids.has(w.id) || remoteIds.has(w.id)) return true
    removed += 1
    return false
  })
  return { local: next, removed }
}

export function peerSnapshotStateFrom(snapshot: MissionSnapshot): PeerSnapshotState {
  return {
    revision: snapshot.revision,
    ids: new Set(snapshot.waypoints.map((w) => w.id)),
  }
}
