import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../push/webPushConfig', () => ({
  resolveRescuePushEndpoint: () => '',
}))

import { formatRescuePushSuffix, postRescuePushBestEffort } from './postRescuePush'

describe('postRescuePush', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('localStorage', {
      getItem: () => null,
    })
  })

  it('skips when push URL missing', async () => {
    const result = await postRescuePushBestEffort({
      triggerType: 'SOS',
      timestamp: new Date().toISOString(),
      coordinates: null,
      contacts: [{ name: 'A', email: 'a@test.com' }],
      source: 'tactical-hud',
      signature: 'abc',
      alertWatchToken: 'token1234567890ab',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('skipped')
  })

  it('formats push suffix', () => {
    expect(formatRescuePushSuffix({ ok: true, status: 200, sentCount: 2 })).toBe(' (+ push ×2)')
    expect(formatRescuePushSuffix({ ok: false, reason: 'skipped' })).toBe('')
  })
})
