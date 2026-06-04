import { describe, expect, it } from 'vitest'
import { parseDeadManStorageRaw, resolveDeadManBootState } from './useDeadMan'

describe('parseDeadManStorageRaw (trailmap_deadman_v1)', () => {
  it('returns null for invalid JSON', () => {
    expect(parseDeadManStorageRaw('{not json')).toBeNull()
  })

  it('returns null when armed but expiresAt missing', () => {
    expect(parseDeadManStorageRaw(JSON.stringify({ armed: true, extended: false }))).toBeNull()
  })

  it('accepts standby prefs without expiresAt', () => {
    const a = parseDeadManStorageRaw(JSON.stringify({ armed: false, durationMs: 3_600_000 }))
    expect(a).not.toBeNull()
    expect(a!.armed).toBe(false)
    expect(a!.durationMs).toBe(3_600_000)
  })

  it('returns null when expiresAt is NaN or non-finite', () => {
    expect(parseDeadManStorageRaw(JSON.stringify({ armed: true, expiresAt: NaN, extended: false }))).toBeNull()
    expect(parseDeadManStorageRaw(JSON.stringify({ armed: true, expiresAt: Infinity, extended: false }))).toBeNull()
    expect(parseDeadManStorageRaw(JSON.stringify({ armed: true, expiresAt: 'x', extended: false }))).toBeNull()
  })

  it('accepts valid armed payload', () => {
    const now = Date.now() + 60_000
    const a = parseDeadManStorageRaw(
      JSON.stringify({ armed: true, expiresAt: now, extended: true, durationMs: 7_200_000 }),
    )
    expect(a).not.toBeNull()
    expect(a!.armed).toBe(true)
    expect(a!.expiresAt).toBe(now)
    expect(a!.extended).toBe(true)
    expect(a!.durationMs).toBe(7_200_000)
  })

  it('accepts numeric-string expiresAt (legacy coercion parity)', () => {
    const t = Date.now() + 120_000
    const a = parseDeadManStorageRaw(JSON.stringify({ armed: true, expiresAt: String(t), extended: false }))
    expect(a!.expiresAt).toBe(t)
  })
})

describe('resolveDeadManBootState', () => {
  it('does not auto-start from legacy storage without armed flag', () => {
    const now = Date.now()
    const future = now + 3_600_000
    const boot = resolveDeadManBootState(
      { expiresAt: future, extended: false, durationMs: 3_600_000 },
      now,
    )
    expect(boot.active).toBe(false)
  })

  it('resumes only when explicitly armed with valid expiry', () => {
    const now = Date.now()
    const future = now + 3_600_000
    const boot = resolveDeadManBootState(
      { armed: true, expiresAt: future, extended: false, durationMs: 3_600_000 },
      now,
    )
    expect(boot.active).toBe(true)
    expect(boot.expiresAt).toBe(future)
  })

  it('standby when armed but expired', () => {
    const now = Date.now()
    const boot = resolveDeadManBootState(
      { armed: true, expiresAt: now - 1_000, extended: false, durationMs: 3_600_000 },
      now,
    )
    expect(boot.active).toBe(false)
  })
})
