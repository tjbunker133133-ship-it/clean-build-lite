import { describe, expect, it } from 'vitest'
import { buildWatchMeUrl, parseWatchMeLocation } from './monitorInviteUrl'

describe('monitorInviteUrl', () => {
  it('round-trips mission+token params', () => {
    const parsed = parseWatchMeLocation(
      '?mission=mission-abc&token=obs_secret_token_12&name=Saturday%20hike',
    )
    expect(parsed?.kind).toBe('token')
    if (parsed?.kind === 'token') {
      expect(parsed.missionId).toBe('mission-abc')
      expect(parsed.token).toBe('obs_secret_token_12')
      expect(parsed.missionName).toBe('Saturday hike')
    }
  })
})
