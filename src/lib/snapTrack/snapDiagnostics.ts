import {
  SNAP_GPS_DIAG_DEFAULT,
  updateSnapGpsDiagnostics,
  type SnapGpsDiagnosticsSnapshot,
} from '../../runtime/runtimeSnapshot'
import { readSnapFeatureFlags } from './snapFeatureFlags'
import type { GpsRejectReason } from './gpsQualityGate'
import type { SnapRejectReason } from './snapValidation'
import type { SnapPipelinePhase } from './types'

const STORAGE_KEY = 'hud_snap_gps_diag_v1'
const MAX_EVENTS = 40

export type SnapDiagnosticEvent = {
  ts: number
  kind: 'raw_ingest' | 'waypoint_snap' | 'pipeline'
  phase: SnapPipelinePhase | 'observed'
  rawAccuracyM: number | null
  gpsAgeMs: number | null
  snapDistanceM: number | null
  confidence: number | null
  providerId: string
  providerLatencyMs: number | null
  gpsRejectReasons: string[]
  snapRejectReasons: string[]
  message?: string
}

type PersistedDiagnostics = {
  events: SnapDiagnosticEvent[]
  counters: {
    rejectedPointCount: number
    acceptedSnapCount: number
    deferredSnapCount: number
    fallbackCount: number
    validationPassCount: number
    validationFailCount: number
  }
  rejectReasonHistogram: Record<string, number>
}

export type WaypointDropObservation = {
  dropId: number
  tapLat: number
  tapLng: number
  rawLat: number
  rawLng: number
  rawAccuracyM: number | null
  tier1Source: 'snapped' | 'raw'
  tier1Lat: number
  tier1Lng: number
  tier1SnapAttempted: boolean
  tier1SnapAccepted: boolean
  tier1SnapDistanceM: number | null
  tier1Confidence: number | null
  pipelineEnabled: boolean
  validationEnabled: boolean
  diagnosticsEnabled: boolean
  pipelinePhase: SnapPipelinePhase | 'idle'
  providerId: string
  pipelineLatencyMs: number | null
  pipelineSnapDistanceM: number | null
  pipelineConfidence: number | null
  validationOutcome: 'pass' | 'fail' | 'skipped'
  fallbackUsed: boolean
  gpsRejectReasons: string[]
  snapRejectReasons: string[]
  elapsedMs: number
  message?: string
}

let memory: PersistedDiagnostics = loadPersisted()
let lastRawIngestAt = 0
const RAW_INGEST_MIN_MS = 2000
let persistScheduled = false

function loadPersisted(): PersistedDiagnostics {
  if (typeof localStorage === 'undefined') {
    return {
      events: [],
      counters: {
        rejectedPointCount: 0,
        acceptedSnapCount: 0,
        deferredSnapCount: 0,
        fallbackCount: 0,
        validationPassCount: 0,
        validationFailCount: 0,
      },
      rejectReasonHistogram: {},
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        events: [],
        counters: {
          rejectedPointCount: 0,
          acceptedSnapCount: 0,
          deferredSnapCount: 0,
          fallbackCount: 0,
          validationPassCount: 0,
          validationFailCount: 0,
        },
        rejectReasonHistogram: {},
      }
    }
    const parsed = JSON.parse(raw) as PersistedDiagnostics
    if (!Array.isArray(parsed.events)) throw new Error('invalid')
    return {
      events: parsed.events.slice(-MAX_EVENTS),
      counters: parsed.counters ?? {
        rejectedPointCount: 0,
        acceptedSnapCount: 0,
        deferredSnapCount: 0,
        fallbackCount: 0,
        validationPassCount: 0,
        validationFailCount: 0,
      },
      rejectReasonHistogram: parsed.rejectReasonHistogram ?? {},
    }
  } catch {
    return {
      events: [],
      counters: {
        rejectedPointCount: 0,
        acceptedSnapCount: 0,
        deferredSnapCount: 0,
        fallbackCount: 0,
        validationPassCount: 0,
        validationFailCount: 0,
      },
      rejectReasonHistogram: {},
    }
  }
}

function persistSoon(): void {
  if (persistScheduled) return
  persistScheduled = true
  setTimeout(() => {
    persistScheduled = false
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
    } catch {
      /* quota / private mode */
    }
  }, 1200)
}

