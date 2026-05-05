const EARTH_RADIUS_MILES = 3958.8

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): { miles: number; feet: number } {
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const miles = EARTH_RADIUS_MILES * c
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