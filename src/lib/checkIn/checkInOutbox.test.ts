import { describe, it, expect, beforeEach } from 'vitest'
import { enqueueRoutineCheckIn, readCheckInOutbox, replaceCheckInOutbox } from './checkInOutbox'
import { ROUTINE_CHECKIN_SCHEMA } from './routineCheckInTypes'
import type { RoutineCheckInPayload } from './routineCheckInTypes'
import { installMemoryLocalStorage } from './testMemoryLocalStorage'

function samplePayload(): RoutineCheckInPayload {
  return {
    schema: ROUTINE_CHECKIN_SCHEMA,
    sentAt: 1,
    kind: 'manual',
    lat: 45.1,
    lng: -121.2,
    accuracyM: 12,
    elevationM: 900,
    message: 'ok',
    contacts: [{ name: 'Pat', email: 'pat@example.com' }],
  }
}

describe('checkInOutbox', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    localStorage.clear()
  })

  it('enqueues and reads in order', () => {
    const id = enqueueRoutineCheckIn(samplePayload())
    const q = readCheckInOutbox()
    expect(q).toHaveLength(1)
    expect(q[0].id).toBe(id)
    expect(q[0].payload.lat).toBe(45.1)
  })

  it('replaceCheckInOutbox overwrites queue', () => {
    enqueueRoutineCheckIn(samplePayload())
    replaceCheckInOutbox([])
    expect(readCheckInOutbox()).toHaveLength(0)
  })
})
