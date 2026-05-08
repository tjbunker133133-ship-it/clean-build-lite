import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useGPS } from '../hooks/useGPS'
import { fetchElevationOpenElevation } from '../lib/openElevation'
import { fetchWeather, type WeatherResult } from '../lib/weather'

// ⚠️ LOCKED SYSTEM — Behavior Freeze Active
// Any change to interaction, layout, display modes, or layers requires explicit approval.

const REFRESH_INTERVAL_MS = 120_000

export type PanelUserLocation = { lat: number; lng: number }

export type PanelDataContextValue = {
  /** Shared panel coordinates — synced from `useGPS` after user-triggered fix (same underlying `getCurrentPosition`). */
  userLocation: PanelUserLocation | null
  panelsLocationBlocked: boolean
  elevationMeters: number | null
  elevationLoading: boolean
  elevationError: string | null
  weather: WeatherResult | null
  weatherLoading: boolean
  locationTimeZone: string | null
  refreshPanelData: () => void
}

const PanelDataContext = createContext<PanelDataContextValue | null>(null)

export function PanelDataProvider({ children }: { children: ReactNode }) {
  const gps = useGPS()
  const [userLocation, setUserLocation] = useState<PanelUserLocation | null>(null)

  const [elevationMeters, setElevationMeters] = useState<number | null>(null)
  const [elevationLoading, setElevationLoading] = useState(false)
  const [elevationError, setElevationError] = useState<string | null>(null)

  const [weather, setWeather] = useState<WeatherResult | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [locationTimeZone, setLocationTimeZone] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const refreshGenRef = useRef(0)

  const panelsLocationBlocked =
    gps.locationState === 'denied' || gps.locationState === 'error'

  // 🔒 CONTRACT: Shared panel data stability is locked.
  // - Keep loop guards and idempotent state writes intact
  // - Do not introduce behavior drift via fetch/update churn
  // Do NOT modify without explicit approval
  /** Single pipeline from `useGPS` — only new object when coordinates actually change. */
  useEffect(() => {
    const { locationState, lat, lng } = gps
    if (locationState === 'denied' || locationState === 'error' || locationState === 'idle') {
      setUserLocation((prev) => (prev == null ? prev : null))
      return
    }
    if (locationState !== 'granted' || lat == null || lng == null) {
      return
    }
    setUserLocation((prev) => {
      if (prev && prev.lat === lat && prev.lng === lng) return prev
      return { lat, lng }
    })
  }, [gps.locationState, gps.lat, gps.lng])

  useEffect(() => {
    if (userLocation == null) return
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
    setLocationTimeZone((prev) => (prev === tz ? prev : tz))
  }, [userLocation?.lat, userLocation?.lng])

  const runDataFetch = useCallback(async (includeWeather: boolean) => {
    if (import.meta.env.DEV) {
      // DEV-only: leaks raw GPS coordinates. MUST stay gated — production
      // operator consoles, screen recordings, and shared debug sessions
      // must not surface fix coordinates here.
      console.log('[PANEL DATA INPUT]', {
        lat: gps.lat,
        lng: gps.lng,
        source: gps.source,
      })
    }
    const lat = userLocation?.lat
    const lng = userLocation?.lng
    if (lat == null || lng == null) {
      setElevationMeters((prev) => (prev === null ? prev : null))
      setElevationError((prev) => (prev === null ? prev : null))
      setElevationLoading((prev) => (prev ? false : prev))
      if (includeWeather) {
        setWeather((prev) => (prev === null ? prev : null))
        setWeatherLoading((prev) => (prev ? false : prev))
      }
      setLocationTimeZone((prev) => (prev === null ? prev : null))
      return
    }

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const gen = ++refreshGenRef.current

    setElevationLoading((prev) => (prev ? prev : true))
    setElevationError((prev) => (prev === null ? prev : null))
    if (includeWeather) {
      setWeatherLoading((prev) => (prev ? prev : true))
    }

    try {
      const [elM, wx] = await Promise.all([
        fetchElevationOpenElevation(lat, lng, ac.signal),
        includeWeather ? fetchWeather(lat, lng, { signal: ac.signal }) : Promise.resolve(null),
      ])
      if (gen !== refreshGenRef.current) return

      // Open-Elevation is flaky (timeouts, 503, empty results). A null response
      // during a combined weather refresh must NOT clear last-known-good
      // elevation — that caused the UI to jump from valid ft to "— ft"
      // whenever weather updated while the elevation lookup failed transiently.
      if (elM != null) {
        setElevationMeters((prev) => (prev === elM ? prev : elM))
        setElevationError((prev) => (prev === null ? prev : null))
      } else {
        setElevationError((prev) => (prev === 'Elevation unavailable' ? prev : 'Elevation unavailable'))
      }

      if (includeWeather) {
        setWeather((prev) => (Object.is(prev, wx) ? prev : wx))
        if (wx && !('error' in wx) && wx.timeZone) {
          const nextZone = wx.timeZone ?? null
          setLocationTimeZone((prev) => (prev === nextZone ? prev : nextZone))
        } else if (wx && 'error' in wx) {
          setLocationTimeZone((prev) => (prev === null ? prev : null))
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      if (gen !== refreshGenRef.current) return
      // Preserve elevation on fetch failure — same rationale as null branch above.
      setElevationError((prev) => {
        const next = e instanceof Error ? e.message : 'Elevation fetch failed'
        return prev === next ? prev : next
      })
      if (includeWeather) {
        setWeather((prev) => {
          if (prev && 'error' in prev && prev.error === 'Weather fetch failed') return prev
          return { error: 'Weather fetch failed' }
        })
        setLocationTimeZone((prev) => (prev === null ? prev : null))
      }
    } finally {
      if (gen === refreshGenRef.current) {
        setElevationLoading((prev) => (prev ? false : prev))
        if (includeWeather) {
          setWeatherLoading((prev) => (prev ? false : prev))
        }
      }
    }
  }, [userLocation?.lat, userLocation?.lng])

  useEffect(() => {
    void runDataFetch(false)
    return () => {
      abortRef.current?.abort()
    }
  }, [runDataFetch])

  useEffect(() => {
    if (userLocation == null) return
    let id: number | undefined
    const tick = () => void runDataFetch(false)
    const arm = () => {
      id = window.setInterval(tick, REFRESH_INTERVAL_MS)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (id != null) {
          window.clearInterval(id)
          id = undefined
        }
        return
      }
      void runDataFetch(false)
      if (id != null) window.clearInterval(id)
      arm()
    }
    arm()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      if (id != null) window.clearInterval(id)
    }
  }, [userLocation, runDataFetch])

  useEffect(() => {
    const onRefresh = () => void runDataFetch(true)
    window.addEventListener('hud:weather-refresh', onRefresh)
    return () => window.removeEventListener('hud:weather-refresh', onRefresh)
  }, [runDataFetch])

  const value = useMemo(
    () => ({
      userLocation,
      panelsLocationBlocked,
      elevationMeters,
      elevationLoading,
      elevationError,
      weather,
      weatherLoading,
      locationTimeZone,
      refreshPanelData: () => void runDataFetch(true),
    }),
    [
      userLocation,
      panelsLocationBlocked,
      elevationMeters,
      elevationLoading,
      elevationError,
      weather,
      weatherLoading,
      locationTimeZone,
      runDataFetch,
    ],
  )

  return <PanelDataContext.Provider value={value}>{children}</PanelDataContext.Provider>
}

export function usePanelData(): PanelDataContextValue {
  const ctx = useContext(PanelDataContext)
  if (!ctx) throw new Error('usePanelData must be used within PanelDataProvider')
  return ctx
}
