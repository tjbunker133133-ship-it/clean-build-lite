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