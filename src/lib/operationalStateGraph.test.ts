import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetOperationalStateGraphForTests,
  canTransitionOperationalMode,
  getOperationalGraphSnapshot,
  osgAddMeasurePoint,
  osgEnterMeasure,
  osgEnterMission,
  osgEnterRouteMode,
  osgExitMission,
  osgExitMeasure,
  osgGetInteractionMode,
  osgRouteMapClick,
  osgSetRadialActive,
  osgShouldBlockLongPress,
  osgShouldBlockWaypointPlacement,
  transitionOperationalState,
} from './operationalStateGraph'

describe('operationalStateGraph', () => {
  beforeEach(() => {
    __resetOperationalStateGraphForTests()
  })

  it('allows only one active interaction mode at a time', () => {
    osgEnterRouteMode('balanced', 'plan')
    expect(getOperationalGraphSnapshot().mode).toBe('route')
    osgEnterMeasure('balanced')
    const snap = getOperationalGraphSnapshot()
    expect(snap.mode).toBe('measure')
    expect(snap.session.activeMeasurement).not.toBeNull()
    expect(snap.interaction.activeTool).toBe('measure')
  })

  it('entering route preserves active measurement in session', () => {
    osgEnterMeasure('modern')
    osgAddMeasurePoint(1, 2)
    osgEnterRouteMode('modern', 'drop')
    const snap = getOperationalGraphSnapshot()
    expect(snap.mode).toBe('route')
    expect(snap.session.activeMeasurement).not.toBeNull()
    expect(snap.session.activeMeasurement?.points).toHaveLength(1)
    expect(snap.session.activeMeasurement?.modeContext).toBe('measure')
    expect(snap.session.activeMeasurement?.id).toBeTruthy()
    expect(osgShouldBlockWaypointPlacement()).toBe(false)
  })

  it('releases measure interaction after two points while keeping geometry', () => {
    osgEnterMeasure('balanced')
    osgAddMeasurePoint(1, 2)
    osgAddMeasurePoint(3, 4)
    const snap = getOperationalGraphSnapshot()
    expect(snap.mode).toBe('idle')
    expect(snap.interaction.pointerOwner).toBe('map')
    expect(snap.session.activeMeasurement?.points).toHaveLength(2)
    expect(osgShouldBlockLongPress()).toBe(false)
  })

  it('radial is transient and restores prior tool', () => {
    osgEnterMeasure('balanced')
    osgAddMeasurePoint(3, 4)
    osgSetRadialActive(true)
    expect(getOperationalGraphSnapshot().interaction.pointerOwner).toBe('radial')
    expect(osgRouteMapClick(5, 6)).toBe(false)
    osgSetRadialActive(false)
    expect(osgGetInteractionMode()).toBe('measure')
    expect(getOperationalGraphSnapshot().session.activeMeasurement?.points).toHaveLength(1)
  })

  it('mission session persists while interaction changes', () => {
    osgEnterMission({ missionName: 'Patrol', kind: 'solo', waypoints: [{ id: 'w1', lat: 1, lng: 2, type: 'pin' }] })
    const missionId = getOperationalGraphSnapshot().session.mission.missionId
    osgEnterMeasure('modern')
    const snap = getOperationalGraphSnapshot()
    expect(snap.mode).toBe('measure')
    expect(snap.session.mission.missionId).toBe(missionId)
    expect(snap.session.mission.status).toBe('active')
    osgExitMeasure()
    expect(getOperationalGraphSnapshot().mode).toBe('mission')
  })

  it('exit mission clears session bindings', () => {
    osgEnterMission({ missionName: 'Done', kind: 'solo' })
    osgExitMission('test')
    const snap = getOperationalGraphSnapshot()
    expect(snap.mode).toBe('idle')
    expect(snap.session.mission.status).toBe('inactive')
    expect(snap.session.routeId).toBeNull()
  })

  it('transition engine records control metadata', () => {
    transitionOperationalState({ mode: 'navigation' }, 'test_nav')
    const snap = getOperationalGraphSnapshot()
    expect(snap.mode).toBe('navigation')
    expect(snap.interaction.pointerOwner).toBe('map')
    expect(snap.control.transitionSource).toBe('test_nav')
    expect(snap.control.lastTransition).toBeGreaterThan(0)
  })

  it('resolves blocked direct transitions via idle while preserving measure session', () => {
    osgEnterMeasure('balanced')
    osgAddMeasurePoint(1, 2)
    const measureId = getOperationalGraphSnapshot().session.activeMeasurement?.id
    expect(transitionOperationalState({ mode: 'route' }, 'blocked_direct')).toBe(true)
    const snap = getOperationalGraphSnapshot()
    expect(snap.mode).toBe('route')
    expect(snap.session.activeMeasurement?.points).toHaveLength(1)
    expect(snap.session.activeMeasurement?.id).toBe(measureId)
    expect(snap.interaction.pointerOwner).toBe('route')
  })

  it('exposes transition validation on debug surface', () => {
    osgEnterRouteMode('balanced', 'plan')
    const v = canTransitionOperationalMode('measure')
    expect(v.allowed).toBe(true)
    expect(v.resolvedPath).toEqual(['idle', 'measure'])
  })
})
