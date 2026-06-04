import { describe, expect, it } from 'vitest'
import { joinCodeChannelName } from './missionJoinCodeChannel'
import { joinCodeFromToken } from './joinCode'

describe('missionJoinCodeChannel', () => {
  it('maps normalized codes to stable channel names', () => {
    const a = joinCodeChannelName('ABC123')
    const b = joinCodeChannelName('abc-123')
    expect(a).toBe(b)
    expect(a.startsWith('mission-code-')).toBe(true)
  })

  it('joinCodeFromToken never uses ambiguous 0/1', () => {
    const code = joinCodeFromToken('join_test_token_xyz')
    expect(code).toMatch(/^[23456789A-Z]{3}-[23456789A-Z]{3}$/)
  })
})
