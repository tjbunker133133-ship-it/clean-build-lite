import { describe, expect, it } from 'vitest'
import { filterTeammatePresence, isPresenceFixValid } from './presence'

describe('mission presence', () => {
  it('filters self and stale fixes', () => {
    const now = Date.now()
    const out = filterTeammatePresence(
      [
        {
          deviceId: 'self',
          callsign: 'Me',
          lat: 40,
          lng: -105,
          accuracy: 5,
          updatedAt: now,
        },
        {
          deviceId: 'peer1',
          callsign: 'Alpha',
          lat: 40.01,
          lng: -105.01,
          accuracy: 8,
          updatedAt: now - 1000,
        },
        {
          deviceId: 'peer2',
          callsign: 'Stale',
          lat: 40,
          lng: -105,
          accuracy: 5,
          updatedAt: now - 120_000,
        },
      ],
      'self',
      now,
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.callsign).toBe('Alpha')
  })

  it('rejects invalid coordinates', () => {
    expect(
      isPresenceFixValid({
        deviceId: 'x',
        callsign: 'X',
        lat: null,
        lng: -105,
        accuracy: null,
        updatedAt: Date.now(),
      }),
    ).toBe(false)
  })
})
