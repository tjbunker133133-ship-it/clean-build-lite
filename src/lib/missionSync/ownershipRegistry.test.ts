import { describe, expect, it } from 'vitest'
import {
  assertOwnershipRegistryComplete,
  MISSION_CONTINUITY_CONTRACTS,
  MISSION_SYNC_OWNERSHIP,
} from './ownershipRegistry'

describe('ownershipRegistry', () => {
  it('covers required orchestration domains', () => {
    const { ok, missing } = assertOwnershipRegistryComplete()
    expect(ok).toBe(true)
    expect(missing).toEqual([])
  })

  it('points orchestrator at MissionSyncContext', () => {
    const orch = MISSION_SYNC_OWNERSHIP.find((e) => e.domain === 'orchestration')
    expect(orch?.owner).toContain('MissionSyncContext')
  })

  it('isolates relay recovery from coordinator', () => {
    const recovery = MISSION_SYNC_OWNERSHIP.find((e) => e.domain === 'recovery')
    expect(recovery?.owner).toContain('relayRecovery')
    expect(recovery?.doNotAddLogicTo).toContain('coordinator.ts')
  })

  it('links continuity contract modules', () => {
    expect(MISSION_CONTINUITY_CONTRACTS.some((c) => c.id === 'relay-recovery')).toBe(true)
    expect(MISSION_CONTINUITY_CONTRACTS.some((c) => c.id === 'mission-restore')).toBe(true)
  })
})
