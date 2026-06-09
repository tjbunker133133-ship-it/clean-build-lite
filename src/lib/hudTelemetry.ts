/**
 * HUD Performance Telemetry
 *
 * Lightweight runtime performance observer for the Modern Layer.
 * Tracks: FPS, frame pacing, jank detection, memory growth.
 *
 * Activation:
 *   - Development: window.__HUD_DEBUG__ = true
 *   - Production: disabled unless VITE_HUD_TELEMETRY=true at build time
 *
 * In production (no debug flag): all functions are no-ops.
 * Zero overhead in field runtime.
 *
 * API:
 *   window.__HUD_TELEMETRY__ — live snapshot (when enabled)
 *   startTelemetry() / stopTelemetry() — manual control
 */

export interface TelemetrySnapshot {
  fps: number
  avgFrameMs: number
  maxFrameMs: number        // worst frame in last 1s window
  jankCount: number         // frames > 50ms in last 1s window
  memoryMB: number | null   // performance.memory?.usedJSHeapSize / 1e6
  uptime: number            // ms since telemetry started
  sampleCount: number
}

const JANK_THRESHOLD_MS = 50
const WINDOW_MS = 1000

// ─── Internal state ───────────────────────────────────────────────────────────

let rafId: number | null = null
let prevTs = 0
let startTs = 0
let sampleCount = 0
let frameTimes: number[] = []
let snapshot: TelemetrySnapshot = {
  fps: 0,
  avgFrameMs: 0,
  maxFrameMs: 0,
  jankCount: 0,
  memoryMB: null,
  uptime: 0,
  sampleCount: 0,
}

function isEnabled(): boolean {
  if (import.meta.env.VITE_HUD_TELEMETRY === 'true') return true
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).__HUD_DEBUG__
}

function tick(ts: number) {
  if (prevTs > 0) {
    const frameMs = ts - prevTs
    frameTimes.push(frameMs)
    sampleCount++
  }
  prevTs = ts

  // Flush window every ~1s
  const windowCutoff = ts - WINDOW_MS
  // Approximate: keep only recent frames
  if (frameTimes.length > 120) {
    // More than 2s of frames at 60fps — trim
    frameTimes = frameTimes.slice(-60)
  }

  if (frameTimes.length >= 10) {
    const sum = frameTimes.reduce((a, b) => a + b, 0)
    const avg = sum / frameTimes.length
    const max = Math.max(...frameTimes)
    const janks = frameTimes.filter((f) => f > JANK_THRESHOLD_MS).length

    let memMB: number | null = null
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number } }
    if (perf.memory) {
      memMB = Math.round(perf.memory.usedJSHeapSize / 1_000_000)
    }

    snapshot = {
      fps: Math.round(1000 / avg),
      avgFrameMs: Math.round(avg * 10) / 10,
      maxFrameMs: Math.round(max),
      jankCount: janks,
      memoryMB: memMB,
      uptime: ts - startTs,
      sampleCount,
    }

    if (typeof window !== 'undefined') {
      ;(window as unknown as Record<string, unknown>).__HUD_TELEMETRY__ = snapshot
    }

    // Trim window
    frameTimes = frameTimes.slice(-30)
  }

  rafId = requestAnimationFrame(tick)
}

export function startTelemetry(): void {
  if (!isEnabled()) return
  if (rafId !== null) return // already running
  startTs = performance.now()
  prevTs = 0
  sampleCount = 0
  frameTimes = []
  console.info('[HUD Telemetry] Started — access via window.__HUD_TELEMETRY__')
  rafId = requestAnimationFrame(tick)
}

export function stopTelemetry(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

export function getTelemetrySnapshot(): TelemetrySnapshot | null {
  if (!isEnabled()) return null
  return snapshot
}

export function logTelemetrySnapshot(): void {
  if (!isEnabled()) return
  console.table(snapshot)
}

/** Auto-starts if enabled. Call once at app boot. */
export function initTelemetry(): void {
  if (!isEnabled()) return

  startTelemetry()

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopTelemetry()
    } else {
      startTelemetry()
    }
  })
}
