const CACHE_KEY = 'hud_last_elevation_v1'

type Cached = {
  lat: number
  lng: number
  m: number
  at: number
}

export async function fetchElevationMeters(lat: number, lng: number): Promise<number | null> {
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(6)}&longitude=${lng.toFixed(6)}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    const m = Number(data?.elevation?.[0])
    if (!Number.isFinite(m)) return null
    const payload: Cached = { lat, lng, m, at: Date.now() }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore cache write errors
    }
    return m
  } catch {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return null
      const cached = JSON.parse(raw) as Cached
      if (!Number.isFinite(cached?.m)) return null
      return cached.m
    } catch {
      return null
    }
  }
}

