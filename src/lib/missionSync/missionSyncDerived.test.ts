import { describe, expect, it } from 'vitest'
import {
  computeFilteredTeamComms,
  computeMissionRelayFlags,
  computeMissionQrFitFlags,
  computeObserverCount,
  computeTeamCommsReady,
} from './missionSyncDerived'

describe('missionSyncDerived', () => {
  it('computes relay flags for member with token', () => {
    const f = computeMissionRelayFlags({
      missionId: 'm1',
      observerToken: 'tok',
      observerSignalingAvailable: true,
      role: 'member',
    })
    expect(f.missionRelayActive).toBe(true)
    expect(f.monitorRelayActive).toBe(true)
  })

  it('computes observer count', () => {
    expect(
      computeObserverCount([
        { peerId: 'a', deviceId: 'd1', callsign: 'A', connectedAt: 0, linkRole: 'observer' },
        { peerId: 'b', deviceId: 'd2', callsign: 'B', connectedAt: 0, linkRole: 'member' },
      ]),
    ).toBe(1)
  })

  it('computes team comms ready on relay-only member', () => {
    expect(
      computeTeamCommsReady({
        role: 'member',
        peerCount: 0,
        missionRelayActive: false,
        monitorRelayActive: true,
      }),
    ).toBe(true)
  })

  it('filters stale check-ins in derived comms slice', () => {
    const now = Date.now()
    const { teamCheckIns } = computeFilteredTeamComms(
      [{ deviceId: 'd', callsign: 'A', sentAt: now - 400_000 }],
      [],
    )
    expect(teamCheckIns).toHaveLength(0)
  })

  it('computes QR fit flags', () => {
    const flags = computeMissionQrFitFlags({
      pendingOfferEncoded: null,
      pendingAnswerEncoded: null,
      pendingObserverOfferEncoded: null,
    })
    expect(flags.pendingOfferFitsQr).toBe(false)
  })
})
