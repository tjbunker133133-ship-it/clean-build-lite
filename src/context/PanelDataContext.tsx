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
import { tier1Debug } from '../lib/tier1DebugLog'
import { useGPS } from '../hooks/useGPS'
import { fetchElevationMeters, readCachedElevationMeters } from '../lib/elevation'
import {
  isOpenMeteoBackoffActive,
  openMeteoBackoffRemainingMs,
} from '../lib/panelDataBackoff'
import { shouldRefreshByDistance, shouldRefreshByInterval } from '../lib/panelDataThrottle'
import {
  fetchWeather as loadWeather,
  isWeatherSuccess,
  readCachedWeather,
  type WeatherResult,
} from '../lib/weather'

// ⚠️ LOCKED SYSTEM — Behavior Freeze Active
// Any change to interaction, layout, display modes, or layers requires explicit approval.

const REFRESH_INTERVAL_MS = 600_000
const WEATHER_MIN_MOVE_M = 750
const ELEVATION_MIN_MOVE_M = 150
const WEATHER_MIN_INTERVAL_MS = 600_000
const WEATHER_MANUAL_MIN_INTERVAL_MS = 120_000

function mergeWeatherResult(prev: WeatherResult | null, next: WeatherResult): WeatherResult {
  if (isWeatherSuccess(next)) return next
  const cached = readCachedWeather(7 * 86_400_000)
  if (cached) return { ...cached, stale: true }
  if (prev && isWeatherSuccess(prev)) return prev
  return next
}

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
  weatherRefreshNote: string | null
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

  const [weather, setWeather] = useState<WeatherResult | null>(() => readCachedWeather())
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherRefreshNote, setWeatherRefreshNote] = useState<string | null>(null)
  const [locationTimeZone, setLocationTimeZone] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const refreshGenRef = useRef(0)
  const lastElevationAnchorRef = useRef<PanelUserLocation | null>(null)
  const lastWeatherAnchorRef = useRef<PanelUserLocation | null>(null)
  const lastWeatherFetchMsRef = useRef<number | null>(null)
  const lastManualWeatherMsRef = useRef<number | null>(null)
  const weatherNoteTimerRef = useRef<number | null>(null)

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

  const runDataFetch = useCallback(async (opts?: { forceWeather?: boolean }) => {
    const forceWeather = opts?.forceWeather === true
    tier1Debug('panel', 'data input', {
      lat: gps.lat,
      lng: gps.lng,
      source: gps.source,
    })
    const lat = userLocation?.lat
    const lng = userLocation?.lng
    if (lat == null || lng == null) {
      setElevationMeters((prev) => (prev === null ? prev : null))
      setElevationError((prev) => (prev === null ? prev : null))
      setElevationLoading((prev) => (prev ? false : prev))
      setLocationTimeZone((prev) => (prev === null ? prev : null))
      return
    }

    const nextAnchor = { lat, lng }
    const fetchElevation = shouldRefreshByDistance(
      lastElevationAnchorRef.current,
      nextAnchor,
      ELEVATION_MIN_MOVE_M,
    )
    const shouldFetchWeather =
      forceWeather ||
      (shouldRefreshByDistance(lastWeatherAnchorRef.current, nextAnchor, WEATHER_MIN_MOVE_M) &&
        shouldRefreshByInterval(lastWeatherFetchMsRef.current, WEATHER_MIN_INTERVAL_MS))

    if (!fetchElevation && !shouldFetchWeather) {
      return
    }

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const gen = ++refreshGenRef.current

    if (fetchElevation) {
      setElevationLoading((prev) => (prev ? prev : true))
      setElevationError((prev) => (prev === null ? prev : null))
    }
    if (shouldFetchWeather) {
      setWeatherLoading((prev) => (prev ? prev : true))
    }

    try {
      const [elM, wx] = await Promise.all([
        fetchElevation
          ? fetchElevationMeters(lat, lng, ac.signal)
          : Promise.resolve(null),
        shouldFetchWeather ? loadWeather(lat, lng, { signal: ac.signal }) : Promise.resolve(null),
      ])
      if (gen !== refreshGenRef.current) return
      if (fetchElevation) {
        lastElevationAnchorRef.current = nextAnchor
        let resolvedElev = elM
        if (resolvedElev == null) {
          resolvedElev = readCachedElevationMeters(lat, lng)
        }
        if (resolvedElev == null && gps.elevation != null && Number.isFinite(gps.elevation)) {
          resolvedElev = gps.elevation
        }
        if (resolvedElev != null) {
          setElevationMeters((prev) => (prev === resolvedElev ? prev : resolvedElev))
          setElevationError((prev) => (prev === null ? prev : null))
        } else {
          setElevationError((prev) =>
            prev === 'Elevation unavailable (using GPS altitude if shown)' ? prev : 'Elevation unavailable (using GPS altitude if shown)',
          )
        }
      }

      if (shouldFetchWeather && wx) {
        lastWeatherAnchorRef.current = nextAnchor
        lastWeatherFetchMsRef.current = Date.now()
        setWeather((prev) => {
          const merged = mergeWeatherResult(prev, wx)
          return Object.is(prev, merged) ? prev : merged
        })
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
      if (fetchElevation) {
        setElevationError((prev) => {
          const next = e instanceof Error ? e.message : 'Elevation fetch failed'
          return prev === next ? prev : next
        })
      }
      if (shouldFetchWeather) {
        setWeather((prev) => mergeWeatherResult(prev, { error: 'Weather fetch failed' }))
      }
    } finally {
      if (gen === refreshGenRef.current) {
        if (fetchElevation) {
          setElevationLoading((prev) => (prev ? false : prev))
        }
        if (shouldFetchWeather) {
          setWeatherLoading((prev) => (prev ? false : prev))
        }
      }
    }
  }, [userLocation?.lat, userLocation?.lng, gps.elevation])

  const refreshPanelData = useCallback(() => {
    const now = Date.now()
    if (
      lastManualWeatherMsRef.current != null &&
      now - lastManualWeatherMsRef.current < WEATHER_MANUAL_MIN_INTERVAL_MS
    ) {
      const waitSec = Math.ceil(
        (WEATHER_MANUAL_MIN_INTERVAL_MS - (now - lastManualWeatherMsRef.current)) / 1000,
      )
      setWeatherRefreshNote(`Wait ${waitSec}s before refreshing again`)
      return
    }
    if (isOpenMeteoBackoffActive()) {
      const cached = readCachedWeather(7 * 86_400_000)
      if (cached) setWeather({ ...cached, stale: true })
      const min = Math.max(1, Math.ceil(openMeteoBackoffRemainingMs() / 60_000))
      setWeatherRefreshNote(`Cached weather — API cooldown ~${min} min`)
      return
    }
    lastManualWeatherMsRef.current = now
    setWeatherRefreshNote(null)
    void runDataFetch({ forceWeather: true })
  }, [runDataFetch])

  useEffect(() => {
    if (weatherRefreshNote == null) return
    if (weatherNoteTimerRef.current != null) window.clearTimeout(weatherNoteTimerRef.current)
    weatherNoteTimerRef.current = window.setTimeout(() => {
      weatherNoteTimerRef.current = null
      setWeatherRefreshNote(null)
    }, 6_000)
    return () => {
      if (weatherNoteTimerRef.current != null) window.clearTimeout(weatherNoteTimerRef.current)
    }
  }, [weatherRefreshNote])

  useEffect(() => {
    if (userLocation == null) return
    void runDataFetch({ forceWeather: readCachedWeather(600_000) == null })
    return () => {
      abortRef.current?.abort()
    }
  }, [runDataFetch, userLocation])

  useEffect(() => {
    if (userLocation == null) return
    let id: number | undefined
    const tick = () => void runDataFetch()
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
      void runDataFetch()
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
    const onRefresh = () => refreshPanelData()
    window.addEventListener('hud:weather-refresh', onRefresh)
    return () => window.removeEventListener('hud:weather-refresh', onRefresh)
  }, [refreshPanelData])

  const value = useMemo(
    () => ({
      userLocation,
      panelsLocationBlocked,
      elevationMeters,
      elevationLoading,
      elevationError,
      weather,
      weatherLoading,
      weatherRefreshNote,
      locationTimeZone,
      refreshPanelData,
    }),
    [
      userLocation,
      panelsLocationBlocked,
      elevationMeters,
      elevationLoading,
      elevationError,
      weather,
      weatherLoading,
      weatherRefreshNote,
      locationTimeZone,
      refreshPanelData,
    ],
  )

  return <PanelDataContext.Provider value={value}>{children}</PanelDataContext.Provider>
}

export function usePanelData(): PanelDataContextValue {
  const ctx = useContext(PanelDataContext)
  if (!ctx) throw new Error('usePanelData must be used within PanelDataProvider')
  return ctx
}
