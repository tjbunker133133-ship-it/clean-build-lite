import { describe, expect, it } from 'vitest'
import { getRescueEligibility } from './eligibility'

describe('getRescueEligibility', () => {
  it('requires at least one contact', () => {
    expect(getRescueEligibility({ contactCount: 0, endpoint: 'https://x' })).toEqual({
      dispatchReady: false,
      reason: 'no_contacts',
    })
  })

  it('requires endpoint when contacts exist', () => {
    expect(getRescueEligibility({ contactCount: 2, endpoint: '' })).toEqual({
      dispatchReady: false,
      reason: 'no_endpoint',
    })
  })

  it('reports ready only when both contacts and endpoint exist', () => {
    expect(getRescueEligibility({ contactCount: 2, endpoint: 'https://x' })).toEqual({
      dispatchReady: true,
      reason: 'ready',
    })
  })
})
