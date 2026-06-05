import { describe, expect, it } from 'vitest'
import {
  evaluateInMissionReadiness,
  evaluatePreMissionReadiness,
} from './missionReadiness'

describe('missionReadiness', () => {
  it('marks browser tab as degraded pre-mission', () => {
    const r = evaluatePreMissionReadiness({
      webrtcSupported: true,
      isStandalone: false,
      micPermission: 'prompt',
      notificationPermission: 'prompt',
      wakeLockSupported: true,
      online: true,
    })
    expect(r.band).toBe('degraded')
    expect(r.checks.find((c) => c.id === 'install')?.severity).toBe('warn')
  })

  it('blocks pre-mission when WebRTC unsupported', () => {
    const r = evaluatePreMissionReadiness({
      webrtcSupported: false,
      isStandalone: true,
      micPermission: 'granted',
      notificationPermission: 'granted',
      wakeLockSupported: true,
      online: true,
    })
    expect(r.band).toBe('no-go')
    expect(r.advisoryOnly).toBe(false)
  })

  it('shows relay-only member connection in mission', () => {
    const r = evaluateInMissionReadiness({
      role: 'member',
      phase: 'connected',
      peerCount: 0,
      fieldMemberCount: 0,
      observerCallsigns: [],
      teamCommsReady: true,
      mapReady: false,
      monitorLive: false,
      monitorTargetCallsign: '',
      monitorTransport: 'idle',
      isStandalone: true,
      wakeLockSupported: true,
      wakeLockHeld: true,
      wakeLockWanted: true,
      linkRecoveryPending: false,
      relayLinkState: 'active',
      online: true,
    })
    const conn = r.checks.find((c) => c.id === 'connection')
    expect(conn?.detail).toContain('Relay linked')
    expect(conn?.severity).toBe('ok')
  })

  it('surfaces link recovery pending', () => {
    const r = evaluateInMissionReadiness({
      role: 'member',
      phase: 'connected',
      peerCount: 1,
      fieldMemberCount: 1,
      observerCallsigns: [],
      teamCommsReady: true,
      mapReady: true,
      monitorLive: false,
      monitorTargetCallsign: '',
      monitorTransport: 'idle',
      isStandalone: true,
      wakeLockSupported: true,
      wakeLockHeld: false,
      wakeLockWanted: true,
      linkRecoveryPending: true,
      relayLinkState: 'active',
      online: true,
    })
    expect(r.checks.some((c) => c.id === 'recovery')).toBe(true)
    expect(r.checks.find((c) => c.id === 'wake-lock')?.severity).toBe('warn')
  })

  it('surfaces relay degraded when recovery timed out', () => {
    const r = evaluateInMissionReadiness({
      role: 'member',
      phase: 'connected',
      peerCount: 0,
      fieldMemberCount: 0,
      observerCallsigns: [],
      teamCommsReady: true,
      mapReady: false,
      monitorLive: false,
      monitorTargetCallsign: '',
      monitorTransport: 'relay',
      isStandalone: true,
      wakeLockSupported: true,
      wakeLockHeld: true,
      wakeLockWanted: true,
      linkRecoveryPending: false,
      relayLinkState: 'degraded',
      online: true,
    })
    expect(r.checks.some((c) => c.id === 'relay-health')).toBe(true)
  })
})
