import { describe, expect, it, vi } from 'vitest'
import { MissionSyncCoordinator } from './coordinator'
import { isObserverOffer } from './linkRole'

describe('MissionSyncCoordinator observer', () => {
  it('mints observer token when missing on restored missions', () => {
    const coord = new MissionSyncCoordinator({
      missionId: 'm1',
      missionName: 'Test',
      joinToken: 'join123',
      hostDeviceId: 'host1',
      hostCallsign: 'Alpha',
      role: 'member',
      callbacks: {},
    })
    expect(coord.observerToken).toBe('')
    const token = coord.ensureObserverToken()
    expect(token.length).toBeGreaterThan(8)
    expect(coord.observerToken).toBe(token)
  })

  it('observer offer packet shape uses separate token and linkRole', async () => {
    const coord = new MissionSyncCoordinator({
      missionId: 'm1',
      missionName: 'Test',
      joinToken: 'join123',
      observerToken: 'obs_secret_token',
      hostDeviceId: 'host1',
      hostCallsign: 'Alpha',
      role: 'member',
      callbacks: {},
    })
    const createOfferSlot = vi
      .fn()
      .mockResolvedValue({
        packet: {
          t: 'mission-offer' as const,
          v: 1,
          missionId: 'm1',
          missionName: 'Test',
          joinToken: '',
          observerToken: 'obs_secret_token',
          linkRole: 'observer' as const,
          hostDeviceId: 'host1',
          hostCallsign: 'Alpha',
          peerId: 'peer_x',
          sdp: { type: 'offer' as const, sdp: '' },
        },
        encoded: 'HUDMS1:test',
        peerId: 'peer_x',
      })
    ;(coord as unknown as { createOfferSlot: typeof createOfferSlot }).createOfferSlot = createOfferSlot

    const { packet } = await coord.createObserverOffer()
    expect(createOfferSlot).toHaveBeenCalledWith('observer', 'internet')
    expect(packet.linkRole).toBe('observer')
    expect(packet.observerToken).toBe('obs_secret_token')
    expect(packet.joinToken).toBe('')
    expect(isObserverOffer(packet)).toBe(true)
  })

  it('ignores inbound wire messages from observer peers', () => {
    const onSnapshot = vi.fn()
    const coord = new MissionSyncCoordinator({
      missionId: 'm1',
      missionName: 'Test',
      joinToken: 'join123',
      observerToken: 'obs',
      hostDeviceId: 'host1',
      hostCallsign: 'Alpha',
      role: 'member',
      callbacks: { onSnapshot },
    })
    ;(coord as unknown as { peers: Map<string, unknown> }).peers.set('obs_peer', {
      meta: {
        peerId: 'obs_peer',
        deviceId: 'obs1',
        callsign: 'Watcher',
        connectedAt: Date.now(),
        linkRole: 'observer',
      },
      session: { send: vi.fn() },
    })
    ;(coord as unknown as { handleWireMessage: (m: unknown, id: string) => void }).handleWireMessage(
      {
        type: 'snapshot',
        payload: {
          missionId: 'm1',
          missionName: 'Test',
          revision: 2,
          updatedAt: Date.now(),
          hostDeviceId: 'host1',
          sourceDeviceId: 'bad',
          sourceCallsign: 'Bad',
          waypoints: [],
        },
      },
      'obs_peer',
    )
    expect(onSnapshot).not.toHaveBeenCalled()
  })
})
