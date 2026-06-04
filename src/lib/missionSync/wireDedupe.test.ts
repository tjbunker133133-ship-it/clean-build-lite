import { describe, expect, it } from 'vitest'
import { SyncWireDedupe } from './wireDedupe'
import type { MissionSnapshot } from './types'

describe('SyncWireDedupe', () => {
  it('drops duplicate snapshots within 60s', () => {
    const d = new SyncWireDedupe()
    const snap: MissionSnapshot = {
      missionId: 'm1',
      missionName: 'Test',
      revision: 1,
      updatedAt: Date.now(),
      hostDeviceId: 'host',
      sourceDeviceId: 'dev-a',
      sourceCallsign: 'Alpha',
      waypoints: [],
      snapToTrailEnabled: false,
    }
    expect(d.accept({ type: 'snapshot', payload: snap })).toBe(true)
    expect(d.accept({ type: 'snapshot', payload: snap })).toBe(false)
  })

  it('allows ping and presence through', () => {
    const d = new SyncWireDedupe()
    expect(d.accept({ type: 'ping', deviceId: 'x', sentAt: 1 })).toBe(true)
    expect(
      d.accept({
        type: 'presence',
        payload: { deviceId: 'x', callsign: 'X', lat: 1, lng: 2, accuracy: 5, updatedAt: 1 },
      }),
    ).toBe(true)
  })
})
