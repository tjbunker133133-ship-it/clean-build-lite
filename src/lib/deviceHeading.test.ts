import { describe, expect, it } from 'vitest'
import {
  getScreenOrientationAngle,
  headingDelta,
  headingToCardinal,
  isCompassTiltUnreliable,
  normalizeHeading,
  resolveOrientationHeading,
  shouldPublishHeading,
  smoothHeading,
} from './deviceHeading'

describe('deviceHeading', () => {
  it('normalizes negative and overflow angles', () => {
    expect(normalizeHeading(-10)).toBe(350)
    expect(normalizeHeading(370)).toBe(10)
  })

  it('computes shortest delta across wrap', () => {
    expect(headingDelta(350, 10)).toBe(20)
    expect(headingDelta(10, 350)).toBe(-20)
  })

  it('smooths along the short arc', () => {
    expect(smoothHeading(350, 10, 0.5)).toBe(0)
    expect(smoothHeading(340, 10, 0.5)).toBe(355)
  })

  it('maps cardinals at 45° steps', () => {
    expect(headingToCardinal(0)).toBe('N')
    expect(headingToCardinal(90)).toBe('E')
  })

  it('flags flat and edge tilt as unreliable', () => {
    expect(isCompassTiltUnreliable(10, 0)).toBe(true)
    expect(isCompassTiltUnreliable(80, 10)).toBe(false)
    expect(isCompassTiltUnreliable(90, 75)).toBe(true)
  })

  it('throttles small frequent updates', () => {
    expect(shouldPublishHeading(10, 12, 1000, 900, 6, 320)).toBe(false)
    expect(shouldPublishHeading(10, 20, 1500, 900, 6, 320)).toBe(true)
  })

  it('resolveOrientationHeading prefers webkit compass on iOS-style events', () => {
    const h = resolveOrientationHeading({
      alpha: 200,
      webkitCompassHeading: 12,
    } as unknown as DeviceOrientationEvent)
    expect(h).toBe(12)
  })

  it('resolveOrientationHeading uses alpha for absolute earth frame (north = 0)', () => {
    const h = resolveOrientationHeading({
      alpha: 0,
      absolute: true,
    } as unknown as DeviceOrientationEvent)
    expect(h).toBe(getScreenOrientationAngle())
  })

  it('resolveOrientationHeading inverts relative alpha (legacy Android)', () => {
    const h = resolveOrientationHeading({
      alpha: 90,
      absolute: false,
    } as unknown as DeviceOrientationEvent)
    expect(h).toBe(normalizeHeading(270 + getScreenOrientationAngle()))
  })
})
