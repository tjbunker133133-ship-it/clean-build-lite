/** Open-Elevation public API (no key). */
export async function fetchElevationOpenElevation(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`
    const res = await fetch(url, { signal, cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { results?: Array<{ elevation?: number }> }
    const m = Number(data?.results?.[0]?.elevation)
    return Number.isFinite(m) ? m : null
  } catch {
    return null
  }
}
