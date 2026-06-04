import type { Map } from 'maplibre-gl'
import { haversineMeters } from '../haversine'
import { confidenceFromSnapDistance } from './snapProvider'
import { getIosFieldCapabilityReport } from '../iosFieldCapabilities'
import { readSnapFeatureFlags } from './snapFeatureFlags'
import { createMapLibreTrailProvider } from './mapLibreTrailProvider'
import { SnapPipeline } from './snapPipeline'
import {
  recordWaypointDropObservation,
  type WaypointDropObservation,
} from './snapDiagnostics'
import { validateSnapResult } from './snapValidation'
import type { RawGpsPoint } from './types'

export type Tier1WaypointDropOutcome = {
  committed: boolean
  source: 'snapped' | 'raw'
  lat: number
  lng: number
  rawLat: number
  rawLng: number
  snapDistanceMeters: number | null
  tier1SnapAttempted: boolean
  tier1SnapAccepted: boolean
}

export type WaypointDropObserveInput = {
  getMap: () => Map | null
  tapLat: number
  tapLng: number
  deviceGps?: {
    lat: number
    lng: number
    accuracy: number | null
    source?: 'gps' | 'cached' | 'ip'
  }
  tier1: Tier1WaypointDropOutcome
}

let latestDropId = 0

/**
 * Post-commit observation only — Tier 1 placement has already completed.
 * Never blocks, never mutates waypoints, never replaces the placement engine.
 */
export function observeWaypointDropAfterCommit(input: WaypointDropObserveInput): void {
  const flags = readSnapFeatureFlags()
  if (!flags.diagnosticsEnabled && !flags.pipelineEnabled) return

  const dropId = ++latestDropId
  const started = performance.now()

  const rawPoint: RawGpsPoint = {
    lat: input.tier1.rawLat,
    lng: input.tier1.rawLng,
    accuracy: input.deviceGps?.accuracy ?? null,
    heading: null,
    speed: null,
    timestampMs: Date.now(),
    source: input.deviceGps?.source,
  }

  const tier1Confidence =
    input.tier1.snapDistanceMeters != null
      ? confidenceFromSnapDistance(input.tier1.snapDistanceMeters, 30)
      : null

  const baseObservation: Omit<WaypointDropObservation, 'elapsedMs'> = {
    dropId,
    tapLat: input.tapLat,
    tapLng: input.tapLng,
    rawLat: rawPoint.lat,
    rawLng: rawPoint.lng,
    rawAccuracyM: rawPoint.accuracy,
    tier1Source: input.tier1.source,
    tier1Lat: input.tier1.lat,
    tier1Lng: input.tier1.lng,
    tier1SnapAttempted: input.tier1.tier1SnapAttempted,
    tier1SnapAccepted: input.tier1.tier1SnapAccepted,
    tier1SnapDistanceM: input.tier1.snapDistanceMeters,
    tier1Confidence: tier1Confidence,
    pipelineEnabled: flags.pipelineEnabled,
    validationEnabled: flags.validationEnabled,
    diagnosticsEnabled: flags.diagnosticsEnabled,
    pipelinePhase: 'idle',
    providerId: 'maplibre-local',
    pipelineLatencyMs: null,
    pipelineSnapDistanceM: null,
    pipelineConfidence: null,
    validationOutcome: flags.pipelineEnabled && flags.validationEnabled ? 'skipped' : 'skipped',
    fallbackUsed: false,
    gpsRejectReasons: [],
    snapRejectReasons: [],
  }

  if (!flags.pipelineEnabled) {
    recordWaypointDropObservation({
      ...baseObservation,
      elapsedMs: performance.now() - started,
      pipelinePhase: 'idle',
      validationOutcome: 'skipped',
      message: [
        input.tier1.tier1SnapAccepted
          ? `tier1 snap ok ${input.tier1.snapDistanceMeters?.toFixed(1) ?? '—'}m`
          : input.tier1.tier1SnapAttempted
            ? 'tier1 snap miss — raw drop'
            : 'tier1 raw drop',
        getIosFieldCapabilityReport().isIosFieldHud ? 'ios_raster_outdoor' : null,
      ]
        .filter(Boolean)
        .join(' '),
    })
    return
  }

  void runPipelineObservation(dropId, started, rawPoint, input, baseObservation, flags)
}

