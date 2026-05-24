import { describe, expect, it, vi } from 'vitest'
import {
  isWaypointMarkerTouchActive,
  setWaypointMarkerTouchActive,
} from './waypointMarkerTouchGate'

describe('waypointMarkerTouchGate', () => {
  it('tracks marker touch sessions with post-release grace', () => {
    vi.useFakeTimers()
    setWaypointMarkerTouchActive(false)
    vi.advanceTimersByTime(600)
    expect(isWaypointMarkerTouchActive()).toBe(false)
    setWaypointMarkerTouchActive(true)
    expect(isWaypointMarkerTouchActive()).toBe(true)
    setWaypointMarkerTouchActive(false)
    expect(isWaypointMarkerTouchActive()).toBe(true)
    vi.advanceTimersByTime(600)
    expect(isWaypointMarkerTouchActive()).toBe(false)
    vi.useRealTimers()
  })
})
