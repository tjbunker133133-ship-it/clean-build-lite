import { describe, expect, it } from 'vitest'
import {
  summarizeWearableInventory,
  WEARABLE_FIELD_SMOKE_CHECKLIST,
  WEARABLE_SURFACE_INVENTORY,
  WEARABLE_TIER2_ROLE_RECOMMENDATIONS,
} from './wearablesFieldValidation'

describe('wearablesFieldValidation', () => {
  it('documents verified wearable surfaces', () => {
    expect(WEARABLE_SURFACE_INVENTORY.length).toBeGreaterThanOrEqual(8)
    const panel = WEARABLE_SURFACE_INVENTORY.find((e) => e.id === 'wearables-panel')
    expect(panel?.classification).toBe('OPERATIONAL')
    expect(panel?.wiredTo.some((w) => w.includes('App.tsx'))).toBe(true)
  })

  it('marks mission watch comms as unused (phone-only today)', () => {
    const gap = WEARABLE_SURFACE_INVENTORY.find((e) => e.id === 'mission-watch-comms')
    expect(gap?.classification).toBe('UNUSED')
  })

  it('includes field smoke checklist for connection and lifecycle', () => {
    expect(WEARABLE_FIELD_SMOKE_CHECKLIST.some((s) => s.area === 'connection')).toBe(true)
    expect(WEARABLE_FIELD_SMOKE_CHECKLIST.some((s) => s.area === 'lifecycle')).toBe(true)
    expect(WEARABLE_FIELD_SMOKE_CHECKLIST.some((s) => s.id === 'push-test')).toBe(true)
  })

  it('recommends deferring mission burst watch push', () => {
    const defer = WEARABLE_TIER2_ROLE_RECOMMENDATIONS.find(
      (r) => r.capability.includes('team burst'),
    )
    expect(defer?.tier).toBe('TIER2_DEFER')
  })

  it('summarizes inventory counts', () => {
    const s = summarizeWearableInventory()
    expect(s.OPERATIONAL).toBeGreaterThan(0)
  })
})
