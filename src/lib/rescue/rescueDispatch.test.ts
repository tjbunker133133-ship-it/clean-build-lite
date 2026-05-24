import { describe, expect, it } from 'vitest'
import {
  buildRescueDispatchHeaders,
  classifyRescueDispatchKey,
  hasRescueDispatchAuth,
  parseRescueDispatchFailure,
} from './rescueDispatch'

describe('rescueDispatch headers', () => {
  it('uses apikey + Bearer for legacy JWT anon keys', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
    expect(classifyRescueDispatchKey(jwt)).toBe('jwt')
    const headers = buildRescueDispatchHeaders(jwt)
    expect(headers.apikey).toBe(jwt)
    expect(headers.Authorization).toBe(`Bearer ${jwt}`)
  })

  it('uses apikey only for publishable keys (no Bearer)', () => {
    const pk = 'sb_publishable_test_key'
    expect(classifyRescueDispatchKey(pk)).toBe('publishable')
    const headers = buildRescueDispatchHeaders(pk)
    expect(headers.apikey).toBe(pk)
    expect(headers.Authorization).toBeUndefined()
  })

  it('reports missing auth when anon key is absent', () => {
    expect(hasRescueDispatchAuth('')).toBe(false)
    const headers = buildRescueDispatchHeaders('')
    expect(headers.apikey).toBeUndefined()
    expect(headers.Authorization).toBeUndefined()
  })
})

describe('parseRescueDispatchFailure', () => {
  it('maps legacy missing_signature error to signing key mismatch message', async () => {
    const res = new Response(JSON.stringify({ ok: false, error: 'missing_signature' }), {
      status: 401,
    })
    const fail = await parseRescueDispatchFailure(res, 'SOS')
    expect(fail.code).toBe('INVALID_SIGNATURE')
    expect(fail.operatorMessage).toContain('SIGNING KEY MISMATCH')
  })
})
