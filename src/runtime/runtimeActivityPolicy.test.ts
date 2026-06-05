import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetRuntimeActivityForTests,
  deriveRuntimeActivityLevel,
  runtimePollIntervalMs,
  syncRuntimeActivityFromLifecycle,
} from './runtimeActivityPolicy'

describe('runtimeActivityPolicy', () => {
  beforeEach(() => {
    _resetRuntimeActivityForTests()
  })

  it('maps hidden lifecycle to BACKGROUND', () => {
    expect(deriveRuntimeActivityLevel('hidden')).toBe('BACKGROUND')
    expect(syncRuntimeActivityFromLifecycle('background')).toBe('BACKGROUND')
  })

  it('maps foreground to ACTIVE when recently engaged', () => {
    expect(deriveRuntimeActivityLevel('foreground')).toBe('ACTIVE')
  })

  it('slows dcrl sync in BACKGROUND', () => {
    syncRuntimeActivityFromLifecycle('hidden')
    expect(runtimePollIntervalMs('dcrl_sync')).toBe(120_000)
    syncRuntimeActivityFromLifecycle('foreground')
    expect(runtimePollIntervalMs('dcrl_sync')).toBe(30_000)
  })
})
