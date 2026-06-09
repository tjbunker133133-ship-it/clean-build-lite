import type { Waypoint, WaypointStatus, WaypointType } from '../../types'

const OSG_ROUTE_KEY = 'hud_osg_route_v1'
const LEGACY_APP_KEY = 'tactical_hud_app_state_v1'

function isWaypointType(v: unknown): v is WaypointType {
  return (
    v === 'default' || v === 'start' || v === 'camp' || v === 'water' ||
    v === 'rest' || v === 'poi' || v === 'pin' || v === 'finish'
  )
}

function isWaypointStatus(v: unknown): v is WaypointStatus {
  return v === 'pending' || v === 'active' || v === 'completed' || v === 'archived'
}

function sanitizeWaypoint(raw: unknown): Waypoint | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<Waypoint>
  if (typeof item.id !== 'string' || typeof item.label !== 'string') return null
  if (typeof item.lng !== 'number' || !Number.isFinite(item.lng)) return null
  if (typeof item.lat !== 'number' || !Number.isFinite(item.lat)) return null
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) return null
  if (!isWaypointType(item.type)) return null
  const base: Waypoint = {
    id: item.id,
    lng: item.lng,
    lat: item.lat,
    label: item.label.slice(0, 64),
    type: item.type,
    createdAt: item.createdAt,
  }
  if (typeof item.rawLat === 'number' && Number.isFinite(item.rawLat)) base.rawLat = item.rawLat
  if (typeof item.rawLng === 'number' && Number.isFinite(item.rawLng)) base.rawLng = item.rawLng
  if (item.source === 'manual' || item.source === 'snapped') base.source = item.source
  if (typeof item.snapDistanceMeters === 'number' && Number.isFinite(item.snapDistanceMeters)) {
    base.snapDistanceMeters = item.snapDistanceMeters
  }
  if (isWaypointStatus(item.status)) base.status = item.status
  return base
}

export function loadOsgRouteWaypoints(): Waypoint[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(OSG_ROUTE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { waypoints?: unknown[] } | null
      if (parsed && Array.isArray(parsed.waypoints)) {
        return parsed.waypoints.map(sanitizeWaypoint).filter((w): w is Waypoint => Boolean(w))
      }
    }
    // One-time migration from legacy AppContext storage
    const legacy = localStorage.getItem(LEGACY_APP_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as { waypoints?: unknown[] } | null
      if (parsed && Array.isArray(parsed.waypoints)) {
        const migrated = parsed.waypoints.map(sanitizeWaypoint).filter((w): w is Waypoint => Boolean(w))
        if (migrated.length > 0) {
          saveOsgRouteWaypoints(migrated)
        }
        return migrated
      }
    }
  } catch {
    /* ignore */
  }
  return []
}

export function saveOsgRouteWaypoints(waypoints: Waypoint[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(OSG_ROUTE_KEY, JSON.stringify({ waypoints, ts: Date.now() }))
  } catch {
    /* quota */
  }
}

export function clearOsgRouteStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(OSG_ROUTE_KEY)
  } catch {
    /* ignore */
  }
}
