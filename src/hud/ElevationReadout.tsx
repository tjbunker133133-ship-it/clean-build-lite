import { useEffect, useRef, useState } from 'react'
import { useMapContext } from '../context/MapContext'
import { usePanelData } from '../context/PanelDataContext'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchFontMd } from './tokens'

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
 * Elevation from Open-Elevation (via PanelDataContext); trend/grade still sample map center motion.
 */
export function ElevationReadoutBody() {
  const { map } = useMapContext()
  const panel = usePanelData()
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
    if (panel.panelsLocationBlocked) {
      setMain('— ft')
      setBand('na')
      setTrend('—')
      setGrade('grade —')
      prev.current = null
      return
    }
    if (panel.elevationLoading && panel.elevationMeters == null) {
      setMain('…')
      setBand('na')
      return
    }
    if (panel.elevationMeters != null) {
      const ft = panel.elevationMeters * 3.28084
      const rounded = Math.round(ft)
      setMain(`${rounded.toLocaleString('en-US')} ft`)
      setBand(bandForFt(ft))
      return
    }
    setMain('— ft')
    setBand('na')
  }, [panel.elevationMeters, panel.elevationLoading, panel.panelsLocationBlocked])

  useEffect(() => {
    if (!map) return

    const sample = () => {
      const c = map.getCenter()

      // UI fallback parity with the voice "elevation" command: when the
      // Open-Elevation network call returned null (well-known API
      // flakiness — CORS, 503, timeout) the panel previously rendered
      // "— ft" while the voice command still reported a real value via
      // the local map terrain DEM. We mirror that primary source here so
      // the UI recovers as soon as the map sample callback runs.
      let terrainMeters: number | null = null
      try {
        const m = (map as unknown as {
          queryTerrainElevation?: (c: unknown) => number | null
        }).queryTerrainElevation?.(c)
        if (m != null && Number.isFinite(m)) terrainMeters = m
      } catch {
        // optional API; absence is normal when terrain DEM is not loaded
      }

      if (
        !panel.panelsLocationBlocked &&
        panel.elevationMeters == null &&
        terrainMeters != null
      ) {
        const ft = terrainMeters * 3.28084
        const rounded = Math.round(ft)
        setMain(`${rounded.toLocaleString('en-US')} ft`)
        setBand(bandForFt(ft))
      }

      const baseFt =
        panel.elevationMeters != null
          ? Math.round(panel.elevationMeters * 3.28084)
          : terrainMeters != null
            ? Math.round(terrainMeters * 3.28084)
            : Math.round(
                (1200 +
                  Math.sin(c.lat * 0.12) * 400 +
                  Math.cos(c.lng * 0.1) * 300 +
                  (c.lat + c.lng) * 3) *
                  3.28084,
              )

      const p = prev.current
      if (p) {
        const dMi = distMi(p.lat, p.lng, c.lat, c.lng)
        const dFt = baseFt - p.ft
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
      prev.current = { ft: baseFt, lat: c.lat, lng: c.lng }
    }

    map.on('moveend', sample)
    map.on('idle', sample)
    void sample()
    return () => {
      map.off('moveend', sample)
      map.off('idle', sample)
    }
  }, [map, panel.elevationMeters, panel.panelsLocationBlocked])

  const color =
    band === 'low'
      ? '#b7c8b1'
      : band === 'mid'
        ? '#b8c2bf'
        : band === 'high'
          ? '#c6b79d'
          : '#9fa9a7'

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)

  return (
    <>
      {panel.panelsLocationBlocked && (
        <div
          style={{
            fontSize: fontSm,
            color: '#f0b4bf',
            textAlign: 'center',
            marginBottom: 6,
            lineHeight: 1.35,
          }}
        >
          Enable location to use weather and elevation features
        </div>
      )}
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
          fontSize: fontMd,
          color,
        }}
      >
        <div style={{ fontSize: isMobile ? 18 : 14, fontWeight: 700 }}>{main}</div>
        <div style={{ fontSize: fontSm, opacity: 0.95, whiteSpace: 'nowrap' }}>
          {trend} · {grade}
        </div>
        {panel.elevationError && !panel.panelsLocationBlocked && (
          <div style={{ fontSize: fontSm, opacity: 0.85, color: '#e7c29a' }}>{panel.elevationError}</div>
        )}
      </div>
    </>
  )
}
