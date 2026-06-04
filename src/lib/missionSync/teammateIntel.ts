import { haversineDistance } from '../haversine'
import type { TeamPresence } from './types'

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function bearingLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const idx = Math.round(deg / 45) % 8
  return dirs[idx]!
}

function formatAge(updatedAt: number, nowMs = Date.now()): string {
  const sec = Math.max(0, Math.round((nowMs - updatedAt) / 1000))
  if (sec < 60) return `${sec}s ago`
  return `${Math.round(sec / 60)}m ago`
}

export type TeammateIntelLine = {
  id: string
  label: string
  value: string
}

/** Compact situational readout for map-tap sheet — not a full analytics panel. */
export function buildTeammateIntelLines(
  teammate: TeamPresence,
  self: { lat: number | null; lng: number | null },
  nowMs = Date.now(),
): TeammateIntelLine[] {
  const lines: TeammateIntelLine[] = []
  if (teammate.lat != null && teammate.lng != null && self.lat != null && self.lng != null) {
    const dist = haversineDistance(self.lat, self.lng, teammate.lat, teammate.lng)
    lines.push({
      id: 'dist',
      label: 'Distance',
      value: dist.miles < 0.1 ? 'At your position' : `${dist.miles.toFixed(2)} mi`,
    })
    const brg = bearingDeg(self.lat, self.lng, teammate.lat, teammate.lng)
    lines.push({
      id: 'bearing',
      label: 'Direction',
      value: `${bearingLabel(brg)} (${Math.round(brg)}°)`,
    })
  }
  if (teammate.speedMph != null && Number.isFinite(teammate.speedMph)) {
    lines.push({
      id: 'speed',
      label: 'Speed',
      value: teammate.speedMph < 0.4 ? 'Stopped' : `${teammate.speedMph.toFixed(1)} mph`,
    })
  } else if (teammate.headingDeg != null && Number.isFinite(teammate.headingDeg)) {
    lines.push({
      id: 'heading',
      label: 'Heading',
      value: bearingLabel(teammate.headingDeg),
    })
  }
  if (teammate.elevationM != null && Number.isFinite(teammate.elevationM)) {
    const ft = Math.round(teammate.elevationM * 3.28084)
    lines.push({ id: 'elev', label: 'Elevation', value: `${ft.toLocaleString()} ft` })
  }
  if (teammate.accuracy != null && Number.isFinite(teammate.accuracy)) {
    lines.push({
      id: 'acc',
      label: 'GPS accuracy',
      value: `±${Math.round(teammate.accuracy)} m`,
    })
  }
  lines.push({
    id: 'age',
    label: 'Last fix',
    value: formatAge(teammate.updatedAt, nowMs),
  })
  return lines.slice(0, 5)
}
