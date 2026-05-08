import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enqueueRoutineCheckIn, readCheckInOutbox } from './checkInOutbox'
import { flushRoutineCheckInOutbox } from './sendRoutineCheckInOrQueue'
import { ROUTINE_CHECKIN_SCHEMA } from './routineCheckInTypes'
import type { RoutineCheckInPayload } from './routineCheckInTypes'
import * as submit from './submitRoutineCheckIn'
import { installMemoryLocalStorage } from './testMemoryLocalStorage'

vi.mock('./submitRoutineCheckIn', () => ({
  submitRoutineCheckIn: vi.fn(),
}))

function samplePayload(): RoutineCheckInPayload {
  return {
    schema: ROUTINE_CHECKIN_SCHEMA,
    sentAt: 1,
    kind: 'beacon',
    lat: 44,
    lng: -122,
    accuracyM: 20,
    elevationM: null,
    message: null,
    contacts: [{ name: 'Q', email: 'q@example.com' }],
  }
}

describe('flushRoutineCheckInOutbox', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    localStorage.clear()
    vi.mocked(submit.submitRoutineCheckIn).mockReset()
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  })

  it('sends queued items and clears on success', async () => {
    vi.mocked(submit.submitRoutineCheckIn).mockResolvedValue({ ok: true })
    enqueueRoutineCheckIn(samplePayload())
    const r = await flushRoutineCheckInOutbox()
    expect(r.sent).toBe(1)
    expect(r.remaining).toBe(0)
    expect(readCheckInOutbox()).toHaveLength(0)
  })

  it('retains queue entries when submit fails', async () => {
    vi.mocked(submit.submitRoutineCheckIn).mockResolvedValue({ ok: false, error: 'network' })
    enqueueRoutineCheckIn(samplePayload())
    const r = await flushRoutineCheckInOutbox()
    expect(r.sent).toBe(0)
    expect(r.remaining).toBe(1)
    expect(readCheckInOutbox()).toHaveLength(1)
  })
})
