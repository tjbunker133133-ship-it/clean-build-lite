import { describe, expect, it } from 'vitest'
import type { Waypoint } from '../types'
import {
  applyWaypointArrivalConfirmation,
  archiveExcessCompleted,
  ARRIVAL_RADIUS_FEET,
  checkArrivalCandidate,
  getActiveWaypoint,
  migrateLegacyWaypointStatuses,
  statusForNewWaypoint,
  VISIBLE_COMPLETED_LIMIT,
} from './waypointNavigation'

function wp(id: string, status?: Waypoint['status']): Waypoint {
  return {
    id,
    lat: 39.55,
    lng: -105.78,
    label: id,
    type: 'pin',
    createdAt: 1,
    status,
  }
}

describe('waypointNavigation', () => {
  it('migrates legacy waypoints with first active', () => {
    const migrated = migrateLegacyWaypointStatuses([wp('a'), wp('b')])
    expect(migrated[0].status).toBe('active')
    expect(migrated[1].status).toBe('pending')
  })

  it('detects arrival candidate within 50 ft but not beyond', () => {
    const waypoints = [{ ...wp('a', 'active'), lat: 39.55, lng: -105.78 }]
    const near = checkArrivalCandidate(39.55001, -105.78, waypoints)
    expect(near?.waypoint.id).toBe('a')
    expect(near!.distanceFeet).toBeLessThanOrEqual(ARRIVAL_RADIUS_FEET)
    const far = checkArrivalCandidate(39.56, -105.78, waypoints)
    expect(far).toBeNull()
  })

  it('does not auto-complete on arrival candidate', () => {
    const waypoints = [wp('a', 'active'), wp('b', 'pending')]
    const candidate = checkArrivalCandidate(39.55, -105.78, waypoints)
    expect(candidate).not.toBeNull()
    expect(getActiveWaypoint(waypoints)?.id).toBe('a')
  })

  it('activates next pending only after confirmation', () => {
    const waypoints = [wp('a', 'active'), wp('b', 'pending'), wp('c', 'pending')]
    const next = applyWaypointArrivalConfirmation(waypoints)
    expect(next[0].status).toBe('completed')
    expect(next[1].status).toBe('active')
    expect(next[2].status).toBe('pending')
  })

  it('archives older completed waypoints beyond visible limit', () => {
    const waypoints = [
      wp('1', 'completed'),
      wp('2', 'completed'),
      wp('3', 'completed'),
      wp('4', 'completed'),
      wp('5', 'active'),
    ]
    const archived = archiveExcessCompleted(waypoints)
    const completed = archived.filter((w) => w.status === 'completed')
    const hidden = archived.filter((w) => w.status === 'archived')
    expect(completed.length).toBe(VISIBLE_COMPLETED_LIMIT)
    expect(hidden.length).toBe(1)
    expect(hidden[0].id).toBe('1')
  })

  it('assigns pending status for new waypoint when active exists', () => {
    expect(statusForNewWaypoint([wp('a', 'active')])).toBe('pending')
    expect(statusForNewWaypoint([])).toBe('active')
  })
})
