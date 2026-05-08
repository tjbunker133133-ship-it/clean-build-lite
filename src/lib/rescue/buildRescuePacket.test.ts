import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

// Stable, fast unit tests that lock the contract-sensitive surface of the
// rescue dispatch builder. These tests are deliberately narrow: they exercise
// only the frontend side (canonical JSON, HMAC hex, packet shape, graceful
// degradation). The Deno edge function is covered indirectly because it
// re-derives identical bytes from the same canonical-JSON algorithm — so
// keeping THIS algorithm pinned keeps the wire contract pinned.

vi.mock('../emergencyContacts', () => {
  return {
    fetchEmergencyContacts: vi.fn(),
  }
})

import { fetchEmergencyContacts } from '../emergencyContacts'
import {
  buildRescuePacket,
  canonicalJSON,
  hmacSha256Hex,
  rescuePacketDevLogSummary,
} from './buildRescuePacket'

const mockedFetch = fetchEmergencyContacts as unknown as ReturnType<typeof vi.fn>

// `import.meta.env.VITE_*` access is statically replaced at transform time
// by Vite, so we can't override it from the test. Instead, we read whatever
// signing key is loaded at test-runtime and verify the contract is
// self-consistent. This still catches any change to canonical-JSON
// semantics, signing algorithm, or packet shape.
const importMetaEnv = (import.meta as unknown as { env: Record<string, string | undefined> }).env
const RUNTIME_SIGNING_KEY = (importMetaEnv.VITE_RESCUE_SIGNING_KEY ?? '').trim()

const SAMPLE_CONTACTS = [
  {
    id: '1',
    operator_id: null,
    contact_name: 'Alice Operator',
    email: 'alice@example.com',
    relationship: 'lead',
    priority: 1,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: '2',
    operator_id: null,
    contact_name: 'Bob Operator',
    email: 'bob@example.com',
    relationship: 'backup',
    priority: 2,
    created_at: '2026-01-02T00:00:00Z',
  },
]

beforeEach(() => {
  mockedFetch.mockReset()
  mockedFetch.mockResolvedValue({ data: SAMPLE_CONTACTS, error: null })
})

describe('canonicalJSON', () => {
  it('sorts object keys at every level deterministically', () => {
    const a = { b: 1, a: { y: 2, x: 1 } }
    const b = { a: { x: 1, y: 2 }, b: 1 }
    expect(canonicalJSON(a)).toBe(canonicalJSON(b))
    expect(canonicalJSON(a)).toBe('{"a":{"x":1,"y":2},"b":1}')
  })

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalJSON([3, 1, 2])).toBe('[3,1,2]')
  })

  it('handles primitives and null', () => {
    expect(canonicalJSON(null)).toBe('null')
    expect(canonicalJSON('hi')).toBe('"hi"')
    expect(canonicalJSON(true)).toBe('true')
    expect(canonicalJSON(false)).toBe('false')
    expect(canonicalJSON(42)).toBe('42')
  })

  it('emits "null" for non-finite numbers (no NaN/Infinity in JSON)', () => {
    expect(canonicalJSON(Number.NaN)).toBe('null')
    expect(canonicalJSON(Number.POSITIVE_INFINITY)).toBe('null')
    expect(canonicalJSON(Number.NEGATIVE_INFINITY)).toBe('null')
  })

  it('produces byte-identical output for two semantically equal packets', () => {
    const p1 = {
      triggerType: 'SOS',
      timestamp: '2026-05-07T20:00:00.000Z',
      coordinates: { lat: 1, lng: 2 },
      contacts: [{ name: 'A', email: 'a@x.com' }],
      source: 'tactical-hud',
    }
    const p2 = {
      source: 'tactical-hud',
      contacts: [{ email: 'a@x.com', name: 'A' }],
      coordinates: { lng: 2, lat: 1 },
      timestamp: '2026-05-07T20:00:00.000Z',
      triggerType: 'SOS',
    }
    expect(canonicalJSON(p1)).toBe(canonicalJSON(p2))
  })

  it('changes output when ANY field byte changes (mutation detection)', () => {
    const base = {
      triggerType: 'SOS',
      timestamp: '2026-05-07T20:00:00.000Z',
      coordinates: { lat: 1, lng: 2 },
      contacts: [{ name: 'A', email: 'a@x.com' }],
      source: 'tactical-hud',
    }
    const baseJson = canonicalJSON(base)
    expect(canonicalJSON({ ...base, triggerType: 'DEADMAN' })).not.toBe(baseJson)
    expect(canonicalJSON({ ...base, timestamp: '2026-05-07T20:00:00.001Z' })).not.toBe(baseJson)
    expect(canonicalJSON({ ...base, coordinates: { lat: 1.0001, lng: 2 } })).not.toBe(baseJson)
    expect(canonicalJSON({
      ...base,
      contacts: [{ name: 'A', email: 'a2@x.com' }],
    })).not.toBe(baseJson)
  })
})

