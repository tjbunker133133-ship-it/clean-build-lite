import { describe, expect, it } from 'vitest'
import { appReducer } from './AppContext'
import type { AppState } from '../types'

const base: AppState = {
  waypoints: [],
  activeLayer: 'outdoor',
  selectedWaypointId: null,
  pendingWaypointType: 'default',
  nextWaypointLabel: '',
  keepWaypointToolArmed: false,
  clearLabelAfterDrop: true,
  showMapLabels: true,
  showMapDistances: true,
  snapToTrailEnabled: false,
  trailSnapAssistCapable: false,
  deadManTimeLeft: 300,
  deadManActive: false,
}

describe('appReducer trail snap actions', () => {
  it('SET_TRAIL_SNAP_ASSIST_CAPABLE updates capability from MapCanvas sync', () => {
    const next = appReducer(base, { type: 'SET_TRAIL_SNAP_ASSIST_CAPABLE', payload: true })
    expect(next.trailSnapAssistCapable).toBe(true)
  })

  it('SET_TRAIL_SNAP_ASSIST_CAPABLE does not toggle operator snap preference', () => {
    const armed = { ...base, snapToTrailEnabled: true }
    const next = appReducer(armed, { type: 'SET_TRAIL_SNAP_ASSIST_CAPABLE', payload: true })
    expect(next.snapToTrailEnabled).toBe(true)
    expect(next.trailSnapAssistCapable).toBe(true)
  })
})
