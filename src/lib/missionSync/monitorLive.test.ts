import { describe, expect, it } from 'vitest'
import { isMonitorSessionLive } from './monitorLive'

describe('isMonitorSessionLive', () => {
  const now = 1_000_000

  it('is live on relay with recent sync', () => {
    expect(
      isMonitorSessionLive({
        role: 'observer',
        phase: 'connecting',
        peerCount: 0,
        monitorTransport: 'relay',
        lastSyncAt: now - 5_000,
        nowMs: now,
      }),
    ).toBe(true)
  })

  it('is not live without recent sync', () => {
    expect(
      isMonitorSessionLive({
        role: 'observer',
        phase: 'connected',
        peerCount: 1,
        monitorTransport: 'direct',
        lastSyncAt: now - 60_000,
        nowMs: now,
      }),
    ).toBe(false)
  })
})
