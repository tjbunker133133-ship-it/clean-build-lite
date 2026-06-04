import { describe, expect, it } from 'vitest'
import { publishJoinCodeAnswerWithRetry } from './missionJoinSignaling'

describe('publishJoinCodeAnswerWithRetry', () => {
  it('returns false when code is incomplete', async () => {
    const ok = await publishJoinCodeAnswerWithRetry(
      { code: 'AB', encoded: 'bundle', fromDeviceId: 'dev-a' },
      2,
    )
    expect(ok).toBe(false)
  })
})
