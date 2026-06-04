import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOpenMeteoBackoff,
  isOpenMeteoBackoffActive,
  openMeteoBackoffRemainingMs,
  recordOpenMeteoRateLimit,
} from './panelDataBackoff'

beforeEach(() => {
  clearOpenMeteoBackoff()
  vi.useRealTimers()
})

describe('panelDataBackoff', () => {
  it('blocks Open-Meteo calls for 15 minutes after rate limit', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-28T12:00:00Z'))
    expect(isOpenMeteoBackoffActive()).toBe(false)
    recordOpenMeteoRateLimit()
    expect(isOpenMeteoBackoffActive()).toBe(true)
    expect(openMeteoBackoffRemainingMs()).toBeGreaterThan(14 * 60_000)
    vi.advanceTimersByTime(16 * 60_000)
    expect(isOpenMeteoBackoffActive()).toBe(false)
  })
})
