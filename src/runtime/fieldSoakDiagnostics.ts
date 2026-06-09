/**
 * Field soak diagnostics — prolonged session observability for device validation.
 * Zero overhead unless e2e=1, __HUD_SOAK__, or VITE_HUD_TELEMETRY=true.
 */

import { getFieldPowerSnapshot } from './fieldPowerProfile'
import { getRafLifecycleStats } from '../perception/motion/rafLifecycle'
import { getLifecycleRecoveryStats } from './lifecycleRecovery'
import type { TelemetrySnapshot } from '../lib/hudTelemetry'

export type SoakMemorySample = {
  ts: number
  heapMB: number | null
  uptimeMs: number
}

export type SoakResumeSample = {
  ts: number
  latencyMs: number
}

export type FieldSoakSnapshot = {
  sessionStartMs: number
  uptimeMs: number
  memorySamples: SoakMemorySample[]
  resumeSamples: SoakResumeSample[]
  peakHeapMB: number | null
  avgResumeLatencyMs: number | null
  telemetry: TelemetrySnapshot | null
  power: ReturnType<typeof getFieldPowerSnapshot>
  raf: ReturnType<typeof getRafLifecycleStats>
  lifecycle: ReturnType<typeof getLifecycleRecoveryStats>
}

const sessionStartMs = Date.now()
const memorySamples: SoakMemorySample[] = []
const resumeSamples: SoakResumeSample[] = []
const MAX_SAMPLES = 120

let sampleTimer: ReturnType<typeof setInterval> | null = null
let hiddenAt: number | null = null
let installed = false

function isSoakEnabled(): boolean {
  if (import.meta.env.VITE_HUD_TELEMETRY === 'true') return true
  if (typeof window === 'undefined') return false
  const w = window as Window & { __HUD_SOAK__?: boolean; location?: Location }
  if (w.__HUD_SOAK__) return true
  try {
    return w.location?.search.includes('e2e=1') ?? false
  } catch {
    return false
  }
}

function readHeapMB(): number | null {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } }
  if (!perf.memory) return null
  return Math.round(perf.memory.usedJSHeapSize / 1_000_000)
}

function recordMemorySample(): void {
  const heapMB = readHeapMB()
  memorySamples.push({
    ts: Date.now(),
    heapMB,
    uptimeMs: Date.now() - sessionStartMs,
  })
  if (memorySamples.length > MAX_SAMPLES) memorySamples.shift()
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now()
    return
  }
  if (hiddenAt != null) {
    const latencyMs = Date.now() - hiddenAt
    resumeSamples.push({ ts: Date.now(), latencyMs })
    if (resumeSamples.length > MAX_SAMPLES) resumeSamples.shift()
    hiddenAt = null
  }
}

export function collectFieldSoakSnapshot(): FieldSoakSnapshot {
  const heaps = memorySamples.map((s) => s.heapMB).filter((h): h is number => h != null)
  const peakHeapMB = heaps.length ? Math.max(...heaps) : readHeapMB()
  const latencies = resumeSamples.map((s) => s.latencyMs)
  const avgResumeLatencyMs =
    latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null

  const w = typeof window !== 'undefined' ? (window as Window & { __HUD_TELEMETRY__?: TelemetrySnapshot }) : null

  return {
    sessionStartMs,
    uptimeMs: Date.now() - sessionStartMs,
    memorySamples: [...memorySamples],
    resumeSamples: [...resumeSamples],
    peakHeapMB,
    avgResumeLatencyMs,
    telemetry: w?.__HUD_TELEMETRY__ ?? null,
    power: getFieldPowerSnapshot(),
    raf: getRafLifecycleStats(),
    lifecycle: getLifecycleRecoveryStats(),
  }
}

export function installFieldSoakDiagnostics(): void {
  if (installed || typeof window === 'undefined') return
  if (!isSoakEnabled()) return
  installed = true

  recordMemorySample()
  sampleTimer = setInterval(recordMemorySample, 30_000)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

export function publishFieldSoakDiagnostics(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __hudFieldSoak?: () => FieldSoakSnapshot }
  w.__hudFieldSoak = collectFieldSoakSnapshot
}

export function __resetFieldSoakDiagnosticsForTests(): void {
  memorySamples.length = 0
  resumeSamples.length = 0
  if (sampleTimer != null) {
    clearInterval(sampleTimer)
    sampleTimer = null
  }
  installed = false
  hiddenAt = null
}
