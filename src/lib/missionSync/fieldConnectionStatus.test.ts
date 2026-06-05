import { describe, expect, it } from 'vitest'
import {
  buildMemberConnectionStatus,
  buildObserverConnectionStatus,
} from './fieldConnectionStatus'

describe('fieldConnectionStatus', () => {
  it('labels member mesh when peers connected', () => {
    const s = buildMemberConnectionStatus({
      phase: 'connected',
      peerCount: 2,
      fieldMemberCount: 1,
      observerCallsigns: ['Home'],
      teamCommsReady: true,
      mapReady: true,
    })
    expect(s.label).toContain('Mesh 1 teammate')
    expect(s.label).toContain('Home watching')
    expect(s.live).toBe(true)
    expect(s.supplement).toBeNull()
  })

  it('labels member relay-only when comms ready without peers', () => {
    const s = buildMemberConnectionStatus({
      phase: 'connected',
      peerCount: 0,
      fieldMemberCount: 0,
      observerCallsigns: [],
      teamCommsReady: true,
      mapReady: false,
    })
    expect(s.label).toBe('Relay linked · team comms active')
    expect(s.live).toBe(true)
    expect(s.supplement).toContain('internet relay')
  })

  it('labels observer relay waiting when linked but not live', () => {
    const s = buildObserverConnectionStatus({
      phase: 'connected',
      monitorLive: false,
      monitorTargetCallsign: 'Alpha-1',
      teamCommsReady: true,
      peerCount: 0,
      monitorTransport: 'relay',
    })
    expect(s.label).toBe('Monitor · relay linked')
    expect(s.supplement).toContain('Team comms active')
  })

  it('includes transport supplement when observer is live', () => {
    const s = buildObserverConnectionStatus({
      phase: 'connected',
      monitorLive: true,
      monitorTargetCallsign: 'Alpha-1',
      teamCommsReady: true,
      peerCount: 0,
      monitorTransport: 'relay',
    })
    expect(s.live).toBe(true)
    expect(s.supplement).toBe('Internet relay')
  })
})
