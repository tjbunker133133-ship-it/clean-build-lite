import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetOsgRouteWaypointCacheForTests,
  getOsgRouteWaypointsSnapshot,
} from './osgRouteWaypointCache'
import { __resetOperationalStateGraphForTests, osgAddRouteWaypoint } from './operationalStateGraph'

describe('osgRouteWaypointCache', () => {
  beforeEach(() => {
    __resetOperationalStateGraphForTests()
    __resetOsgRouteWaypointCacheForTests()
  })

  it('returns stable reference until waypoints change', () => {
    const a = getOsgRouteWaypointsSnapshot()
    const b = getOsgRouteWaypointsSnapshot()
    expect(a).toBe(b)

    osgAddRouteWaypoint({ id: 'wp1', lat: 40, lng: -105, label: 'A', type: 'pin' })
    const c = getOsgRouteWaypointsSnapshot()
    expect(c).not.toBe(a)
    expect(c).toHaveLength(1)

    const d = getOsgRouteWaypointsSnapshot()
    expect(c).toBe(d)
  })
})
