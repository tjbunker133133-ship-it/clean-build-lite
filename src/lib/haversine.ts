const EARTH_RADIUS_METERS = 6371e3
const METERS_PER_MILE = 1609.344

/** Great-circle distance in meters (WGS84 sphere). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const la1 = toRad(lat1)
  const la2 = toRad(lat2)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): { miles: number; feet: number } {
  const meters = haversineMeters(lat1, lng1, lat2, lng2)
  const miles = meters / METERS_PER_MILE
  const feet = miles * 5280

  return { miles, feet }
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) {
    const feet = miles * 5280
    return `${Math.round(feet)} ft`
  }
  return `${miles.toFixed(2)} mi`
}

export function totalRouteDistance(
  points: Array<{ lat: number; lng: number }>
): { miles: number; feet: number } {
  let totalMiles = 0
  for (let i = 1; i < points.length; i++) {
    const { miles } = haversineDistance(
      points[i - 1].lat, points[i - 1].lng,
      points[i].lat, points[i].lng
    )
    totalMiles += miles
  }
  return { miles: totalMiles, feet: totalMiles * 5280 }
}

/** Sum of segment great-circle distances along a vertex path (trail-following mileage). */
export function polylineDistance(
  points: Array<{ lat: number; lng: number }>,
): { miles: number; feet: number } {
  if (points.length < 2) return { miles: 0, feet: 0 }
  let meters = 0
  for (let i = 1; i < points.length; i++) {
    meters += haversineMeters(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng,
    )
  }
  const miles = meters / METERS_PER_MILE
  return { miles, feet: miles * 5280 }
}

/** Point halfway along a polyline by trail distance (for segment labels). */
export function midpointAlongPolyline(
  points: Array<{ lat: number; lng: number }>,
): { lat: number; lng: number } | null {
  if (points.length === 0) return null
  if (points.length === 1) return { lat: points[0].lat, lng: points[0].lng }
  const totalM = polylineDistance(points).miles * METERS_PER_MILE
  if (totalM <= 0) return { lat: points[0].lat, lng: points[0].lng }
  const half = totalM / 2
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const segM = haversineMeters(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng,
    )
    if (acc + segM >= half) {
      const t = segM > 0 ? (half - acc) / segM : 0
      return {
        lat: points[i - 1].lat + t * (points[i].lat - points[i - 1].lat),
        lng: points[i - 1].lng + t * (points[i].lng - points[i - 1].lng),
      }
    }
    acc += segM
  }
  const last = points[points.length - 1]
  return { lat: last.lat, lng: last.lng }
}