async function runPipelineObservation(
  dropId: number,
  started: number,
  rawPoint: RawGpsPoint,
  input: WaypointDropObserveInput,
  base: Omit<WaypointDropObservation, 'elapsedMs'>,
  flags: ReturnType<typeof readSnapFeatureFlags>,
): Promise<void> {
  const map = input.getMap()
  if (!map) {
    recordWaypointDropObservation({
      ...base,
      elapsedMs: performance.now() - started,
      pipelinePhase: 'rejected',
      fallbackUsed: true,
      validationOutcome: 'skipped',
      message: 'pipeline skipped — map unavailable',
    })
    return
  }

  const provider = createMapLibreTrailProvider({ getMap: () => map })
  const pipeline = new SnapPipeline({
    provider,
    onDiagnostic: () => {
      /* bridge records consolidated outcome below */
    },
  })

  let result
  try {
    result = await pipeline.process(rawPoint)
  } catch (err) {
    recordWaypointDropObservation({
      ...base,
      elapsedMs: performance.now() - started,
      pipelinePhase: 'rejected',
      fallbackUsed: true,
      validationOutcome: 'fail',
      message: `pipeline error — tier1 preserved: ${err instanceof Error ? err.message : String(err)}`,
    })
    return
  }

  if (dropId !== latestDropId) {
    return
  }

  const elapsedMs = performance.now() - started
  let validationOutcome: WaypointDropObservation['validationOutcome'] = 'skipped'
  let fallbackUsed = false
  const snapRejectReasons = [...result.snapRejectReasons]
  const gpsRejectReasons = [...result.gpsRejectReasons]

  const pipelineSnap = result.snapped
  const pipelineDistanceM = pipelineSnap?.snapDistanceMeters ?? null
  const pipelineConfidence = pipelineSnap?.confidenceScore ?? null

  if (flags.validationEnabled && input.tier1.tier1SnapAccepted && pipelineSnap) {
    const tier1VsPipelineM = haversineMeters(
      input.tier1.lat,
      input.tier1.lng,
      pipelineSnap.snappedLat,
      pipelineSnap.snappedLng,
    )
    const validation = validateSnapResult(rawPoint, pipelineSnap)
    if (!validation.accept) {
      validationOutcome = 'fail'
      fallbackUsed = true
      snapRejectReasons.push(...validation.reasons)
    } else if (tier1VsPipelineM > 8) {
      validationOutcome = 'fail'
      fallbackUsed = true
      snapRejectReasons.push('snap_distance_exceeded')
    } else {
      validationOutcome = 'pass'
    }
  } else if (flags.validationEnabled && input.tier1.tier1SnapAccepted && !pipelineSnap) {
    validationOutcome = 'fail'
    fallbackUsed = true
    snapRejectReasons.push('provider_empty')
  } else if (pipelineSnap && result.phase === 'accepted') {
    validationOutcome = 'pass'
  } else if (result.phase === 'deferred' || result.phase === 'rejected') {
    validationOutcome = input.tier1.committed ? 'fail' : 'skipped'
    fallbackUsed = input.tier1.committed
  }

  const deltaM =
    pipelineSnap != null
      ? haversineMeters(input.tier1.lat, input.tier1.lng, pipelineSnap.snappedLat, pipelineSnap.snappedLng)
      : null

  recordWaypointDropObservation({
    ...base,
    elapsedMs,
    pipelinePhase: result.phase,
    providerId: result.providerId,
    pipelineLatencyMs: result.providerLatencyMs,
    pipelineSnapDistanceM: pipelineDistanceM,
    pipelineConfidence,
    validationOutcome,
    fallbackUsed,
    gpsRejectReasons,
    snapRejectReasons,
    message: [
      `tier1=${input.tier1.source}`,
      `pipeline=${result.phase}`,
      validationOutcome !== 'skipped' ? `validation=${validationOutcome}` : null,
      fallbackUsed ? 'fallback=tier1' : null,
      deltaM != null ? `delta=${deltaM.toFixed(1)}m` : null,
    ]
      .filter(Boolean)
      .join(' '),
  })
}

/** Test-only: reset monotonic drop id. */
export function resetWaypointSnapBridgeForTests(): void {
  latestDropId = 0
}
