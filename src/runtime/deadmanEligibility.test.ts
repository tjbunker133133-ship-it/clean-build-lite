import { describe, expect, it } from 'vitest'
import { classifyDeadmanDispatchEligibility } from './deadmanEligibility'

describe('classifyDeadmanDispatchEligibility', () => {
  it('classifies already dispatched lock first', () => {
    expect(
      classifyDeadmanDispatchEligibility({
        alreadyDispatched: true,
        alreadySentInMount: false,
        contactCount: 2,
        endpoint: 'https://example.com',
      }),
    ).toEqual({ dispatchReady: false, reason: 'already_dispatched' })
  })

  it('classifies missing contacts and endpoint', () => {
    expect(
      classifyDeadmanDispatchEligibility({
        alreadyDispatched: false,
        alreadySentInMount: false,
        contactCount: 0,
        endpoint: 'https://example.com',
      }),
    ).toEqual({ dispatchReady: false, reason: 'no_contacts' })
    expect(
      classifyDeadmanDispatchEligibility({
        alreadyDispatched: false,
        alreadySentInMount: false,
        contactCount: 2,
        endpoint: '',
      }),
    ).toEqual({ dispatchReady: false, reason: 'no_endpoint' })
  })

  it('returns ready only when all guards pass', () => {
    expect(
      classifyDeadmanDispatchEligibility({
        alreadyDispatched: false,
        alreadySentInMount: false,
        contactCount: 1,
        endpoint: 'https://example.com',
      }),
    ).toEqual({ dispatchReady: true, reason: 'ready' })
  })
})

