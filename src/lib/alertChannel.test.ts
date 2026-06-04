import { describe, expect, it } from 'vitest'
import { contactWantsEmail, contactWantsPush, normalizeAlertChannel } from './alertChannel'

describe('alertChannel', () => {
  it('defaults unknown to both', () => {
    expect(normalizeAlertChannel(undefined)).toBe('both')
    expect(normalizeAlertChannel('nope')).toBe('both')
  })

  it('splits email vs push preferences', () => {
    expect(contactWantsEmail('email')).toBe(true)
    expect(contactWantsEmail('push')).toBe(false)
    expect(contactWantsPush('push')).toBe(true)
    expect(contactWantsPush('email')).toBe(false)
    expect(contactWantsEmail('both')).toBe(true)
    expect(contactWantsPush('both')).toBe(true)
  })
})
