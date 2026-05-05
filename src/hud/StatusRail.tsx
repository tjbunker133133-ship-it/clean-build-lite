import { useEffect, useMemo, useRef, useState } from 'react'
import { useGPS } from '../hooks/useGPS'
import { useAppContext } from '../context/AppContext'
import { requestGeolocationPermission } from '../lib/devicePermissions'
import {
  HALF_CORRIDOR_FEET,
  corridorSeverity,
  corridorZoneLabel,
  distancePointToRouteFeet,
} from '../lib/corridor'
import { useMapContext } from '../context/MapContext'

type BatteryManagerLike = { level: number } | null

export default function StatusRail() {
  const gps = useGPS()
  const { state } = useAppContext()
  const { status: mapStatus } = useMapContext()
  const [battery, setBattery] = useState<BatteryManagerLike>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [weatherAgeMin, setWeatherAgeMin] = useState<number | null>(null)
  const [showCorridorBanner, setShowCorridorBanner] = useState(false)
  const [corridorArmed, setCorridorArmed] = useState(false)
  const [requestingGeo, setRequestingGeo] = useState(false)
  const routeChangeAtRef = useRef<number>(Date.now())
  const lastRouteSigRef = useRef<string>('')

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

  const gpsText = useMemo(() => {
    if (gps.lat != null && gps.lng != null) return 'GPS LOCK'
    if (gps.status === 'denied') return 'GPS DENIED'
    if (gps.status === 'unsupported') return 'GPS UNSUPPORTED'
    if (gps.status === 'error') return 'GPS ERR'
    return 'GPS SEARCH'
  }, [gps.lat, gps.lng, gps.status])
  const battPct = useMemo(() => {
    if (battery) return `${Math.round(battery.level * 100)}%`
    const isiOS =
      typeof navigator !== 'undefined' &&
      /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
    return isiOS ? 'N/A' : '--'
  }, [battery])
  const wxAge = weatherAgeMin == null ? '--' : `${weatherAgeMin}m`
  const runtimeGuards = typeof window !== 'undefined' && !!(window as any).__hudRuntimeGuards
  const buildStampRaw =
    (import.meta as any)?.env?.VITE_BUILD_STAMP && typeof (import.meta as any).env.VITE_BUILD_STAMP === 'string'
      ? (import.meta as any).env.VITE_BUILD_STAMP
      : ''
  const buildStamp = buildStampRaw
    ? buildStampRaw.replace('T', ' ').slice(0, 16)
    : 'unknown'
  const mapText =
    mapStatus === 'ready'
      ? 'MAP OK'
      : mapStatus === 'unsupported'
        ? 'MAP UNSUPPORTED · STATIC ONLY'
        : mapStatus === 'fallback'
          ? 'MAP FALLBACK'
          : 'MAP BOOT'
  const corridor = useMemo(() => {
    if (gps.lat == null || gps.lng == null || state.waypoints.length < 2) return null
    const route = state.waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))
    const distFt = distancePointToRouteFeet({ lat: gps.lat, lng: gps.lng }, route)
    const severity = corridorSeverity(distFt, HALF_CORRIDOR_FEET)
    const edgeFt = Math.max(0, Math.round(HALF_CORRIDOR_FEET - distFt))
    return { distFt, severity, edgeFt, zone: corridorZoneLabel(severity) }
  }, [gps.lat, gps.lng, state.waypoints])

  useEffect(() => {
    const sig = state.waypoints.map((w) => `${w.id}:${w.lat.toFixed(5)}:${w.lng.toFixed(5)}`).join('|')
    if (sig !== lastRouteSigRef.current) {
      lastRouteSigRef.current = sig
      routeChangeAtRef.current = Date.now()
      setCorridorArmed(false)
    }
  }, [state.waypoints])

  useEffect(() => {
    if (!corridor) {
      setCorridorArmed(false)
      return
    }
    if (corridorArmed) return
    // Arm only after user has truly entered corridor bounds at least once.
    if (corridor.severity < 6) {
      setCorridorArmed(true)
    }
  }, [corridor, corridorArmed])

  const promptLocation = async () => {
    if (requestingGeo) return
    setRequestingGeo(true)
    try {
      const s = await requestGeolocationPermission()
      if (s === 'denied') {
        window.dispatchEvent(new CustomEvent('hud:show-permissions'))
      }
    } finally {
      setRequestingGeo(false)
    }
  }

  const openPermissionHelp = () => {
    window.dispatchEvent(new CustomEvent('hud:show-permissions'))
  }

  useEffect(() => {
    if (!corridor) {
      setShowCorridorBanner(false)
      return
    }
    // Avoid false alarm flashes while actively editing/planning route points.
    const recentlyEditedRoute = Date.now() - routeChangeAtRef.current < 15000
    if (recentlyEditedRoute) {
      setShowCorridorBanner(false)
      return
    }
    if (!corridorArmed) {
      setShowCorridorBanner(false)
      return
    }
    const breach = corridor.severity >= 6
    setShowCorridorBanner(breach)
    if (breach && navigator.vibrate) navigator.vibrate([120, 80, 120])
  }, [corridor, corridorArmed])

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
          border: corridorArmed && corridor?.severity && corridor.severity >= 5
            ? '1px solid rgba(255,88,122,0.45)'
            : '1px solid rgba(199,206,198,0.24)',
          background: corridorArmed && corridor?.severity && corridor.severity >= 5
            ? 'rgba(35,8,15,0.72)'
            : 'rgba(10,12,13,0.6)',
          backdropFilter: 'blur(10px)',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 10,
          letterSpacing: '0.08em',
          color: '#b8c1b9',
        }}
      >
        {gps.status !== 'locked' && (
          <>
            <button
              type="button"
              onClick={() => void promptLocation()}
              disabled={requestingGeo}
              style={{
                pointerEvents: 'auto',
                minHeight: 26,
                borderRadius: 999,
                border: '1px solid rgba(125,255,138,0.45)',
                background: 'rgba(125,255,138,0.16)',
                color: '#d8f6de',
                padding: '0 10px',
                fontSize: 10,
                letterSpacing: '0.08em',
                cursor: requestingGeo ? 'wait' : 'pointer',
              }}
            >
              {requestingGeo ? 'PROMPTING GPS…' : 'PROMPT GPS'}
            </button>
            {gps.status === 'denied' && (
              <button
                type="button"
                onClick={openPermissionHelp}
                style={{
                  pointerEvents: 'auto',
                  minHeight: 26,
                  borderRadius: 999,
                  border: '1px solid rgba(255,107,135,0.55)',
                  background: 'rgba(255,80,100,0.2)',
                  color: '#ffd0d8',
                  padding: '0 10px',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                }}
              >
                LOCATION DENIED — HELP
              </button>
            )}
          </>
        )}
        <span>{gpsText}</span>
        <span>BAT {battPct}</span>
        <span>NET {online ? 'ON' : 'OFF'}</span>
        <span>WX {wxAge}</span>
        <span>SYS {runtimeGuards ? 'GUARDS ON' : 'GUARDS OFF'}</span>
        <span>BUILD {buildStamp}</span>
        <span>{mapText}</span>
        <span>
          CORRIDOR {corridor
            ? corridorArmed
              ? `${corridor.zone} · EDGE ${corridor.edgeFt}FT`
              : 'PLANNING · ENTER CORRIDOR TO ARM'
            : '--'}
        </span>
      </div>
    </>
  )
}
