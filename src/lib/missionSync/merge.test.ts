import { describe, expect, it } from 'vitest'
import type { Waypoint } from '../../types'
import { mergeMissionWaypoints, reconcilePeerSnapshotRemovals } from './merge'

describe('mergeMissionWaypoints', () => {
  it('adds new peer waypoints without removing local', () => {
    const local = [
      { id: 'a', lat: 1, lng: 2, label: 'A', type: 'start' as const, createdAt: 100 },
    ]
    const remote = [
      { id: 'b', lat: 3, lng: 4, label: 'B', type: 'pin' as const, createdAt: 200 },
    ]
    const { merged, added } = mergeMissionWaypoints(local, remote)
    expect(merged).toHaveLength(2)
    expect(added).toBe(1)
  })

  it('skips suppressed ids from peer re-add', () => {
    const local: Waypoint[] = []
    const remote: Waypoint[] = [
      { id: 'ghost', lat: 1, lng: 2, label: 'START', type: 'start', createdAt: 200 },
    ]
    const { merged, added } = mergeMissionWaypoints(local, remote, {
      suppressedIds: new Set(['ghost']),
    })
    expect(merged).toHaveLength(0)
    expect(added).toBe(0)
  })

  it('reconcilePeerSnapshotRemovals drops ids peer removed', () => {
    const local: Waypoint[] = [
      { id: 'a', lat: 1, lng: 2, label: 'START', type: 'start', createdAt: 100 },
      { id: 'b', lat: 3, lng: 4, label: 'B', type: 'pin', createdAt: 100 },
    ]
    const snapshot = {
      missionId: 'm1',
      missionName: 't',
      revision: 2,
      updatedAt: Date.now(),
      hostDeviceId: 'host',
      sourceDeviceId: 'peer-tab',
      sourceCallsign: 'TAB',
      waypoints: [{ id: 'b', lat: 3, lng: 4, label: 'B', type: 'pin' as const, createdAt: 100 }],
    }
    const prev = { revision: 1, ids: new Set(['a', 'b']) }
    const { local: next, removed } = reconcilePeerSnapshotRemovals(local, snapshot, prev)
    expect(removed).toBe(1)
    expect(next.map((w) => w.id)).toEqual(['b'])
  })

  it('updates when peer copy is newer', () => {
    const local = [
      { id: 'a', lat: 1, lng: 2, label: 'Old', type: 'pin' as const, createdAt: 100 },
    ]
    const remote = [
      { id: 'a', lat: 9, lng: 8, label: 'New', type: 'pin' as const, createdAt: 500 },
    ]
    const { merged, updated } = mergeMissionWaypoints(local, remote)
    expect(updated).toBe(1)
    expect(merged[0]?.label).toBe('New')
    expect(merged[0]?.lat).toBe(9)
  })

  it('applies archived status from newer peer copy', () => {
    const local: Waypoint[] = [
      { id: 'a', lat: 1, lng: 2, label: 'A', type: 'pin', createdAt: 100, status: 'pending' },
    ]
    const remote: Waypoint[] = [
      {
        id: 'a',
        lat: 1,
        lng: 2,
        label: 'A',
        type: 'pin',
        createdAt: 500,
        status: 'archived',
      },
    ]
    const { merged, archived } = mergeMissionWaypoints(local, remote)
    expect(archived).toBe(1)
    expect(merged[0]?.status).toBe('archived')
  })
})
