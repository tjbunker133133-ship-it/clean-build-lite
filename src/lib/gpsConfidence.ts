/**
 * GPS confidence tracking — advisory only.
 * Raw GPS coordinates are NEVER modified; this module only assesses fix quality.
 */

export type GpsConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown'

export type GpsConfidenceInput = {
  lat: number
  lng: number
  accuracy: number | null
  timestampMs: number
}

export type GpsConfidenceState = {
  level: GpsConfidenceLevel
  /** True when recent fixes show instability (jumps or poor accuracy). */
  unstable: boolean
  /** Rolling average accuracy in meters when available. */
  avgAccuracyM: number | null
}

const MAX_HISTORY = 48
const LONG_WINDOW_MS = 30 * 60 * 1000
const MAX_TRAVEL_M = 3218 // ~2 miles
const JUMP_THRESHOLD_M = 120
const LOW_ACCURACY_M = 65
const MEDIUM_ACCURACY_M = 30

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const la1 = toRad(lat1)
  const la2 = toRad(lat2)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

type HistoryEntry = GpsConfidenceInput

export class GpsConfidenceTracker {
  private history: HistoryEntry[] = []

  reset(): void {
    this.history = []
  }

  ingest(input: GpsConfidenceInput): GpsConfidenceState {
    const trimmed = this.trimHistory([...this.history, input])
    this.history = trimmed
    return this.assess(trimmed, input)
  }

  private trimHistory(entries: HistoryEntry[]): HistoryEntry[] {
    if (entries.length === 0) return entries
    const latest = entries[entries.length - 1]
    const cutoffTime = latest.timestampMs - LONG_WINDOW_MS
    let travelM = 0
    const kept: HistoryEntry[] = []
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (e.timestampMs < cutoffTime) continue
      if (kept.length > 0) {
        const prev = kept[kept.length - 1]
        travelM += haversineMeters(prev.lat, prev.lng, e.lat, e.lng)
        if (kept.length > 1 && travelM > MAX_TRAVEL_M) {
          kept.shift()
          continue
        }
      }
      kept.push(e)
    }
    return kept.slice(-MAX_HISTORY)
  }

  private assess(history: HistoryEntry[], latest: GpsConfidenceInput): GpsConfidenceState {
    if (history.length === 0) {
      return { level: 'unknown', unstable: false, avgAccuracyM: null }
    }

    const accuracies = history
      .map((h) => h.accuracy)
      .filter((a): a is number => a != null && Number.isFinite(a))
    const avgAccuracyM =
      accuracies.length > 0
        ? accuracies.reduce((s, a) => s + a, 0) / accuracies.length
        : null

    let unstable = false
    if (history.length >= 2) {
      const prev = history[history.length - 2]
      const jumpM = haversineMeters(prev.lat, prev.lng, latest.lat, latest.lng)
      const dtSec = Math.max(0.001, (latest.timestampMs - prev.timestampMs) / 1000)
      const speedMps = jumpM / dtSec
      if (jumpM > JUMP_THRESHOLD_M && speedMps > 80) unstable = true
    }
    if (latest.accuracy != null && latest.accuracy > LOW_ACCURACY_M) unstable = true
    if (avgAccuracyM != null && avgAccuracyM > LOW_ACCURACY_M) unstable = true

    let level: GpsConfidenceLevel = 'unknown'
    const acc = latest.accuracy ?? avgAccuracyM
    if (acc == null) {
      level = unstable ? 'low' : 'medium'
    } else if (acc <= MEDIUM_ACCURACY_M && !unstable) {
      level = 'high'
    } else if (acc <= LOW_ACCURACY_M) {
      level = unstable ? 'low' : 'medium'
    } else {
      level = 'low'
    }

    return { level, unstable, avgAccuracyM }
  }
}

export function gpsConfidenceLabel(state: GpsConfidenceState): string {
  if (state.level === 'high') return 'GPS locked'
  if (state.level === 'medium') return 'GPS fair'
  if (state.level === 'low') return 'GPS low confidence'
  return 'GPS searching'
}
