import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetOperationalStateGraphForTests,
  getOperationalGraphSnapshot,
  osgAddMeasurePoint,
  osgEnterMeasure,
  osgEnterMission,
  osgEnterRouteMode,
  osgExitMeasure,
  osgExitMission,
  osgGetRouteWaypoints,
  osgSetRadialActive,
  osgSetRadialAnchor,
  osgSetRouteWaypoints,
} from './operationalStateGraph'
import { __resetOperationalPerceptionForTests } from './operationalPerception/perceptionEngine'
import {
  __resetMapInteractionControllerForTests,
  getMapInteractionSnapshot,
  getSessionWaypoints,
} from './mapInteractionController'

describe('OSG state ownership validation', () => {
  beforeEach(() => {
    __resetOperationalStateGraphForTests()
    __resetOperationalPerceptionForTests()
    __resetMapInteractionControllerForTests()
  })

  it('1 — measure never disappears unless explicitly cleared in OSG', () => {
    osgEnterMeasure('modern')
    osgAddMeasurePoint(40, -105)
    osgEnterRouteMode('modern', 'plan')
    expect(getOperationalGraphSnapshot().session.activeMeasurement?.points).toHaveLength(1)
    osgEnterMission({ missionName: 'Patrol', kind: 'solo' })
    expect(getOperationalGraphSnapshot().session.activeMeasurement?.points).toHaveLength(1)
    osgEnterMeasure('modern', false)
    osgExitMeasure()
    expect(getOperationalGraphSnapshot().session.activeMeasurement).toBeNull()
  })

  it('2 — route waypoints are OSG canonical truth', () => {
    osgSetRouteWaypoints([
      { id: 'w1', lat: 1, lng: 2, type: 'pin', label: 'A', createdAt: Date.now() },
      { id: 'w2', lat: 3, lng: 4, type: 'camp', label: 'B', createdAt: Date.now() },
    ])
    expect(osgGetRouteWaypoints()).toHaveLength(2)
    expect(getSessionWaypoints()).toHaveLength(2)
    expect(getOperationalGraphSnapshot().session.routeWaypoints).toHaveLength(2)
  })

  it('3 — radial suspends perception without mutating measure session', () => {
    osgEnterMeasure('balanced')
    osgAddMeasurePoint(1, 2)
    osgSetRadialAnchor({ x: 10, y: 20, lat: 40, lng: -105 })
    osgSetRadialActive(true)
    const snap = getMapInteractionSnapshot()
    expect(snap.radialActive).toBe(true)
    expect(snap.radialAnchor?.lat).toBe(40)
    expect(snap.measurePoints).toHaveLength(1)
    osgSetRadialActive(false)
    expect(getMapInteractionSnapshot().radialActive).toBe(false)
    expect(getMapInteractionSnapshot().radialAnchor).toBeNull()
    expect(getOperationalGraphSnapshot().session.activeMeasurement?.points).toHaveLength(1)
  })

  it('4 — mission survives mode switches', () => {
    osgEnterMission({ missionName: 'Field', kind: 'solo', waypoints: [{ id: 'w1', lat: 1, lng: 2, type: 'pin' }] })
    const missionId = getOperationalGraphSnapshot().session.mission.missionId
    osgEnterMeasure('modern')
    osgEnterRouteMode('modern', 'drop')
    const snap = getOperationalGraphSnapshot()
    expect(snap.session.mission.missionId).toBe(missionId)
    expect(snap.session.mission.status).toBe('active')
  })

  it('5 — route entry does not silently clear measure geometry', () => {
    osgEnterMeasure('modern')
    osgAddMeasurePoint(5, 6)
    const measureId = getOperationalGraphSnapshot().session.activeMeasurement?.id
    osgEnterRouteMode('modern', 'plan')
    const snap = getOperationalGraphSnapshot()
    expect(snap.mode).toBe('route')
    expect(snap.session.activeMeasurement?.id).toBe(measureId)
    expect(snap.interaction.pointerOwner).toBe('route')
  })

  it('6 — session reset clears mission bindings', () => {
    osgEnterMission({ missionName: 'Done', kind: 'solo' })
    osgExitMission('test')
    const snap = getOperationalGraphSnapshot()
    expect(snap.session.mission.status).toBe('inactive')
    expect(snap.session.routeId).toBeNull()
  })
})
