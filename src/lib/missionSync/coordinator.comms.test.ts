import { describe, expect, it, vi } from 'vitest'
import { MissionSyncCoordinator } from './coordinator'

describe('MissionSyncCoordinator comms relay', () => {
  it('relays check-in and burst to other peers', () => {
    const onCheckIn = vi.fn()
    const onBurst = vi.fn()
    const coord = new MissionSyncCoordinator({
      missionId: 'msn_test',
      missionName: 'Test',
      joinToken: 'tok',
      hostDeviceId: 'host1',
      hostCallsign: 'Host',
      role: 'member',
      callbacks: { onCheckIn, onBurst },
    })

    const sendA = vi.fn()
    const sendB = vi.fn()
    ;(coord as unknown as { peers: Map<string, unknown> }).peers = new Map([
      ['a', { meta: { peerId: 'a' }, session: { send: sendA } }],
      ['b', { meta: { peerId: 'b' }, session: { send: sendB } }],
    ])

    coord.sendCheckIn({ deviceId: 'd1', callsign: 'Alpha', sentAt: Date.now() })
    expect(sendA).toHaveBeenCalled()
    expect(sendB).toHaveBeenCalled()

    const checkInMsg = sendA.mock.calls[0]![0]
    ;(coord as unknown as { handleWireMessage: (m: unknown, id: string) => void }).handleWireMessage(
      checkInMsg,
      'a',
    )
    expect(onCheckIn).toHaveBeenCalled()
    expect(sendB).toHaveBeenCalledTimes(2)
  })
})
