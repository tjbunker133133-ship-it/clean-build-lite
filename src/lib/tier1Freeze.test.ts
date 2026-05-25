import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { auditTier1BaselineManifest } from './tier1Freeze'
import {
  TIER2_EXCLUDED_CAPABILITIES,
  TIER2_EXCLUDED_PATHS,
  TIER1_FREEZE_ID,
  TIER1_LOCKED_SYSTEMS,
} from './tier1FreezeBoundaries'

const ROOT = resolve(import.meta.dirname, '../..')

describe('Tier 1 freeze boundaries', () => {
  it('documents locked systems and Tier 2 exclusions', () => {
    expect(TIER1_LOCKED_SYSTEMS.length).toBeGreaterThanOrEqual(6)
    expect(TIER2_EXCLUDED_PATHS.length).toBeGreaterThanOrEqual(8)
    expect(TIER2_EXCLUDED_CAPABILITIES.length).toBeGreaterThanOrEqual(8)
  })

  it('production baseline manifest matches working tree', () => {
    const audit = auditTier1BaselineManifest(ROOT)
    expect(audit.failures).toEqual([])
  })

  it('freeze id is stable', () => {
    expect(TIER1_FREEZE_ID).toBe('tier1-field-proven-2026-05-24')
  })
})
