import { describe, expect, it } from 'vitest'
import { buildMissionCorridorHint, shouldApplyCorridorHint } from './corridorHint'
import type { Waypoint } from '../../types'

const wps: Waypoint[] = [
  { id: 'a', lat: 40, lng: -105, label: 'A', type: 'start', createdAt: 1 },
  { id: 'b', lat: 40.1, lng: -105.1, label: 'B', type: 'pin', createdAt: 2 },
]

describe('buildMissionCorridorHint', () => {
  it('returns null with fewer than two active waypoints', () => {
    expect(
      buildMissionCorridorHint({
        missionId: 'm1',
        sourceDeviceId: 'd1',
        sourceCallsign: 'Alpha',
        waypoints: [wps[0]!],
      }),
    ).toBeNull()
  })

  it('builds bounds for a two-point route', () => {
    const hint = buildMissionCorridorHint({
      missionId: 'm1',
      sourceDeviceId: 'd1',
      sourceCallsign: 'Alpha',
      waypoints: wps,
    })
    expect(hint).not.toBeNull()
    expect(hint!.bounds.minLat).toBeLessThan(hint!.bounds.maxLat)
    expect(hint!.routeFingerprint.length).toBeGreaterThan(0)
  })
})

describe('shouldApplyCorridorHint', () => {
  it('rejects mismatched mission id', () => {
    const hint = buildMissionCorridorHint({
      missionId: 'm1',
      sourceDeviceId: 'd1',
      sourceCallsign: 'Alpha',
      waypoints: wps,
    })!
    expect(shouldApplyCorridorHint(hint, 'other')).toBe(false)
  })
})
