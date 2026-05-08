import {
  enqueueRoutineCheckIn,
  readCheckInOutbox,
  replaceCheckInOutbox,
  type QueuedRoutineCheckIn,
} from './checkInOutbox'
import type { RoutineCheckInPayload } from './routineCheckInTypes'
import { submitRoutineCheckIn } from './submitRoutineCheckIn'

function notifyOutboxChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('hud:checkin-outbox-changed'))
  } catch {
    /* noop */
  }
}

export type SendRoutineCheckInOutcome = { status: 'sent' } | { status: 'queued' }

/**
 * When offline: queue only.
 * When online: try submit; on failure queue for retry when connectivity or backend recovers.
 */
export async function sendRoutineCheckInOrQueue(
  payload: RoutineCheckInPayload,
): Promise<SendRoutineCheckInOutcome> {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  if (offline) {
    enqueueRoutineCheckIn(payload)
    notifyOutboxChanged()
    return { status: 'queued' }
  }

  const result = await submitRoutineCheckIn(payload)
  if (result.ok) {
    notifyOutboxChanged()
    return { status: 'sent' }
  }

  enqueueRoutineCheckIn(payload)
  notifyOutboxChanged()
  return { status: 'queued' }
}

export async function flushRoutineCheckInOutbox(): Promise<{ sent: number; remaining: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { sent: 0, remaining: readCheckInOutbox().length }
  }

  const queue = readCheckInOutbox()
  let sent = 0
  const stillPending: QueuedRoutineCheckIn[] = []

  for (const item of queue) {
    const r = await submitRoutineCheckIn(item.payload)
    if (r.ok) sent += 1
    else stillPending.push(item)
  }

  replaceCheckInOutbox(stillPending)
  notifyOutboxChanged()
  return { sent, remaining: stillPending.length }
}
