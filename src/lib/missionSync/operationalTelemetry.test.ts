import { describe, expect, it, beforeEach } from 'vitest'
import {
  _resetMissionOperationalEventsForTests,
  getMissionOperationalEvents,
  recordMissionOperationalEvent,
} from './operationalTelemetry'

describe('operationalTelemetry', () => {
  beforeEach(() => {
    _resetMissionOperationalEventsForTests()
  })

  it('records bounded operational events without PII fields', () => {
    recordMissionOperationalEvent('link_recovery_start')
    recordMissionOperationalEvent('relay_degraded', 'quiet')
    const events = getMissionOperationalEvents()
    expect(events).toHaveLength(2)
    expect(events[0]?.kind).toBe('link_recovery_start')
    expect(events[1]?.detail).toBe('quiet')
  })

  it('caps rolling buffer', () => {
    for (let i = 0; i < 25; i++) {
      recordMissionOperationalEvent('visibility_foreground')
    }
    expect(getMissionOperationalEvents().length).toBeLessThanOrEqual(20)
  })
})