function bumpHistogram(reasons: string[]): void {
  for (const r of reasons) {
    memory.rejectReasonHistogram[r] = (memory.rejectReasonHistogram[r] ?? 0) + 1
  }
}

function flagsSnapshot(): Pick<
  SnapGpsDiagnosticsSnapshot,
  'pipelineEnabled' | 'validationEnabled' | 'diagnosticsEnabled'
> {
  const f = readSnapFeatureFlags()
  return {
    pipelineEnabled: f.pipelineEnabled,
    validationEnabled: f.validationEnabled,
    diagnosticsEnabled: f.diagnosticsEnabled,
  }
}

function pushEvent(ev: SnapDiagnosticEvent): void {
  memory.events.push(ev)
  if (memory.events.length > MAX_EVENTS) memory.events.shift()

  if (ev.phase === 'accepted') memory.counters.acceptedSnapCount++
  else if (ev.phase === 'deferred') memory.counters.deferredSnapCount++
  else if (ev.phase === 'rejected') memory.counters.rejectedPointCount++

  bumpHistogram([...ev.gpsRejectReasons, ...ev.snapRejectReasons])

  const snapshot: Partial<SnapGpsDiagnosticsSnapshot> = {
    ...flagsSnapshot(),
    activeProvider: ev.providerId,
    lastRawAccuracyM: ev.rawAccuracyM,
    lastGpsAgeMs: ev.gpsAgeMs,
    lastSnapConfidence: ev.confidence,
    lastSnapDistanceM: ev.snapDistanceM,
    lastProviderLatencyMs: ev.providerLatencyMs,
    rejectedPointCount: memory.counters.rejectedPointCount,
    acceptedSnapCount: memory.counters.acceptedSnapCount,
    deferredSnapCount: memory.counters.deferredSnapCount,
    fallbackCount: memory.counters.fallbackCount,
    validationPassCount: memory.counters.validationPassCount,
    validationFailCount: memory.counters.validationFailCount,
    lastRejectReasons: [...ev.gpsRejectReasons, ...ev.snapRejectReasons].slice(0, 6),
    rejectReasonHistogram: { ...memory.rejectReasonHistogram },
    lastEventAt: ev.ts,
    pipelinePhase: ev.phase,
    recentEvents: memory.events.slice(-8).map((e) => ({
      ts: e.ts,
      kind: e.kind,
      phase: e.phase,
      msg:
        e.message ??
        ([...e.gpsRejectReasons, ...e.snapRejectReasons].join(', ') || e.providerId),
    })),
  }

  updateSnapGpsDiagnostics(snapshot)
  persistSoon()

  try {
    console.info('[snap-gps-diag]', ev)
  } catch {
    /* ignore */
  }
}

/** Navigation monitor — raw GPS observability only (does not snap). */
export function ingestNavigationGpsSample(input: {
  lat: number
  lng: number
  accuracy: number | null
  timestampMs?: number
  source?: 'gps' | 'cached' | 'ip'
}): void {
  const now = Date.now()
  if (now - lastRawIngestAt < RAW_INGEST_MIN_MS) return
  lastRawIngestAt = now
  const ts = input.timestampMs ?? now
  pushEvent({
    ts,
    kind: 'raw_ingest',
    phase: 'observed',
    rawAccuracyM: input.accuracy,
    gpsAgeMs: Math.max(0, Date.now() - ts),
    snapDistanceM: null,
    confidence: null,
    providerId: 'none',
    providerLatencyMs: null,
    gpsRejectReasons: [],
    snapRejectReasons: [],
    message: `raw ${input.lat.toFixed(5)},${input.lng.toFixed(5)} acc=${input.accuracy ?? '—'}m`,
  })
}

