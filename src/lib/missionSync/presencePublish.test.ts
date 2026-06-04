import { describe, expect, it } from 'vitest'
import { buildStabilizedTeamPresence } from './presencePublish'

describe('presencePublish', () => {
  it('snaps position when GPS jitter is below movement gate', () => {
    const last = buildStabilizedTeamPresence({
      deviceId: 'a',
      callsign: 'Alpha',
      lat: 40,
      lng: -105,
      accuracy: 8,
      lastPublished: null,
    })
    const next = buildStabilizedTeamPresence({
      deviceId: 'a',
      callsign: 'Alpha',
      lat: 40.00001,
      lng: -105.00001,
      accuracy: 8,
      speedMph: 4,
      speedMps: 2,
      headingDeg: 90,
      lastPublished: last,
    })
    expect(next.lat).toBe(40)
    expect(next.lng).toBe(-105)
    expect(next.speedMph).toBeUndefined()
  })
})
