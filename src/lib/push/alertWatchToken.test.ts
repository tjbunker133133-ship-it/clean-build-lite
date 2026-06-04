import { describe, expect, it, vi, beforeEach } from 'vitest'
import { isValidAlertWatchToken, loadOrCreateAlertWatchToken, normalizeContactEmail } from './alertWatchToken'

describe('alertWatchToken', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem(key: string) {
        return store[key] ?? null
      },
      setItem(key: string, value: string) {
        store[key] = value
      },
    })
  })

  it('creates and reloads token', () => {
    const token = loadOrCreateAlertWatchToken()
    expect(isValidAlertWatchToken(token)).toBe(true)
    expect(loadOrCreateAlertWatchToken()).toBe(token)
  })

  it('normalizes email', () => {
    expect(normalizeContactEmail('  Test@Example.COM ')).toBe('test@example.com')
  })
})
