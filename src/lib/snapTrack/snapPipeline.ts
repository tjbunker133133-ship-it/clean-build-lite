import {
  createGpsQualityGateState,
  evaluateGpsQuality,
  type GpsQualityGateState,
  type GpsRejectReason,
} from './gpsQualityGate'
import type { SnapProvider } from './snapProvider'
import { validateSnapResult, type SnapRejectReason } from './snapValidation'
import type { DualTrackSample, RawGpsPoint, SnapPipelinePhase, SnappedTrackPoint } from './types'

export type SnapPipelineResult = {
  raw: RawGpsPoint
  snapped: SnappedTrackPoint | null
  phase: SnapPipelinePhase
  gpsRejectReasons: GpsRejectReason[]
  snapRejectReasons: SnapRejectReason[]
  providerId: string
  providerLatencyMs: number | null
  requestId: number
}

export type SnapPipelineOptions = {
  provider: SnapProvider
  gateState?: GpsQualityGateState
  onDiagnostic?: (partial: SnapPipelineDiagnosticEvent) => void
}

export type SnapPipelineDiagnosticEvent = {
  phase: SnapPipelinePhase
  requestId: number
  gpsRejectReasons?: GpsRejectReason[]
  snapRejectReasons?: SnapRejectReason[]
  providerId?: string
  providerLatencyMs?: number | null
  snapDistanceM?: number | null
  confidence?: number | null
}

let nextRequestId = 1

export class SnapPipeline {
  private gateState: GpsQualityGateState
  private inFlightId = 0

  constructor(private readonly opts: SnapPipelineOptions) {
    this.gateState = opts.gateState ?? createGpsQualityGateState()
  }

  getGateState(): GpsQualityGateState {
    return this.gateState
  }

  /**
   * Runs validation → snap → validation. Stale in-flight responses are ignored
   * when a newer requestId was issued (monotonic).
   */
  async process(raw: RawGpsPoint): Promise<SnapPipelineResult> {
    const requestId = nextRequestId++
    this.inFlightId = requestId
    const emit = (e: SnapPipelineDiagnosticEvent) => this.opts.onDiagnostic?.(e)

    emit({ phase: 'raw_capture', requestId })

    const gate = evaluateGpsQuality(raw, this.gateState)
    if (!gate.accept) {
      emit({ phase: 'deferred', requestId, gpsRejectReasons: gate.reasons })
      return {
        raw,
        snapped: null,
        phase: gate.defer ? 'deferred' : 'rejected',
        gpsRejectReasons: gate.reasons,
        snapRejectReasons: [],
        providerId: 'none',
        providerLatencyMs: null,
        requestId,
      }
    }

    emit({ phase: 'gps_validation', requestId })

    const provider = this.opts.provider
    if (!provider.isAvailable()) {
      emit({ phase: 'rejected', requestId, providerId: provider.id })
      return {
        raw,
        snapped: null,
        phase: 'rejected',
        gpsRejectReasons: [],
        snapRejectReasons: ['provider_empty'],
        providerId: provider.id,
        providerLatencyMs: null,
        requestId,
      }
    }

    emit({ phase: 'snap_request', requestId, providerId: provider.id })
    const started = performance.now()
    const candidate = await provider.snap({ raw, radiusMeters: 30 })
    const latencyMs = performance.now() - started

    if (requestId !== this.inFlightId) {
      return {
        raw,
        snapped: null,
        phase: 'rejected',
        gpsRejectReasons: [],
        snapRejectReasons: [],
        providerId: provider.id,
        providerLatencyMs: latencyMs,
        requestId,
      }
    }

    const validation = validateSnapResult(raw, candidate)
    if (!validation.accept) {
      emit({
        phase: 'rejected',
        requestId,
        snapRejectReasons: validation.reasons,
        providerId: provider.id,
        providerLatencyMs: latencyMs,
      })
      return {
        raw,
        snapped: null,
        phase: 'rejected',
        gpsRejectReasons: [],
        snapRejectReasons: validation.reasons,
        providerId: provider.id,
        providerLatencyMs: latencyMs,
        requestId,
      }
    }

    emit({
      phase: 'accepted',
      requestId,
      providerId: provider.id,
      providerLatencyMs: latencyMs,
      snapDistanceM: validation.snapped.snapDistanceMeters,
      confidence: validation.snapped.confidenceScore,
    })

    return {
      raw,
      snapped: validation.snapped,
      phase: 'accepted',
      gpsRejectReasons: [],
      snapRejectReasons: [],
      providerId: provider.id,
      providerLatencyMs: latencyMs,
      requestId,
    }
  }

  toSample(result: SnapPipelineResult): DualTrackSample {
    return {
      raw: result.raw,
      snapped: result.snapped,
      phase: result.phase,
    }
  }
}
