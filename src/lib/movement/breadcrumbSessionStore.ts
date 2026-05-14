import { haversineMeters } from '../haversine'

const STORAGE_KEY = 'hud_breadcrumb_session_v1'
const SCHEMA_V = 1
const MAX_POINTS = 3500

export type BreadcrumbPoint = {
  lat: number
  lng: number
  t: number
}

export type BreadcrumbSessionSnapshot = {
  startedAt: number
  points: BreadcrumbPoint[]
  sessionMeters: number
}

type Listener = (s: BreadcrumbSessionSnapshot) => void

const listeners = new Set<Listener>()

let snapshot: BreadcrumbSessionSnapshot = {
  startedAt: Date.now(),
  points: [],
  sessionMeters: 0,
}

let hydrated = false

function ensureHydrated(): void {
  if (hydrated) return
  if (typeof localStorage === 'undefined') return
  hydrated = true
  snapshot = loadFromStorage()
}

function emit() {
  for (const l of listeners) {
    try {
      l(snapshot)
    } catch {
      /* ignore */
    }
  }
}

function trimIfNeeded(points: BreadcrumbPoint[]): BreadcrumbPoint[] {
  if (points.length <= MAX_POINTS) return points
  const drop = points.length - MAX_POINTS
  return points.slice(drop)
}

function persist() {
  try {
    const payload = {
      v: SCHEMA_V,
      startedAt: snapshot.startedAt,
      points: snapshot.points,
      sessionMeters: snapshot.sessionMeters,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    console.warn('[localStorage] breadcrumb persist failed', { key: STORAGE_KEY, error })
  }
}

let persistTimer: ReturnType<typeof globalThis.setTimeout> | null = null
function schedulePersist() {
  if (persistTimer != null) return
  persistTimer = globalThis.setTimeout(() => {
    persistTimer = null
    persist()
  }, 600)
}

function loadFromStorage(): BreadcrumbSessionSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { startedAt: Date.now(), points: [], sessionMeters: 0 }
    const o = JSON.parse(raw) as {
      v?: number
      startedAt?: number
      points?: unknown
      sessionMeters?: number
    }
    if (o.v !== SCHEMA_V || !Array.isArray(o.points)) {
      return { startedAt: Date.now(), points: [], sessionMeters: 0 }
    }
    const pts: BreadcrumbPoint[] = []
    for (const p of o.points) {
      if (!p || typeof p !== 'object') continue
      const r = p as Record<string, unknown>
      if (
        typeof r.lat === 'number' &&
        Number.isFinite(r.lat) &&
        typeof r.lng === 'number' &&
        Number.isFinite(r.lng) &&
        typeof r.t === 'number' &&
        Number.isFinite(r.t)
      ) {
        pts.push({ lat: r.lat, lng: r.lng, t: r.t })
      }
    }
    const startedAt =
      typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) ? o.startedAt : Date.now()
    const sessionMeters =
      typeof o.sessionMeters === 'number' && Number.isFinite(o.sessionMeters) && o.sessionMeters >= 0
        ? o.sessionMeters
        : 0
    return { startedAt, points: trimIfNeeded(pts), sessionMeters }
  } catch {
    return { startedAt: Date.now(), points: [], sessionMeters: 0 }
  }
}

export function getBreadcrumbSessionSnapshot(): BreadcrumbSessionSnapshot {
  ensureHydrated()
  return snapshot
}

export function subscribeBreadcrumbSession(fn: Listener): () => void {
  ensureHydrated()
  listeners.add(fn)
  try {
    fn(snapshot)
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Append a GPS fix to the session trail. Computes segment length using the same
 * great-circle helper as the rest of the app (read-only import).
 */
export function appendBreadcrumbPoint(
  lat: number,
  lng: number,
  nowMs: number,
): BreadcrumbSessionSnapshot {
  ensureHydrated()
  const prev = snapshot.points.length ? snapshot.points[snapshot.points.length - 1] : null
  let nextMeters = snapshot.sessionMeters
  if (prev) {
    nextMeters += haversineMeters(prev.lat, prev.lng, lat, lng)
  }
  const nextPoints = trimIfNeeded([...snapshot.points, { lat, lng, t: nowMs }])
  snapshot = {
    startedAt: snapshot.points.length === 0 ? nowMs : snapshot.startedAt,
    points: nextPoints,
    sessionMeters: nextMeters,
  }
  emit()
  schedulePersist()
  return snapshot
}

export function clearBreadcrumbSession(): void {
  ensureHydrated()
  snapshot = { startedAt: Date.now(), points: [], sessionMeters: 0 }
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.warn('[localStorage] breadcrumb clear failed', { key: STORAGE_KEY, error })
  }
  emit()
}
