/**
 * Non-PII rescue pipeline trace (sessionStorage + optional debug ingest).
 * Survives production PWA sessions where localhost ingest is unreachable.
 */

const TRACE_KEY = 'rescue_pipeline_trace_a49f65'
const TRACE_MAX = 24
const INGEST_URL = 'http://127.0.0.1:7617/ingest/9454c0bb-b23c-490e-8bfb-46ee1e916bc0'
const SESSION_ID = 'a49f65'

export type RescuePipelineTraceEntry = {
  runId: string
  hypothesisId: string
  location: string
  message: string
  data: Record<string, unknown>
  timestamp: number
}

export function appendRescuePipelineTrace(entry: Omit<RescuePipelineTraceEntry, 'timestamp'>): void {
  const row: RescuePipelineTraceEntry = { ...entry, timestamp: Date.now() }
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(TRACE_KEY)
      const list: RescuePipelineTraceEntry[] = raw ? (JSON.parse(raw) as RescuePipelineTraceEntry[]) : []
      list.push(row)
      while (list.length > TRACE_MAX) list.shift()
      sessionStorage.setItem(TRACE_KEY, JSON.stringify(list))
    }
  } catch {
    /* quota / private mode */
  }
  if (import.meta.env.DEV) {
    fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION_ID },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        runId: row.runId,
        hypothesisId: row.hypothesisId,
        location: row.location,
        message: row.message,
        data: row.data,
        timestamp: row.timestamp,
      }),
    }).catch(() => {})
  }
}

export function readRescuePipelineTrace(): RescuePipelineTraceEntry[] {
  try {
    if (typeof sessionStorage === 'undefined') return []
    const raw = sessionStorage.getItem(TRACE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RescuePipelineTraceEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function clearRescuePipelineTrace(): void {
  try {
    sessionStorage?.removeItem(TRACE_KEY)
  } catch {
    /* ignore */
  }
}
