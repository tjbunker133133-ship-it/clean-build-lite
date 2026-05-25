import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  TIER1_LOCKED_SHA256,
  TIER1_GPS_POLL_MS,
  TIER1_SOS_HOLD_MS,
  auditCorridorWidth,
  auditProductionSosHold,
  auditTier1ReferenceHtml,
  readTier1ReferenceFromRepo,
  runTier1ContractAudit,
  sha256Hex,
} from './tier1Contract'
import { readFileSync } from 'node:fs'

const ROOT = resolve(import.meta.dirname, '../..')

describe('Tier 1 contract (reference + production invariants)', () => {
  it('locked tier1-hud.html hash matches .cursorrules', () => {
    const source = readTier1ReferenceFromRepo(ROOT)
    expect(sha256Hex(source)).toBe(TIER1_LOCKED_SHA256)
  })

  it('reference HTML preserves GPS poll, SOS hold, vault order, and offline I/O', () => {
    const source = readTier1ReferenceFromRepo(ROOT)
    const audit = auditTier1ReferenceHtml(source)
    expect(audit.failures).toEqual([])
  })

  it('production SOS panel keeps 3s sustained slide hold', () => {
    const sos = readFileSync(resolve(ROOT, 'src/hud/SOSPanel.tsx'), 'utf8')
    const audit = auditProductionSosHold(sos)
    expect(audit.failures).toEqual([])
  })

  it('mission corridor remains 2-mile total width (5280 ft half-width)', () => {
    const audit = auditCorridorWidth()
    expect(audit.failures).toEqual([])
  })

  it('full Tier 1 contract audit passes (hardening gate)', () => {
    const audit = runTier1ContractAudit(ROOT)
    expect(audit.failures).toEqual([])
  })

  it('documents canonical timing constants for hardening checklist', () => {
    expect(TIER1_GPS_POLL_MS).toBe(120_000)
    expect(TIER1_SOS_HOLD_MS).toBe(3_000)
  })
})
