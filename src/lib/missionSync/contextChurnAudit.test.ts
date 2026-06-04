import { describe, expect, it } from 'vitest'
import {
  MISSION_SYNC_CONTEXT_CHURN_AUDIT,
  summarizeContextChurnAudit,
} from './contextChurnAudit'

describe('contextChurnAudit', () => {
  it('documents monolithic provider as accepted high-severity hotspot', () => {
    const mono = MISSION_SYNC_CONTEXT_CHURN_AUDIT.find((h) => h.id === 'monolithic-value')
    expect(mono?.severity).toBe('high')
    expect(mono?.status).toBe('accepted')
  })

  it('marks derived comms filter mitigation', () => {
    const filter = MISSION_SYNC_CONTEXT_CHURN_AUDIT.find((h) => h.id === 'inline-filter-comms')
    expect(filter?.status).toBe('mitigated')
  })

  it('summarizes audit counts', () => {
    const s = summarizeContextChurnAudit()
    expect(s.total).toBe(MISSION_SYNC_CONTEXT_CHURN_AUDIT.length)
    expect(s.mitigated).toBeGreaterThan(0)
  })
})
