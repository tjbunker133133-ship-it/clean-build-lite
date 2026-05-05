import { useEffect, useState } from 'react'

type GPSData = {
  lat: number | null
  lng: number | null
  accuracy: number | null
}

export function useGPS(): GPSData {
  const [gps, setGPS] = useState<GPSData>({
    lat: null,
    lng: null,
    accuracy: null,
  })

  useEffect(() => {
    if (!navigator.geolocation) return

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGPS({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
      },
      (err) => {
        console.warn('GPS error:', err)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  return gps
}