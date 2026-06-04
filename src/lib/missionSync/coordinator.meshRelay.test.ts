import { describe, expect, it, vi } from 'vitest'
import { MissionSyncCoordinator } from './coordinator'

describe('MissionSyncCoordinator mesh relay token', () => {
  it('includes observerToken on field member join offers for internet fallback', async () => {
    const coord = new MissionSyncCoordinator({
      missionId: 'm1',
      missionName: 'Test',
      joinToken: 'join123',
      observerToken: 'relay_secret',
      hostDeviceId: 'host1',
      hostCallsign: 'Alpha',
      role: 'member',
      callbacks: {},
    })
    const createOfferSlot = vi.fn().mockImplementation(async (linkRole: string) => {
      const meshRelayToken = coord.ensureObserverToken()
      return {
        packet: {
          t: 'mission-offer' as const,
          v: 1,
          missionId: 'm1',
          missionName: 'Test',
          joinToken: linkRole === 'member' ? 'join123' : '',
          observerToken: meshRelayToken,
          linkRole,
          hostDeviceId: 'host1',
          hostCallsign: 'Alpha',
          peerId: 'peer_x',
          sdp: { type: 'offer' as const, sdp: '' },
        },
        encoded: 'HUDMS1:test',
        peerId: 'peer_x',
      }
    })
    ;(coord as unknown as { createOfferSlot: typeof createOfferSlot }).createOfferSlot =
      createOfferSlot

    const { packet } = await coord.createJoinOffer()
    expect(packet.observerToken).toBe('relay_secret')
    expect(packet.joinToken).toBe('join123')
    expect(packet.linkRole).toBe('member')
  })
})
