import { describe, expect, it } from 'vitest'
import { fieldWalkWatcherSummary } from './fieldTestGuide'

describe('fieldTestGuide', () => {
  it('summarizes watchers and mesh', () => {
    expect(fieldWalkWatcherSummary(1, 0)).toContain('1 watcher')
    expect(fieldWalkWatcherSummary(1, 2)).toContain('teammate')
  })
})