describe('hmacSha256Hex', () => {
  it('round-trips identically to Node crypto HMAC-SHA256 hex', async () => {
    const key = 'unit-test-signing-key'
    const msg = '{"hello":"world"}'
    const ours = await hmacSha256Hex(key, msg)
    const theirs = createHmac('sha256', key).update(msg, 'utf8').digest('hex')
    expect(ours).toBe(theirs)
    expect(ours).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same input', async () => {
    const a = await hmacSha256Hex('k', 'm')
    const b = await hmacSha256Hex('k', 'm')
    expect(a).toBe(b)
  })

  it('produces different output for different messages', async () => {
    const a = await hmacSha256Hex('k', 'a')
    const b = await hmacSha256Hex('k', 'b')
    expect(a).not.toBe(b)
  })
})

describe('buildRescuePacket', () => {
  // The runtime signing key may or may not be set in the test environment;
  // every test below stays self-consistent so it passes either way.
  const skipIfUnsigned = RUNTIME_SIGNING_KEY.length === 0

  it('returns the expected shape', async () => {
    const packet = await buildRescuePacket('SOS')

    expect(packet.triggerType).toBe('SOS')
    expect(packet.source).toBe('tactical-hud')
    expect(typeof packet.timestamp).toBe('string')
    expect(packet.timestamp.length).toBeGreaterThan(0)
    expect(packet.coordinates).toBeNull() // no localStorage in node env
    expect(Array.isArray(packet.contacts)).toBe(true)
    expect(packet.contacts).toEqual([
      { name: 'Alice Operator', email: 'alice@example.com' },
      { name: 'Bob Operator', email: 'bob@example.com' },
    ])
    if (!skipIfUnsigned) {
      expect(typeof packet.signature).toBe('string')
      expect(packet.signature).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it.skipIf(skipIfUnsigned)('signature is a verifiable HMAC of canonicalJSON(packet without signature)', async () => {
    const packet = await buildRescuePacket('SOS')
    expect(packet.signature).toBeDefined()
    const { signature, ...rest } = packet
    const expected = createHmac('sha256', RUNTIME_SIGNING_KEY)
      .update(canonicalJSON(rest), 'utf8')
      .digest('hex')
    expect(signature).toBe(expected)
  })

  it.skipIf(skipIfUnsigned)('produces different signatures for SOS vs DEADMAN with otherwise identical state', async () => {
    const sos = await buildRescuePacket('SOS')
    const dm = await buildRescuePacket('DEADMAN')
    expect(sos.signature).toBeDefined()
    expect(dm.signature).toBeDefined()
    expect(sos.signature).not.toBe(dm.signature)
  })

  it.skipIf(skipIfUnsigned)('canonical input excludes the signature field (signature is appended, not signed-over)', async () => {
    const packet = await buildRescuePacket('SOS')
    expect(packet.signature).toBeDefined()
    const { signature, ...rest } = packet
    // Canonicalizing `rest` must not contain the signature key.
    expect(canonicalJSON(rest)).not.toContain('"signature"')
    // And canonicalizing the WHOLE packet (with signature) must produce
    // different bytes — proving the field is excluded from the HMAC input
    // by construction, not by accident.
    expect(canonicalJSON(packet)).not.toBe(canonicalJSON(rest))
    expect(canonicalJSON(packet)).toContain('"signature"')
    void signature
  })

  it.skipIf(skipIfUnsigned)('signature would NOT verify if any byte of the body changes', async () => {
    const packet = await buildRescuePacket('SOS')
    expect(packet.signature).toBeDefined()
    // Recompute the HMAC over a tampered body; the original signature
    // must not match. This locks the "tamper-detection" property the
    // edge-function gate depends on.
    const { signature: _orig, ...rest } = packet
    const tampered = { ...rest, source: 'attacker-hud' as 'tactical-hud' }
    const tamperedSig = createHmac('sha256', RUNTIME_SIGNING_KEY)
      .update(canonicalJSON(tampered), 'utf8')
      .digest('hex')
    expect(tamperedSig).not.toBe(packet.signature)
    void _orig
  })

  it('degrades gracefully when fetchEmergencyContacts throws', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('network down'))
    const packet = await buildRescuePacket('SOS')
    expect(packet.contacts).toEqual([])
    expect(packet.triggerType).toBe('SOS')
  })

  it('degrades gracefully when fetchEmergencyContacts returns an error', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [], error: new Error('rls') })
    const packet = await buildRescuePacket('SOS')
    expect(packet.contacts).toEqual([])
  })

  it('filters contacts that lack a usable email field', async () => {
    mockedFetch.mockResolvedValueOnce({
      data: [
        { ...SAMPLE_CONTACTS[0] },
        { ...SAMPLE_CONTACTS[1], email: '' },
      ],
      error: null,
    })
    const packet = await buildRescuePacket('SOS')
    expect(packet.contacts).toEqual([
      { name: 'Alice Operator', email: 'alice@example.com' },
    ])
  })

  // RELEASE-FREEZE INVARIANT: `buildRescuePacket` must NEVER reject. Both
  // call sites set their idempotency ref BEFORE awaiting; a thrown error
  // would permanently lock that gate for the current rescue episode and
  // silently suppress dispatch. Every degraded path here MUST resolve
  // with a safe-shape packet so the caller's fetch path can run.
  it('never rejects when fetchEmergencyContacts throws repeatedly (back-to-back)', async () => {
    mockedFetch.mockRejectedValue(new Error('boom-1'))
    await expect(buildRescuePacket('SOS')).resolves.toBeDefined()
    await expect(buildRescuePacket('DEADMAN')).resolves.toBeDefined()
    await expect(buildRescuePacket('SOS')).resolves.toBeDefined()
  })

  it('never rejects when fetchEmergencyContacts returns malformed data', async () => {
    // null data, undefined data, non-array data, throwing during await —
    // all must collapse to contacts: [] and resolve normally.
    mockedFetch.mockResolvedValueOnce({ data: null as unknown as [], error: null })
    const a = await buildRescuePacket('SOS')
    expect(a.contacts).toEqual([])

    mockedFetch.mockResolvedValueOnce({ data: undefined as unknown as [], error: null })
    const b = await buildRescuePacket('SOS')
    expect(b.contacts).toEqual([])

    mockedFetch.mockResolvedValueOnce({ data: 'not-an-array' as unknown as [], error: null })
    const c = await buildRescuePacket('SOS')
    expect(c.contacts).toEqual([])
  })

  it('always returns the canonical packet shape even on the degraded path', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('network'))
    const packet = await buildRescuePacket('DEADMAN')
    expect(packet).toMatchObject({
      triggerType: 'DEADMAN',
      source: 'tactical-hud',
      contacts: [],
    })
    expect(typeof packet.timestamp).toBe('string')
    expect(packet.timestamp.length).toBeGreaterThan(0)
    expect(packet.coordinates).toBeNull()
  })
})

describe('rescuePacketDevLogSummary', () => {
  it('excludes PII, coordinates, and signature material from the summary object', async () => {
    mockedFetch.mockResolvedValue({ data: SAMPLE_CONTACTS, error: null })
    const packet = await buildRescuePacket('SOS')
    const summary = rescuePacketDevLogSummary(packet)
    const json = JSON.stringify(summary)
    expect(json).not.toContain('alice@')
    expect(json).not.toContain('bob@')
    expect(json).not.toContain('example.com')
    expect(summary).not.toHaveProperty('contacts')
    expect(summary).not.toHaveProperty('coordinates')
    expect(summary).not.toHaveProperty('signature')
    expect(summary).toMatchObject({
      triggerType: 'SOS',
      contactCount: 2,
      source: 'tactical-hud',
    })
  })
})
