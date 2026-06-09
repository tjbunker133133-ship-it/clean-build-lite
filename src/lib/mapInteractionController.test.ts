import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetMapInteractionControllerForTests,
  addMeasurePoint,
  clearInteractionMode,
  enterDropMode,
  enterMeasure,
  exitMeasure,
  getBalancedToolFromOsg,
  getInteractionMode,
  getMeasurePoints,
  getPointerOwner,
  routeMapClick,
  setPendingWaypointType,
  setRadialInteractionActive,
  shouldBlockLongPress,
  shouldBlockTrailInspect,
  shouldBlockWaypointPlacement,
  syncBalancedTool,
} from './mapInteractionController'

describe('mapInteractionController', () => {
  beforeEach(() => {
    __resetMapInteractionControllerForTests()
  })

  it('enters measure mode with pointer ownership', () => {
    enterMeasure('balanced')
    expect(getInteractionMode()).toBe('measure')
    expect(getPointerOwner()).toBe('measure')
    expect(shouldBlockWaypointPlacement()).toBe(true)
    expect(shouldBlockLongPress()).toBe(true)
    expect(shouldBlockTrailInspect()).toBe(true)
  })

  it('completes measure after two taps and releases interaction', () => {
    enterMeasure('modern')
    expect(routeMapClick(40, -105)).toBe(true)
    expect(routeMapClick(41, -105)).toBe(true)
    expect(getMeasurePoints()).toHaveLength(2)
    expect(getInteractionMode()).toBe('none')
    expect(shouldBlockLongPress()).toBe(false)
    expect(routeMapClick(42, -106)).toBe(false)
    expect(getMeasurePoints()).toHaveLength(2)
  })

  it('blocks waypoint placement while measuring and restores on exit', () => {
    enterMeasure('balanced')
    expect(shouldBlockWaypointPlacement()).toBe(true)
    exitMeasure('test')
    expect(getInteractionMode()).toBe('none')
    expect(shouldBlockWaypointPlacement()).toBe(false)
  })

  it('radial temporarily owns pointer and restores measure mode', () => {
    enterMeasure('modern')
    addMeasurePoint(1, 2)
    setRadialInteractionActive(true)
    expect(getPointerOwner()).toBe('radial')
    expect(routeMapClick(3, 4)).toBe(false)
    setRadialInteractionActive(false)
    expect(getInteractionMode()).toBe('measure')
    expect(getPointerOwner()).toBe('measure')
    expect(getMeasurePoints()).toHaveLength(1)
  })

  it('syncBalancedTool maps workspace tools to interaction modes', () => {
    syncBalancedTool('route')
    expect(getInteractionMode()).toBe('route')
    syncBalancedTool('measure')
    expect(getInteractionMode()).toBe('measure')
    syncBalancedTool('waypoint')
    setPendingWaypointType('pin')
    expect(getBalancedToolFromOsg()).toBe('waypoint')
    expect(getInteractionMode()).toBe('drop')
    expect(shouldBlockWaypointPlacement()).toBe(false)
    expect(shouldBlockLongPress()).toBe(false)
    clearInteractionMode('test')
    syncBalancedTool('inspect')
    expect(getInteractionMode()).toBe('inspect')
    expect(shouldBlockLongPress()).toBe(true)
    setPendingWaypointType('pin')
    expect(shouldBlockWaypointPlacement()).toBe(false)
    enterDropMode('balanced')
    expect(shouldBlockWaypointPlacement()).toBe(false)
  })
})
