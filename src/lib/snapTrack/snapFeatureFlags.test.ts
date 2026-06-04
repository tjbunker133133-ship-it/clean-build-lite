import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readSnapFeatureFlags,
  resetSnapFeatureFlagsCacheForTests,
} from './snapFeatureFlags'

describe('snapFeatureFlags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetSnapFeatureFlagsCacheForTests()
  })

  it('defaults pipeline off, validation and diagnostics on', () => {
    vi.stubEnv('VITE_ENABLE_SNAP_PIPELINE', '')
    vi.stubEnv('VITE_ENABLE_SNAP_VALIDATION', '')
    vi.stubEnv('VITE_ENABLE_SNAP_DIAGNOSTICS', '')
    resetSnapFeatureFlagsCacheForTests()
    expect(readSnapFeatureFlags()).toEqual({
      pipelineEnabled: false,
      validationEnabled: true,
      diagnosticsEnabled: true,
    })
  })

  it('parses boolean env strings', async () => {
    const { parseSnapEnvBoolForTests } = await import('./snapFeatureFlags')
    expect(parseSnapEnvBoolForTests('true', false)).toBe(true)
    expect(parseSnapEnvBoolForTests('0', true)).toBe(false)
    expect(parseSnapEnvBoolForTests('', true)).toBe(true)
  })
})
