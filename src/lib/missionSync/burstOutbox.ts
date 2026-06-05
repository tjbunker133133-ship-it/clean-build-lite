/**
 * Lightweight offline burst queue — localStorage, exponential backoff retry.
 * Uses existing MissionBurst wire shape; no new transport.
 */

import type { MissionBurst } from './types'

const OUTBOX_KEY = 'hud_mission_burst_outbox_v1'
const MAX_ITEMS = 24
const BASE_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 120_000
const MAX_ATTEMPTS = 8

export type QueuedBurst = {
  /** Frozen at enqueue — do not mutate after queue. */
  burst: Readonly<MissionBurst>
  peerId?: string
  queuedAt: number
  attempts: number
  nextAttemptAt: number
}

let memoryOutbox: QueuedBurst[] = []

function readRaw(): QueuedBurst[] {
  if (typeof localStorage === 'undefined') return [...memoryOutbox]
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return [...memoryOutbox]
    const parsed = JSON.parse(raw) as QueuedBurst[]
    const items = Array.isArray(parsed) ? parsed : []
    memoryOutbox = items
    return [...items]
  } catch {
    return [...memoryOutbox]
  }
}

function writeRaw(items: QueuedBurst[]): void {
  memoryOutbox = [...items]
  if (typeof localStorage === 'undefined') return
  try {
    if (items.length === 0) {
      localStorage.removeItem(OUTBOX_KEY)
      return
    }
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-MAX_ITEMS)))
  } catch {
    /* quota */
  }
}

export function listQueuedBursts(): QueuedBurst[] {
  return readRaw()
}

export function enqueueBurst(burst: MissionBurst, peerId?: string): void {
  const now = Date.now()
  const items = readRaw()
  const dupe = items.some(
    (q) =>
      q.burst.text === burst.text &&
      q.burst.toDeviceId === burst.toDeviceId &&
      now - q.queuedAt < 5_000,
  )
  if (dupe) return
  items.push({
    burst: Object.freeze({ ...burst }),
    peerId,
    queuedAt: now,
    attempts: 0,
    nextAttemptAt: now,
  })
  writeRaw(items)
}

export function removeQueuedBurst(id: string): void {
  writeRaw(readRaw().filter((q) => queueId(q) !== id))
}

export function queueId(q: QueuedBurst): string {
  return `${q.burst.sentAt}:${q.burst.deviceId}:${q.burst.toDeviceId ?? 'team'}`
}

export function dueQueuedBursts(nowMs: number = Date.now()): QueuedBurst[] {
  return readRaw().filter((q) => q.nextAttemptAt <= nowMs)
}

export function markBurstAttempt(
  q: QueuedBurst,
  ok: boolean,
  nowMs: number = Date.now(),
): 'removed' | 'retry' | 'expired' {
  const items = readRaw()
  const id = queueId(q)
  if (ok) {
    writeRaw(items.filter((x) => queueId(x) !== id))
    return 'removed'
  }
  const attempts = q.attempts + 1
  if (attempts >= MAX_ATTEMPTS) {
    writeRaw(items.filter((x) => queueId(x) !== id))
    return 'expired'
  }
  const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempts, 6))
  writeRaw(
    items.map((x) =>
      queueId(x) === id
        ? { ...x, attempts, nextAttemptAt: nowMs + backoff }
        : x,
    ),
  )
  return 'retry'
}

export function clearBurstOutbox(): void {
  writeRaw([])
}

export function _clearBurstOutboxForTests(): void {
  clearBurstOutbox()
}
