import { describe, expect, it } from 'vitest'
import {
  classifyStaleRuntimeReason,
  createForceUpdateMeta,
  mergeForceUpdateMeta,
} from './forceUpdateMeta'

describe('forceUpdateMeta', () => {
  it('creates deterministic initial force-update metadata', () => {
    expect(createForceUpdateMeta({ requestedAt: 1000, requestBuildId: 'b1' })).toEqual({
      requestedAt: 1000,
      requestBuildId: 'b1',
      controllerChangeObserved: false,
      reloadRequested: false,
    })
  })

  it('merges patch values into valid existing metadata', () => {
    const merged = mergeForceUpdateMeta(
      {
        requestedAt: 1000,
        requestBuildId: 'b1',
        controllerChangeObserved: false,
        reloadRequested: false,
      },
      {
        controllerChangeObserved: true,
        controllerChangeAt: 1200,
      },
    )
    expect(merged.controllerChangeObserved).toBe(true)
    expect(merged.controllerChangeAt).toBe(1200)
    expect(merged.requestBuildId).toBe('b1')
  })
})

describe('classifyStaleRuntimeReason', () => {
  it('returns none when runtime matches current build', () => {
    expect(
      classifyStaleRuntimeReason({
        currentBuildId: 'b2',
        runtimeBuildId: 'b2',
        lastSeenBuildId: 'b2',
      }),
    ).toEqual({ staleRuntimeSuspected: false, reason: 'none' })
  })

  it('classifies runtime mismatch and changed-since-last-boot distinctly', () => {
    expect(
      classifyStaleRuntimeReason({
        currentBuildId: 'b2',
        runtimeBuildId: 'b1',
        lastSeenBuildId: 'b0',
      }),
    ).toEqual({
      staleRuntimeSuspected: true,
      reason: 'runtime_mismatch_and_build_changed',
    })
  })

  it('classifies missing runtime build id as stale suspicion', () => {
    expect(
      classifyStaleRuntimeReason({
        currentBuildId: 'b2',
        runtimeBuildId: '',
        lastSeenBuildId: 'b2',
      }),
    ).toEqual({ staleRuntimeSuspected: true, reason: 'runtime_missing' })
  })
})
