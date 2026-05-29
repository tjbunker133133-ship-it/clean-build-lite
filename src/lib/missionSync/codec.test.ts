import { describe, expect, it } from 'vitest'
import { decodeMissionPacket, encodeMissionPacket } from './codec'
import type { MissionOfferPacket } from './types'

describe('missionSync codec', () => {
  it('round-trips offer packets', () => {
    const packet: MissionOfferPacket = {
      t: 'mission-offer',
      v: 1,
      missionId: 'msn_test',
      missionName: 'Field Test',
      joinToken: 'tok123',
      hostDeviceId: 'host1',
      hostCallsign: 'Alpha',
      peerId: 'slot1',
      sdp: { type: 'offer', sdp: 'v=0\r\n' },
    }
    const encoded = encodeMissionPacket(packet)
    const decoded = decodeMissionPacket(encoded)
    expect(decoded).toEqual(packet)
  })
})
