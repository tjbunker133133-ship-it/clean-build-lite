/**
 * Operational map context resume (local only, no network).
 * Coordinates last-known GPS with last map viewport zoom/bearing/pitch for cold start.
 */

const RESUME_KEY = 'hud_operational_map_resume_v1'
const VIEWPORT_KEY = 'hud_map_viewport_v1'
const LAST_KNOWN_LOCATION_KEY = 'lastKnownLocation'

const RESUME_VERSION = 1
const MAX_RESUME_AGE_MS = 45 * 24 * 60 * 60 * 1000

const STATIC_DEFAULT = { lng: -105.7821, lat: 39.5501, zoom: 10, bearing: 0, pitch: 0 }

export type MapBootKind = 'resume' | 'viewport' | 'gps_seed' | 'static'

export type ResolvedMapBootView = {
  kind: MapBootKind
  lng: number
  lat: number
  zoom: number
  bearing: number
  pitch: number
}

type ResumeBody = {
  v: number
  lat: number
  lng: number
  zoom: number
  bearing: number
  pitch: number
  ts: number
}

function isFresh(ts: number): boolean {
  return Number.isFinite(ts) && Date.now() - ts <= MAX_RESUME_AGE_MS
}

function readViewport(): {
  lng: number
  lat: number
  zoom: number
  bearing: number
  pitch: number
  ts: number
} | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<{
      lng: number
      lat: number
      zoom: number
      bearing: number
      pitch: number
      ts: number
    }>
    if (
      !p ||
      typeof p.lng !== 'number' ||
      typeof p.lat !== 'number' ||
      typeof p.zoom !== 'number' ||
      typeof p.bearing !== 'number' ||
      typeof p.pitch !== 'number'
    ) {
      return null
    }
    const ts = typeof p.ts === 'number' ? p.ts : Date.now()
    return {
      lng: p.lng,
      lat: p.lat,
      zoom: Math.min(18, Math.max(4, p.zoom)),
      bearing: p.bearing,
      pitch: p.pitch,
      ts,
    }
  } catch {
    return null
  }
}

function readResumeBody(): ResumeBody | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<ResumeBody>
    if (
      !p ||
      p.v !== RESUME_VERSION ||
      typeof p.lat !== 'number' ||
      typeof p.lng !== 'number' ||
      typeof p.zoom !== 'number' ||
      typeof p.bearing !== 'number' ||
      typeof p.pitch !== 'number' ||
      typeof p.ts !== 'number'
    ) {
      return null
    }
    return {
      v: RESUME_VERSION,
      lat: p.lat,
      lng: p.lng,
      zoom: Math.min(18, Math.max(4, p.zoom)),
      bearing: p.bearing,
      pitch: p.pitch,
      ts: p.ts,
    }
  } catch {
    return null
  }
}

function readLastKnownGps(): { lat: number; lng: number } | null {
  try {
    const raw = localStorage.getItem(LAST_KNOWN_LOCATION_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { lat?: unknown; lng?: unknown } | null
    if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return null
    return { lat: p.lat, lng: p.lng }
  } catch {
    return null
  }
}

/**
 * Single source for MapLibre boot center/zoom/bearing/pitch.
 * Priority: GPS-tagged resume → full viewport → last known GPS only → static default.
 */
export function resolveMapBootView(): ResolvedMapBootView {
  const resume = readResumeBody()
  if (resume && isFresh(resume.ts)) {
    return {
      kind: 'resume',
      lng: resume.lng,
      lat: resume.lat,
      zoom: resume.zoom,
      bearing: resume.bearing,
      pitch: resume.pitch,
    }
  }

  const vp = readViewport()
  if (vp && isFresh(vp.ts)) {
    return {
      kind: 'viewport',
      lng: vp.lng,
      lat: vp.lat,
      zoom: vp.zoom,
      bearing: vp.bearing,
      pitch: vp.pitch,
    }
  }

  const g = readLastKnownGps()
  if (g) {
    return {
      kind: 'gps_seed',
      lng: g.lng,
      lat: g.lat,
      zoom: 14,
      bearing: 0,
      pitch: 0,
    }
  }

  return { kind: 'static', ...STATIC_DEFAULT }
}

/**
 * Merge last known GPS (preferred) or last map viewport center with viewport zoom/bearing/pitch.
 * Safe to call often (e.g. after GPS persist).
 */
export function refreshOperationalMapResumeFromLocalStorage(): void {
  try {
    const g = readLastKnownGps()
    const vp = readViewport()
    const lat = g?.lat ?? vp?.lat
    const lng = g?.lng ?? vp?.lng
    if (lat == null || lng == null) return
    const body: ResumeBody = {
      v: RESUME_VERSION,
      lat,
      lng,
      zoom: vp ? vp.zoom : 15,
      bearing: vp ? vp.bearing : 0,
      pitch: vp ? vp.pitch : 0,
      ts: Date.now(),
    }
    localStorage.setItem(RESUME_KEY, JSON.stringify(body))
  } catch {
    /* ignore */
  }
}

/** Best-effort flush before suspend / tab background (PWA field use). */
export function snapshotOperationalMapResumeForSuspend(): void {
  refreshOperationalMapResumeFromLocalStorage()
}
