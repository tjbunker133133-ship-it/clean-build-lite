import { describe, expect, it } from 'vitest'
import { formatBuildLabel } from './buildLabel'

describe('formatBuildLabel', () => {
  it('formats ISO timestamps for display', () => {
    expect(formatBuildLabel('2026-05-24T14:45:23.456Z')).toBe('2026-05-24 14:45')
  })

  it('shows short git commit ids', () => {
    expect(formatBuildLabel('2986adc')).toBe('2986adc')
  })

  it('returns unknown for empty input', () => {
    expect(formatBuildLabel('')).toBe('unknown')
  })
})
