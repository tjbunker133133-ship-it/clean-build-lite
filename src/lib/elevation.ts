import { isOpenMeteoBackoffActive, recordOpenMeteoRateLimit } from './panelDataBackoff'

const CACHE_KEY = 'hud_last_elevation_v1'

type Cached = {
  lat: number
  lng: number
  m: number
  at: number
}

/** Reuse last good elevation near this fix (Open-Meteo rate limits are per-IP). */
export function readCachedElevationMeters(
  lat: number,
  lng: number,
  maxAgeMs = 7 * 86_400_000,
  maxDistanceM = 8_000,
): number | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as Cached
    if (!Number.isFinite(cached?.m)) return null
    if (maxAgeMs > 0 && Date.now() - cached.at > maxAgeMs) return null
    const dLat = (cached.lat - lat) * 111_320
    const dLng = (cached.lng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180)
    const dist = Math.hypot(dLat, dLng)
    if (dist > maxDistanceM) return null
    return cached.m
  } catch {
    return null
  }
}

export async function fetchElevationMeters(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<number | null> {
  if (isOpenMeteoBackoffActive()) {
    return readCachedElevationMeters(lat, lng)
  }
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(6)}&longitude=${lng.toFixed(6)}`
    const res = await fetch(url, { cache: 'no-store', signal })
    if (res.status === 429) {
      recordOpenMeteoRateLimit()
      return readCachedElevationMeters(lat, lng)
    }
    if (!res.ok) {
      return readCachedElevationMeters(lat, lng)
    }
    const data = await res.json()
    const m = Number(data?.elevation?.[0])
    if (!Number.isFinite(m)) return readCachedElevationMeters(lat, lng)
    const payload: Cached = { lat, lng, m, at: Date.now() }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore cache write errors
    }
    return m
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw err
    }
    return readCachedElevationMeters(lat, lng)
  }
}
