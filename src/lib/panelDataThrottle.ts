import { haversineMeters } from './haversine'

export function shouldRefreshByDistance(
  prev: { lat: number; lng: number } | null,
  next: { lat: number; lng: number },
  minDistanceM: number,
): boolean {
  if (!prev) return true
  if (minDistanceM <= 0) return true
  return haversineMeters(prev.lat, prev.lng, next.lat, next.lng) >= minDistanceM
}

export function shouldRefreshByInterval(lastAtMs: number | null, minIntervalMs: number, nowMs = Date.now()): boolean {
  if (lastAtMs == null) return true
  if (minIntervalMs <= 0) return true
  return nowMs - lastAtMs >= minIntervalMs
}
