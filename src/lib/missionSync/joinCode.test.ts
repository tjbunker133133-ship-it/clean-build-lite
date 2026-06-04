import { describe, expect, it } from 'vitest'
import { joinCodeFromToken, joinCodesMatch, normalizeJoinCodeInput, formatJoinCode, isValidJoinCodeInput } from './joinCode'

describe('joinCode', () => {
  it('formats stable code from token', () => {
    const a = joinCodeFromToken('abc123xyz')
    const b = joinCodeFromToken('abc123xyz')
    expect(a).toBe(b)
    expect(a).toMatch(/^[23456789A-Z]{3}-[23456789A-Z]{3}$/)
  })

  it('matches normalized user input', () => {
    const token = 'field-mission-token'
    const code = joinCodeFromToken(token)
    expect(joinCodesMatch(token, code)).toBe(true)
    expect(joinCodesMatch(token, normalizeJoinCodeInput(code))).toBe(true)
  })

  it('validates and formats user input', () => {
    expect(isValidJoinCodeInput('ABC-123')).toBe(true)
    expect(formatJoinCode('abc123')).toBe('ABC-123')
    expect(isValidJoinCodeInput('AB')).toBe(false)
  })
})
