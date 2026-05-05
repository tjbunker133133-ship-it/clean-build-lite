import { useEffect, useRef, useState } from 'react'
import { useMapContext } from '../context/MapContext'
import HudPanel from './HudPanel'
import { useGPS } from '../hooks/useGPS'
import { fetchElevationMeters } from '../lib/elevation'

function distMi(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.7613
  const p = Math.PI / 180
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    (Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p))) /
      2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(Math.max(0, a))))
}

type Band = 'low' | 'mid' | 'high' | 'na'

function bandForFt(ft: number): Band {
  if (ft < 8000) return 'low'
  if (ft <= 10000) return 'mid'
  return 'high'
}

/**
 * Sticky tactical elevation readout — MapLibre terrain if available, else smooth mock.
 * COCKPIT_UX v2: ft + trend + grade + color band.
 */
export default function ElevationReadout() {
  const { map } = useMapContext()
  const gps = useGPS()
  const [main, setMain] = useState('— ft')
  const [trend, setTrend] = useState('—')
  const [grade, setGrade] = useState('grade —')
  const [band, setBand] = useState<Band>('na')
  const prev = useRef<{
    ft: number
    lat: number
    lng: number
  } | null>(null)

  useEffect(() => {
    if (!map) return

    const sample = async () => {
      const c = map.getCenter()
      const q = map as { queryTerrainElevation?: (ll: { lng: number; lat: number }) => number | null }
      let m: number | null = null
      try {
        m = q.queryTerrainElevation?.(c) ?? null
      } catch {
        m = null
      }
      if ((m == null || Number.isNaN(m)) && gps.lat != null && gps.lng != null) {
        m = await fetchElevationMeters(gps.lat, gps.lng)
      }
      if (m == null || Number.isNaN(m)) {
        m =
          1200 +
          Math.sin(c.lat * 0.12) * 400 +
          Math.cos(c.lng * 0.1) * 300 +
          (c.lat + c.lng) * 3
      }
      const ft = m * 3.28084
      const rounded = Math.round(ft)
      setMain(`${rounded.toLocaleString('en-US')} ft`)
      setBand(bandForFt(ft))

      const p = prev.current
      if (p) {
        const dMi = distMi(p.lat, p.lng, c.lat, c.lng)
        const dFt = rounded - p.ft
        if (dMi > 0.02) {
          const arrow = dFt >= 0 ? '▲' : '▼'
          setTrend(
            `${arrow} ${dFt >= 0 ? '+' : ''}${Math.round(dFt)} ft / ${dMi.toFixed(2)} mi`,
          )
          const runFt = dMi * 5280
          if (runFt > 1) {
            const ang = (Math.atan2(Math.abs(dFt), runFt) * 180) / Math.PI
            setGrade(`grade ${ang.toFixed(1)}°`)
          } else setGrade('grade —')
        } else {
          setTrend('—')
          setGrade('grade —')
        }
      } else {
        setTrend('—')
        setGrade('grade —')
      }
      prev.current = { ft: rounded, lat: c.lat, lng: c.lng }
    }

    map.on('moveend', sample)
    map.on('idle', sample)
    void sample()
    return () => {
      map.off('moveend', sample)
      map.off('idle', sample)
    }
  }, [map, gps.lat, gps.lng])

  const color =
    band === 'low'
      ? '#b7c8b1'
      : band === 'mid'
        ? '#b8c2bf'
        : band === 'high'
          ? '#c6b79d'
          : '#9fa9a7'

  return (
    <HudPanel
      panelId="elevation"
      title="Elevation"
      initialPos={{ x: 420, y: 60 }}
      initialWidth={240}
      minHeight={84}
      accent={color}
    >
      <div
        role="status"
        aria-live="polite"
        style={{
          minWidth: 200,
          minHeight: 48,
          padding: '6px 8px',
          borderRadius: 10,
          border: `1px solid ${color}55`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontWeight: 700,
          fontSize: 12,
          color,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700 }}>{main}</div>
        <div style={{ fontSize: 10, opacity: 0.95, whiteSpace: 'nowrap' }}>
          {trend} · {grade}
        </div>
      </div>
    </HudPanel>
  )
}