/** Phase 1b — structured waypoint drop observation (MapCanvas post-commit). */
export function recordWaypointDropObservation(obs: WaypointDropObservation): void {
  if (obs.validationOutcome === 'pass') memory.counters.validationPassCount++
  if (obs.validationOutcome === 'fail') memory.counters.validationFailCount++
  if (obs.fallbackUsed) memory.counters.fallbackCount++

  pushEvent({
    ts: Date.now(),
    kind: 'waypoint_snap',
    phase:
      obs.pipelinePhase === 'accepted' || obs.tier1SnapAccepted
        ? 'accepted'
        : obs.pipelinePhase === 'deferred'
          ? 'deferred'
          : 'rejected',
    rawAccuracyM: obs.rawAccuracyM,
    gpsAgeMs: null,
    snapDistanceM: obs.pipelineSnapDistanceM ?? obs.tier1SnapDistanceM,
    confidence: obs.pipelineConfidence ?? obs.tier1Confidence,
    providerId: obs.providerId,
    providerLatencyMs: obs.pipelineLatencyMs ?? Math.round(obs.elapsedMs),
    gpsRejectReasons: obs.gpsRejectReasons,
    snapRejectReasons: obs.snapRejectReasons,
    message:
      obs.message ??
      [
        `drop#${obs.dropId}`,
        `tier1=${obs.tier1Source}`,
        `validation=${obs.validationOutcome}`,
        obs.fallbackUsed ? 'fallback' : null,
        `${Math.round(obs.elapsedMs)}ms`,
      ]
        .filter(Boolean)
        .join(' '),
  })

  updateSnapGpsDiagnostics({
    ...flagsSnapshot(),
    lastValidationOutcome: obs.validationOutcome,
    lastFallbackUsed: obs.fallbackUsed,
    fallbackCount: memory.counters.fallbackCount,
    validationPassCount: memory.counters.validationPassCount,
    validationFailCount: memory.counters.validationFailCount,
    rejectReasonHistogram: { ...memory.rejectReasonHistogram },
    lastProviderLatencyMs: obs.pipelineLatencyMs ?? Math.round(obs.elapsedMs),
  })
}

/** Legacy helper — prefer recordWaypointDropObservation. */
export function recordWaypointSnapOutcome(input: {
  accepted: boolean
  snapDistanceM: number | null
  confidence: number | null
  providerId?: string
  rawAccuracyM?: number | null
  gpsRejectReasons?: GpsRejectReason[]
  snapRejectReasons?: SnapRejectReason[]
  message?: string
}): void {
  pushEvent({
    ts: Date.now(),
    kind: 'waypoint_snap',
    phase: input.accepted ? 'accepted' : 'rejected',
    rawAccuracyM: input.rawAccuracyM ?? null,
    gpsAgeMs: null,
    snapDistanceM: input.snapDistanceM,
    confidence: input.confidence,
    providerId: input.providerId ?? 'maplibre-local',
    providerLatencyMs: null,
    gpsRejectReasons: input.gpsRejectReasons ?? [],
    snapRejectReasons: input.snapRejectReasons ?? [],
    message: input.message,
  })
}

export function recordPipelineDiagnostic(input: {
  phase: SnapPipelinePhase
  providerId: string
  providerLatencyMs?: number | null
  snapDistanceM?: number | null
  confidence?: number | null
  gpsRejectReasons?: GpsRejectReason[]
  snapRejectReasons?: SnapRejectReason[]
}): void {
  pushEvent({
    ts: Date.now(),
    kind: 'pipeline',
    phase: input.phase,
    rawAccuracyM: null,
    gpsAgeMs: null,
    snapDistanceM: input.snapDistanceM ?? null,
    confidence: input.confidence ?? null,
    providerId: input.providerId,
    providerLatencyMs: input.providerLatencyMs ?? null,
    gpsRejectReasons: input.gpsRejectReasons ?? [],
    snapRejectReasons: input.snapRejectReasons ?? [],
  })
}

export function getSnapDiagnosticEvents(): SnapDiagnosticEvent[] {
  return [...memory.events]
}

export function resetSnapDiagnosticsForTests(): void {
  lastRawIngestAt = 0
  persistScheduled = false
  memory = {
    events: [],
    counters: {
      rejectedPointCount: 0,
      acceptedSnapCount: 0,
      deferredSnapCount: 0,
      fallbackCount: 0,
      validationPassCount: 0,
      validationFailCount: 0,
    },
    rejectReasonHistogram: {},
  }
  updateSnapGpsDiagnostics({ ...SNAP_GPS_DIAG_DEFAULT })
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
}
