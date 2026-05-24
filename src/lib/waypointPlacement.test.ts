import { describe, expect, it } from 'vitest'
import { isWaypointPlacementAllowed } from './waypointPlacement'

describe('isWaypointPlacementAllowed', () => {
  it('blocks when the waypoint panel is docked', () => {
    expect(isWaypointPlacementAllowed(true, 'pin')).toBe(false)
  })

  it('blocks when disarmed (default pending type)', () => {
    expect(isWaypointPlacementAllowed(false, 'default')).toBe(false)
  })

  it('allows placement when undocked and armed', () => {
    expect(isWaypointPlacementAllowed(false, 'water')).toBe(true)
  })
})
