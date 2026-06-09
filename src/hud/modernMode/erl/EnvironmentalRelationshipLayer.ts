/**
 * Environmental Relationship Layer (ERL) — pure computation service.
 * No UI, no GPS mutation, no rescue interference.
 */

import { haversineMeters } from '../../../lib/haversine'
import { getGPSHealthState } from '../../../runtime/runtimeSnapshot'
import { bearingDeg, computeERLTargets, applySignalSmoothing } from './signals'
import { receiveERLState, clearERLCompositorVars } from './erlCompositor'
import { installERLDevBridge, uninstallERLDevBridge } from './erlDevBridge'
import { getERLPresentationMeta, setERLState, resetERLState } from './erlStore'
import {
  createERLInternalState,
  ERL_STATE_ZERO,
  buildNullFimSnapshot,
  type ERLInternalState,
  type ERLSimulationPatch,
  type ERLState,
  type ERLTickContext,
  type FIMRuntimeSnapshot,
  type LatLng,
} from './types'

const TICK_MS = 2000
const TICK_BUDGET_MS = 100

export class EnvironmentalRelationshipLayer {
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private internal: ERLInternalState = createERLInternalState()
  private contextProvider: (() => ERLTickContext | null) | null = null
  private active = false
  private simulatedFim: Partial<FIMRuntimeSnapshot> | null = null
  private simulatedPatch: ERLSimulationPatch | null = null
  private approachTarget: LatLng | null = null

  setContextProvider(provider: () => ERLTickContext | null): void {
    this.contextProvider = provider
  }

  /** DEV — inject FIM + optional spatial overrides when desktop has no GPS. */
  injectSimulatedMovement(
    overrides: Partial<FIMRuntimeSnapshot>,
    patch?: ERLSimulationPatch,
  ): void {
    this.simulatedFim = overrides
    this.simulatedPatch = patch ?? null
    this.approachTarget = patch?.approachTarget ?? null
  }

  clearSimulatedMovement(): void {
    this.simulatedFim = null
    this.simulatedPatch = null
    this.approachTarget = null
  }

  getSimulatedFimSnapshot(): Partial<FIMRuntimeSnapshot> | null {
    return this.simulatedFim
  }

  getSimulatedPosition(): { lat: number; lng: number } | null {
    return this.simulatedFim?.position ?? null
  }

  getState(): ERLState {
    return { ...this.internal.smoothed }
  }

  handleSOSArmed(): void {
    this.holdZero()
  }

  activate(): void {
    if (this.active) return
    this.active = true
    this.internal = createERLInternalState()
    this.tickInterval = setInterval(() => this.tick(), TICK_MS)
  }

  deactivate(): void {
    this.active = false
    if (this.tickInterval != null) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
    }
    this.clearSimulatedMovement()
    this.reset()
  }

  reset(): void {
    this.internal = createERLInternalState()
    resetERLState()
    clearERLCompositorVars()
  }

  holdZero(): void {
    const zero = { ...ERL_STATE_ZERO }
    this.internal.smoothed = zero
    const presentation = { headingDeg: null, hasHeading: false }
    setERLState(zero, presentation)
    receiveERLState(zero, presentation)
  }

  /** Test hook — runs one ERL tick synchronously. */
  runTickForTests(): void {
    this.tick()
  }

  private offsetPositionMeters(from: LatLng, heading: number, meters: number): LatLng {
    const θ = (heading * Math.PI) / 180
    const δ = meters / 6_371_000
    const φ1 = (from.lat * Math.PI) / 180
    const λ1 = (from.lng * Math.PI) / 180
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
    )
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
      )
    return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI }
  }

  private advanceSimulatedPosition(fim: FIMRuntimeSnapshot, tickIntervalSec: number): FIMRuntimeSnapshot {
    if (!this.approachTarget || !fim.position || fim.speedMps <= 0) return fim

    const dist = haversineMeters(
      fim.position.lat,
      fim.position.lng,
      this.approachTarget.lat,
      this.approachTarget.lng,
    )
    const step = fim.speedMps * tickIntervalSec
    if (dist <= 1 || step <= 0) return fim

    const heading = bearingDeg(fim.position, this.approachTarget)
    const moved = this.offsetPositionMeters(fim.position, heading, Math.min(step, dist))
    this.simulatedFim = { ...this.simulatedFim, position: moved }
    return { ...fim, position: moved, headingDeg: heading, hasHeading: true }
  }

  private resolveContext(raw: ERLTickContext | null): ERLTickContext | null {
    if (!raw) return null

    let ctx = raw
    const simActive = this.simulatedFim != null

    if (simActive || this.simulatedPatch) {
      const mergedFim: FIMRuntimeSnapshot = {
        ...buildNullFimSnapshot(),
        ...raw.fim,
        ...(this.simulatedFim ?? {}),
      }
      if (this.simulatedFim?.position) {
        mergedFim.gpsUncertain = this.simulatedFim.gpsUncertain ?? false
        if (this.simulatedFim.hasHeading == null && mergedFim.headingDeg != null) {
          mergedFim.hasHeading = true
        }
      }
      const tickIntervalSec =
        this.internal.lastTickMs > 0
          ? Math.max(1, (Date.now() - this.internal.lastTickMs) / 1000)
          : TICK_MS / 1000
      const advancedFim = this.advanceSimulatedPosition(mergedFim, tickIntervalSec)
      const { approachTarget: _omit, ...tickPatch } = this.simulatedPatch ?? {}
      ctx = {
        ...raw,
        ...tickPatch,
        fim: advancedFim,
      }
    }

    if (ctx.sosActive) return ctx

    if (!ctx.fim.position) return null
    if (ctx.fim.gpsUncertain && !(simActive && this.simulatedFim?.position)) return null

    return ctx
  }

  private tick(): void {
    const started = performance.now()
    const provider = this.contextProvider
    if (!provider) return

    const gpsHealth = getGPSHealthState()
    if (gpsHealth === 'stale' || gpsHealth === 'degraded') {
      const held = { ...this.internal.smoothed }
      const presentation = getERLPresentationMeta()
      setERLState(held, presentation)
      receiveERLState(held, presentation)
      return
    }

    const ctx = this.resolveContext(provider())
    if (!ctx) return

    if (ctx.sosActive) {
      this.holdZero()
      return
    }

    const nowMs = Date.now()
    const tickIntervalSec =
      this.internal.lastTickMs > 0
        ? Math.max(1, (nowMs - this.internal.lastTickMs) / 1000)
        : TICK_MS / 1000
    this.internal.lastTickMs = nowMs

    const ctxWithInterval = { ...ctx, tickIntervalSec }
    const targets = computeERLTargets(ctxWithInterval, this.internal, nowMs)
    this.internal.smoothed = applySignalSmoothing(this.internal.smoothed, targets)

    if (performance.now() - started > TICK_BUDGET_MS) {
      console.warn('[ERL] tick exceeded budget — skipped compositor push')
      return
    }

    const presentation = {
      headingDeg: ctx.fim.headingDeg,
      hasHeading: ctx.fim.hasHeading,
    }
    setERLState(this.internal.smoothed, presentation)
    receiveERLState(this.internal.smoothed, presentation)
  }
}

let singleton: EnvironmentalRelationshipLayer | null = null

export function getEnvironmentalRelationshipLayer(): EnvironmentalRelationshipLayer {
  if (!singleton) {
    singleton = new EnvironmentalRelationshipLayer()
    installERLDevBridge(singleton)
  }
  return singleton
}

export function __resetERLForTests(): void {
  singleton?.deactivate()
  uninstallERLDevBridge()
  singleton = null
}
