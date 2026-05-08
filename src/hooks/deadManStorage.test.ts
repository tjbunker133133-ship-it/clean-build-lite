import { describe, expect, it } from 'vitest'
import { parseDeadManStorageRaw } from './useDeadMan'

describe('parseDeadManStorageRaw (trailmap_deadman_v1)', () => {
  it('returns null for invalid JSON', () => {
    expect(parseDeadManStorageRaw('{not json')).toBeNull()
  })

  it('returns null when expiresAt is NaN or non-finite', () => {
    expect(parseDeadManStorageRaw(JSON.stringify({ expiresAt: NaN, extended: false }))).toBeNull()
    expect(parseDeadManStorageRaw(JSON.stringify({ expiresAt: Infinity, extended: false }))).toBeNull()
    expect(parseDeadManStorageRaw(JSON.stringify({ expiresAt: 'x', extended: false }))).toBeNull()
  })

  it('returns null when durationMs is non-finite (drops durationMs, still invalid expiresAt)', () => {
    expect(
      parseDeadManStorageRaw(
        JSON.stringify({ expiresAt: NaN, extended: false, durationMs: 3600000 }),
      ),
    ).toBeNull()
  })

  it('accepts valid payload and strips invalid durationMs', () => {
    const now = Date.now() + 60_000
    const a = parseDeadManStorageRaw(
      JSON.stringify({ expiresAt: now, extended: true, durationMs: NaN }),
    )
    expect(a).not.toBeNull()
    expect(a!.expiresAt).toBe(now)
    expect(a!.extended).toBe(true)
    expect(a!.durationMs).toBeUndefined()
  })

  it('accepts numeric-string expiresAt (legacy coercion parity)', () => {
    const t = Date.now() + 120_000
    const a = parseDeadManStorageRaw(JSON.stringify({ expiresAt: String(t), extended: false }))
    expect(a!.expiresAt).toBe(t)
  })

  it('accepts finite durationMs', () => {
    const now = Date.now() + 120_000
    const a = parseDeadManStorageRaw(
      JSON.stringify({ expiresAt: now, extended: false, durationMs: 7_200_000 }),
    )
    expect(a!.durationMs).toBe(7_200_000)
  })
})
