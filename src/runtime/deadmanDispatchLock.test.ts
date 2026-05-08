import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  clearDeadmanDispatchLock,
  DEADMAN_DISPATCH_LOCK_KEY,
  recordDeadmanDispatchSuccess,
  shouldSkipDeadmanDispatch,
} from './deadmanDispatchLock'

function stubSessionStorage() {
  const m = new Map<string, string>()
  vi.stubGlobal(
    'sessionStorage',
    {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v)
      },
      removeItem: (k: string) => {
        m.delete(k)
      },
      clear: () => {
        m.clear()
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() {
        return m.size
      },
    } as Storage,
  )
}

describe('deadmanDispatchLock', () => {
  beforeEach(() => {
    stubSessionStorage()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not skip when nothing recorded', () => {
    expect(shouldSkipDeadmanDispatch(12345)).toBe(false)
  })

  it('skips when session matches expiresAt', () => {
    const t = 99_001
    sessionStorage.setItem(DEADMAN_DISPATCH_LOCK_KEY, String(t))
    expect(shouldSkipDeadmanDispatch(t)).toBe(true)
    expect(shouldSkipDeadmanDispatch(t + 1)).toBe(false)
  })

  it('recordDeadmanDispatchSuccess writes stable key', () => {
    recordDeadmanDispatchSuccess(42)
    expect(sessionStorage.getItem(DEADMAN_DISPATCH_LOCK_KEY)).toBe('42')
  })

  it('clearDeadmanDispatchLock removes guard', () => {
    recordDeadmanDispatchSuccess(7)
    clearDeadmanDispatchLock()
    expect(sessionStorage.getItem(DEADMAN_DISPATCH_LOCK_KEY)).toBeNull()
  })

  // Public-API round-trip: this is the actual operational invariant the
  // deadman dispatch path relies on (record after success → skip on next
  // attempt for the SAME expiresAt → do NOT skip after a new episode
  // [different expiresAt] → unblock cleanly after clear). If any of these
  // four steps drift, duplicate-send prevention silently breaks.
  it('record → skip-same → no-skip-different → clear → no-skip (full lifecycle)', () => {
    const expiry = 1_700_000_000_000
    expect(shouldSkipDeadmanDispatch(expiry)).toBe(false)
    recordDeadmanDispatchSuccess(expiry)
    expect(shouldSkipDeadmanDispatch(expiry)).toBe(true)
    expect(shouldSkipDeadmanDispatch(expiry + 1)).toBe(false)
    clearDeadmanDispatchLock()
    expect(shouldSkipDeadmanDispatch(expiry)).toBe(false)
  })
})
