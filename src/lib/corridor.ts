export const HALF_CORRIDOR_FEET = 5280 // 1 mile each side (2-mile total width)

function projectXY(lat: number, lng: number, lat0: number) {
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180)
  return { x: lng * mPerDegLng, y: lat * mPerDegLat }
}

function pointToSegmentFeet(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const lat0 = (a.lat + b.lat + p.lat) / 3
  const P = projectXY(p.lat, p.lng, lat0)
  const A = projectXY(a.lat, a.lng, lat0)
  const B = projectXY(b.lat, b.lng, lat0)
  const ABx = B.x - A.x
  const ABy = B.y - A.y
  const APx = P.x - A.x
  const APy = P.y - A.y
  const denom = Math.max(1e-9, ABx * ABx + ABy * ABy)
  const t = Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / denom))
  const Cx = A.x + t * ABx
  const Cy = A.y + t * ABy
  const dx = P.x - Cx
  const dy = P.y - Cy
  return Math.hypot(dx, dy) * 3.28084
}

export function distancePointToRouteFeet(
  point: { lat: number; lng: number },
  route: Array<{ lat: number; lng: number }>,
) {
  if (route.length === 0) return Infinity
  if (route.length === 1) return pointToSegmentFeet(point, route[0], route[0])
  let best = Infinity
  for (let i = 1; i < route.length; i++) {
    const d = pointToSegmentFeet(point, route[i - 1], route[i])
    if (d < best) best = d
  }
  return best
}

export function corridorSeverity(distanceFeet: number, halfCorridorFeet = HALF_CORRIDOR_FEET) {
  if (!Number.isFinite(distanceFeet)) return 0
  if (distanceFeet > halfCorridorFeet) return 6
  const edge = halfCorridorFeet - distanceFeet
  if (edge <= 250) return 5
  if (edge <= 500) return 4
  if (edge <= 1000) return 3
  if (edge <= 1500) return 2
  return 1
}

export function corridorZoneLabel(severity: number) {
  return (
    ['CLEAR', 'NEAR ROUTE', '1500FT BAND', '1000FT BAND', '500FT BAND', '250FT BAND', 'BREACH'][severity] ??
    'CLEAR'
  )
}

