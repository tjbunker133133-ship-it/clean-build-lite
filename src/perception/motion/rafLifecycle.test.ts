import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetRafLifecycleStatsForTests,
  getRafLifecycleStats,
  recordBackgroundSkip,
  recordRafTick,
} from './rafLifecycle'

describe('rafLifecycle', () => {
  beforeEach(() => {
    __resetRafLifecycleStatsForTests()
  })

  it('tracks tick and background skip counters', () => {
    recordRafTick()
    recordRafTick()
    recordBackgroundSkip()
    const stats = getRafLifecycleStats()
    expect(stats.totalTicks).toBe(2)
    expect(stats.skippedBackgroundTicks).toBe(1)
    expect(stats.activeLoopCount).toBe(0)
  })
})
