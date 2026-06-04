import { describe, expect, it } from 'vitest'
import { buildCommsStatus } from './commsStatus'

describe('buildCommsStatus', () => {
  it('warns when profile incomplete', () => {
    const lines = buildCommsStatus({
      operationalReady: false,
      contactCount: 0,
      rescueEndpointReady: true,
      pushAlertsReady: false,
      missionRole: 'idle',
      monitorLive: false,
    })
    expect(lines.find((l) => l.key === 'profile')?.state).toBe('warn')
  })

  it('shows observer waiting state', () => {
    const lines = buildCommsStatus({
      operationalReady: true,
      contactCount: 2,
      rescueEndpointReady: true,
      pushAlertsReady: true,
      pushSubscriberCount: 1,
      missionRole: 'observer',
      monitorLive: false,
      observerWaiting: true,
    })
    expect(lines.find((l) => l.key === 'mission')?.detail).toContain('Waiting')
  })
})
