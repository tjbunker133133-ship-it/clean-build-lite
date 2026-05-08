import type { RoutineCheckInPayload } from './routineCheckInTypes'

const OUTBOX_KEY = 'hud_checkin_outbox_v1'

export type QueuedRoutineCheckIn = {
  id: string
  payload: RoutineCheckInPayload
  enqueuedAt: number
}

function readRaw(): QueuedRoutineCheckIn[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x) =>
        x &&
        typeof x === 'object' &&
        typeof (x as QueuedRoutineCheckIn).id === 'string' &&
        (x as QueuedRoutineCheckIn).payload &&
        typeof (x as QueuedRoutineCheckIn).enqueuedAt === 'number',
    ) as QueuedRoutineCheckIn[]
  } catch {
    return []
  }
}

function writeRaw(rows: QueuedRoutineCheckIn[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(rows))
  } catch (e) {
    console.error('[CheckInOutbox] persist failed', e)
  }
}

export function readCheckInOutbox(): QueuedRoutineCheckIn[] {
  return readRaw().sort((a, b) => a.enqueuedAt - b.enqueuedAt)
}

export function enqueueRoutineCheckIn(payload: RoutineCheckInPayload): string {
  const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const next = [...readRaw(), { id, payload, enqueuedAt: Date.now() }]
  writeRaw(next)
  return id
}

export function removeQueuedRoutineCheckIn(id: string): void {
  writeRaw(readRaw().filter((r) => r.id !== id))
}

export function replaceCheckInOutbox(rows: QueuedRoutineCheckIn[]): void {
  writeRaw(rows)
}
