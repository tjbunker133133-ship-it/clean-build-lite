import { describe, expect, it } from 'vitest'
import { mergeMissionWaypoints } from './merge'

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
})
