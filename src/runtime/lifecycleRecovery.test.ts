import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetLifecycleRecoveryForTests,
  getLifecycleRecoveryStats,
} from './lifecycleRecovery'

describe('lifecycleRecovery', () => {
  beforeEach(() => {
    __resetLifecycleRecoveryForTests()
  })

  it('starts with zero resumes', () => {
    const stats = getLifecycleRecoveryStats()
    expect(stats.resumeCount).toBe(0)
    expect(stats.integrityOk).toBe(true)
  })
})
