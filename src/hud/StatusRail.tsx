import { useEffect, useMemo, useState } from 'react'
import { useGPS } from '../hooks/useGPS'
import { useAppContext } from '../context/AppContext'
import {
  HALF_CORRIDOR_FEET,
  corridorSeverity,
  corridorZoneLabel,
  distancePointToRouteFeet,
} from '../lib/corridor'

type BatteryManagerLike = { level: number } | null

export default function StatusRail() {
  const gps = useGPS()
  const { state } = useAppContext()
  const [battery, setBattery] = useState<BatteryManagerLike>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [weatherAgeMin, setWeatherAgeMin] = useState<number | null>(null)
  const [showCorridorBanner, setShowCorridorBanner] = useState(false)

  useEffect(() => {
    const nav = navigator as any
    if (!nav.getBattery) return
    nav.getBattery().then((b: any) => setBattery({ level: b.level }))
  }, [])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const tick = () => {
      try {
        const raw = localStorage.getItem('titanium_weather_cache_v1')
        if (!raw) return setWeatherAgeMin(null)
        const w = JSON.parse(raw)
        if (!w?.updatedAt) return setWeatherAgeMin(null)
        const age = Math.max(0, Math.round((Date.now() - Number(w.updatedAt)) / 60000))
        setWeatherAgeMin(age)
      } catch {
        setWeatherAgeMin(null)
      }
    }
    tick()
    const id = window.setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [])

  const gpsText = useMemo(() => (gps.lat != null && gps.lng != null ? 'GPS LOCK' : 'GPS SEARCH'), [gps.lat, gps.lng])
  const battPct = battery ? `${Math.round(battery.level * 100)}%` : '--'
  const wxAge = weatherAgeMin == null ? '--' : `${weatherAgeMin}m`
  const runtimeGuards = typeof window !== 'undefined' && !!(window as any).__hudRuntimeGuards
  const buildStampRaw =
    (import.meta as any)?.env?.VITE_BUILD_STAMP && typeof (import.meta as any).env.VITE_BUILD_STAMP === 'string'
      ? (import.meta as any).env.VITE_BUILD_STAMP
      : ''
  const buildStamp = buildStampRaw
    ? buildStampRaw.replace('T', ' ').slice(0, 16)
    : 'unknown'
  const corridor = useMemo(() => {
    if (gps.lat == null || gps.lng == null || state.waypoints.length < 2) return null
    const route = state.waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))
    const distFt = distancePointToRouteFeet({ lat: gps.lat, lng: gps.lng }, route)
    const severity = corridorSeverity(distFt, HALF_CORRIDOR_FEET)
    const edgeFt = Math.max(0, Math.round(HALF_CORRIDOR_FEET - distFt))
    return { distFt, severity, edgeFt, zone: corridorZoneLabel(severity) }
  }, [gps.lat, gps.lng, state.waypoints])

  useEffect(() => {
    if (!corridor) {
      setShowCorridorBanner(false)
      return
    }
    const breach = corridor.severity >= 6
    setShowCorridorBanner(breach)
    if (breach && navigator.vibrate) navigator.vibrate([120, 80, 120])
  }, [corridor])

  return (
    <>
      {showCorridorBanner && corridor && (
        <div
          style={{
            position: 'fixed',
            top: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5200,
            pointerEvents: 'none',
            padding: '8px 14px',
            borderRadius: 12,
            border: '1px solid rgba(255,68,102,0.7)',
            background: 'rgba(60,10,22,0.82)',
            boxShadow: '0 0 26px rgba(255,68,102,0.42)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: '#ffd8df',
          }}
        >
          ⚠ CORRIDOR BREACH · RETURN TO ROUTE · DIST {Math.round(corridor.distFt)}FT
        </div>
      )}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
          transform: 'translateX(-50%)',
          zIndex: 5000,
          pointerEvents: 'none',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          maxWidth: 'min(96vw, 980px)',
          justifyContent: 'center',
          padding: '6px 10px',
          borderRadius: 999,
          border: corridor?.severity && corridor.severity >= 5
            ? '1px solid rgba(255,88,122,0.45)'
            : '1px solid rgba(199,206,198,0.24)',
          background: corridor?.severity && corridor.severity >= 5
            ? 'rgba(35,8,15,0.72)'
            : 'rgba(10,12,13,0.6)',
          backdropFilter: 'blur(10px)',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 10,
          letterSpacing: '0.08em',
          color: '#b8c1b9',
        }}
      >
        <span>{gpsText}</span>
        <span>BAT {battPct}</span>
        <span>NET {online ? 'ON' : 'OFF'}</span>
        <span>WX {wxAge}</span>
        <span>SYS {runtimeGuards ? 'GUARDS ON' : 'GUARDS OFF'}</span>
        <span>BUILD {buildStamp}</span>
        <span>
          CORRIDOR {corridor ? `${corridor.zone} · EDGE ${corridor.edgeFt}FT` : '--'}
        </span>
      </div>
    </>
  )
}
