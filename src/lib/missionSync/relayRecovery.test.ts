import { describe, expect, it } from 'vitest'
import {
  evaluateRelayLinkState,
  isRelayFresh,
  linkRecoveryStatusLabel,
  resolveLinkRecoveryTimeout,
  resolvePeerDisconnectRecovery,
  RELAY_FRESH_MS,
  LINK_RECOVERY_TIMEOUT_MS,
} from './relayRecovery'

describe('relayRecovery', () => {
  const now = 1_000_000

  it('defines aligned freshness and recovery timeout windows', () => {
    expect(RELAY_FRESH_MS).toBe(45_000)
    expect(LINK_RECOVERY_TIMEOUT_MS).toBeGreaterThan(RELAY_FRESH_MS)
  })

  it('detects fresh relay activity', () => {
    expect(isRelayFresh(now - 10_000, now)).toBe(true)
    expect(isRelayFresh(now - RELAY_FRESH_MS, now)).toBe(false)
    expect(isRelayFresh(0, now)).toBe(false)
  })

  it('prefers mesh peers as active relay state', () => {
    expect(
      evaluateRelayLinkState({
        relayLastAtMs: 0,
        peerCount: 1,
        missionRelayActive: false,
        observerSignalingAvailable: false,
        online: false,
        nowMs: now,
      }),
    ).toBe('active')
  })

  it('marks relay degraded when online but stale', () => {
    expect(
      evaluateRelayLinkState({
        relayLastAtMs: now - 60_000,
        peerCount: 0,
        missionRelayActive: true,
        observerSignalingAvailable: false,
        online: true,
        nowMs: now,
      }),
    ).toBe('degraded')
  })

  it('resolves observer disconnect to relay when fresh', () => {
    const r = resolvePeerDisconnectRecovery({
      isObserver: true,
      isFieldMember: false,
      relayLastAtMs: now - 5_000,
      missionRelayActive: true,
      observerSignalingAvailable: true,
      nowMs: now,
    })
    expect(r.phase).toBe('connected')
    expect(r.linkRecoveryPending).toBe(false)
    expect(r.monitorTransport).toBe('relay')
  })

  it('starts recovery when member mesh drops without relay', () => {
    const r = resolvePeerDisconnectRecovery({
      isObserver: false,
      isFieldMember: true,
      relayLastAtMs: 0,
      missionRelayActive: false,
      observerSignalingAvailable: false,
      nowMs: now,
    })
    expect(r.linkRecoveryPending).toBe(true)
    expect(r.phase).toBe('awaiting-joiner')
  })

  it('times out member recovery to reconnect guidance', () => {
    const r = resolveLinkRecoveryTimeout({
      relayLastAtMs: now - 60_000,
      peerCount: 0,
      missionRelayActive: true,
      observerSignalingAvailable: true,
      online: true,
      role: 'member',
      nowMs: now,
    })
    expect(r.linkRecoveryPending).toBe(false)
    expect(r.relayLinkState).toBe('degraded')
    expect(r.notifyMessage).toContain('Reconnect mesh')
  })

  it('labels recovery vs degraded states', () => {
    expect(linkRecoveryStatusLabel({ linkRecoveryPending: true, relayLinkState: 'active' })).toContain(
      'Reconnecting',
    )
    expect(linkRecoveryStatusLabel({ linkRecoveryPending: false, relayLinkState: 'degraded' })).toContain(
      'degraded',
    )
  })
})
