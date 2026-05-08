import { describe, expect, it } from 'vitest'
import { classifyBuildFreshness } from './buildFreshness'

describe('classifyBuildFreshness', () => {
  it('detects runtime mismatch as stale suspicion', () => {
    const out = classifyBuildFreshness({
      currentBuildId: 'A',
      runtimeBuildId: 'B',
      lastSeenBuildId: 'A',
    })
    expect(out.runtimeMismatch).toBe(true)
    expect(out.staleRuntimeSuspected).toBe(true)
  })

  it('detects changed build since last boot', () => {
    const out = classifyBuildFreshness({
      currentBuildId: 'B',
      runtimeBuildId: 'B',
      lastSeenBuildId: 'A',
    })
    expect(out.changedSinceLastBoot).toBe(true)
    expect(out.staleRuntimeSuspected).toBe(true)
  })

  it('reports healthy when build IDs align', () => {
    const out = classifyBuildFreshness({
      currentBuildId: 'A',
      runtimeBuildId: 'A',
      lastSeenBuildId: 'A',
    })
    expect(out.changedSinceLastBoot).toBe(false)
    expect(out.runtimeMismatch).toBe(false)
    expect(out.staleRuntimeSuspected).toBe(false)
  })
})
