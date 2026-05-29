import type { Waypoint } from '../../types'

/** Strip undefined fields; keep navigation-critical waypoint data only. */
export function sanitizeWaypointForSync(wp: Waypoint): Waypoint {
  const out: Waypoint = {
    id: wp.id,
    lng: wp.lng,
    lat: wp.lat,
    label: wp.label,
    type: wp.type,
    createdAt: wp.createdAt,
    status: wp.status ?? 'pending',
  }
  if (wp.source) out.source = wp.source
  if (wp.rawLat != null) out.rawLat = wp.rawLat
  if (wp.rawLng != null) out.rawLng = wp.rawLng
  if (wp.snapDistanceMeters != null) out.snapDistanceMeters = wp.snapDistanceMeters
  return out
}

export function sanitizeWaypointsForSync(waypoints: Waypoint[]): Waypoint[] {
  return waypoints
    .filter((w) => w && w.status !== 'archived')
    .map(sanitizeWaypointForSync)
}
