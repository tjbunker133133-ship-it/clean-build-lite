import { describe, expect, it } from 'vitest'
import { MESH_AUTO_RECONNECT_MS, shouldAttemptMeshAutoReconnect } from './missionMeshRecovery'

describe('missionMeshRecovery', () => {
  it('exports a sane reconnect interval', () => {
    expect(MESH_AUTO_RECONNECT_MS).toBeGreaterThanOrEqual(10_000)
    expect(MESH_AUTO_RECONNECT_MS).toBeLessThanOrEqual(60_000)
  })

  it('attempts reconnect for active field member with no peers', () => {
    expect(
      shouldAttemptMeshAutoReconnect({
        role: 'member',
        missionId: 'm1',
        peerCount: 0,
        online: true,
        phase: 'connected',
      }),
    ).toBe(true)
  })

  it('skips when mission idle, offline, peers present, observer, or failed', () => {
    const base = {
      role: 'member' as const,
      missionId: 'm1',
      peerCount: 0,
      online: true,
      phase: 'connected' as const,
    }
    expect(shouldAttemptMeshAutoReconnect({ ...base, missionId: null })).toBe(false)
    expect(shouldAttemptMeshAutoReconnect({ ...base, role: 'observer' })).toBe(false)
    expect(shouldAttemptMeshAutoReconnect({ ...base, peerCount: 2 })).toBe(false)
    expect(shouldAttemptMeshAutoReconnect({ ...base, online: false })).toBe(false)
    expect(shouldAttemptMeshAutoReconnect({ ...base, phase: 'failed' })).toBe(false)
    expect(shouldAttemptMeshAutoReconnect({ ...base, phase: 'idle' })).toBe(false)
  })
})
