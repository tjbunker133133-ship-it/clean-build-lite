/**
 * Boot validation — startup guards and subsystem readiness for production deploy.
 * Read-only checks; does not mutate OSG or spatial truth.
 */

import { fieldEngineActive, resolveFieldLayerMode } from '../field/fieldLayerPolicy'
import { getSpatialFieldSnapshot } from '../field/SpatialFieldEngine'
import { getOperationalGraphSnapshot } from '../lib/operationalStateGraph'
import { getPerceptionSnapshot } from '../lib/operationalPerception/perceptionEngine'

export type BootSubsystemStatus = 'pending' | 'ok' | 'degraded' | 'failed' | 'skipped'

export type BootHealthSnapshot = {
  timestamp: number
  bootOk: boolean
  bootGeneration: number
  reactMounted: boolean
  runtimeReady: boolean
  osgReady: boolean
  fieldReady: boolean
  perceptionReady: boolean
  overlaysReady: boolean | null
  errorCount: number
  recentErrors: string[]
  subsystems: Record<string, BootSubsystemStatus>
}

const MAX_ERRORS = 12
let bootGeneration = 0
const capturedErrors: string[] = []
let installed = false

function pushError(message: string): void {
  capturedErrors.push(message)
  if (capturedErrors.length > MAX_ERRORS) capturedErrors.shift()
}

export function recordBootGeneration(): void {
  bootGeneration++
}

export function installBootValidation(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  recordBootGeneration()

  window.addEventListener('error', (event) => {
    const msg = event.error?.message ?? event.message ?? 'unknown error'
    if (msg.includes('Maximum update depth')) {
      pushError(`FATAL:${msg}`)
      return
    }
    pushError(msg)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const msg = reason instanceof Error ? reason.message : String(reason ?? 'rejection')
    pushError(`rejection:${msg}`)
  })
}

function subsystemStatus(ok: boolean, degraded = false): BootSubsystemStatus {
  if (!ok) return 'failed'
  if (degraded) return 'degraded'
  return 'ok'
}

export function collectBootHealth(): BootHealthSnapshot {
  const runtime = typeof window !== 'undefined' ? window.__HUD_RUNTIME__ : null
  const rootLen = typeof document !== 'undefined' ? document.getElementById('root')?.innerHTML?.length ?? 0 : 0
  const reactMounted = rootLen > 50
  const runtimeReady = runtime != null && typeof runtime.mode === 'string'
  const mode = runtime?.mode ?? 'hybrid'
  const isImmersive = runtime?.isImmersive ?? false

  let osgReady = false
  try {
    const osg = getOperationalGraphSnapshot()
    osgReady = osg != null && typeof osg.mode === 'string'
  } catch {
    osgReady = false
  }

  let fieldReady = false
  let fieldDegraded = false
  try {
    const layer = resolveFieldLayerMode()
    const active = fieldEngineActive(layer)
    const snap = getSpatialFieldSnapshot()
    fieldReady = active ? snap.tick >= 0 : true
    fieldDegraded = active && snap.tick === 0
  } catch {
    fieldReady = false
  }

  let perceptionReady = false
  try {
    const p = getPerceptionSnapshot()
    perceptionReady = p != null && typeof p.mode === 'string'
  } catch {
    perceptionReady = false
  }

  let overlaysReady: boolean | null = null
  if (isImmersive && typeof document !== 'undefined') {
    overlaysReady = !!document.querySelector('[data-testid="modern-mode-overlays"]')
  }

  const fatal = capturedErrors.some((e) => e.startsWith('FATAL:'))
  const bootOk =
    !fatal &&
    runtimeReady &&
    reactMounted &&
    osgReady &&
    perceptionReady &&
    (overlaysReady !== false)

  const subsystems: Record<string, BootSubsystemStatus> = {
    runtime: subsystemStatus(runtimeReady),
    react: subsystemStatus(reactMounted),
    osg: subsystemStatus(osgReady),
    field: subsystemStatus(fieldReady, fieldDegraded),
    perception: subsystemStatus(perceptionReady),
    overlays:
      overlaysReady === null ? 'skipped' : subsystemStatus(overlaysReady),
    map: subsystemStatus(
      typeof window !== 'undefined' &&
        !!(window as Window & { __hudMap?: unknown }).__hudMap,
      true,
    ),
  }

  return {
    timestamp: Date.now(),
    bootOk,
    bootGeneration,
    reactMounted,
    runtimeReady,
    osgReady,
    fieldReady,
    perceptionReady,
    overlaysReady,
    errorCount: capturedErrors.length,
    recentErrors: [...capturedErrors],
    subsystems,
  }
}

export function publishBootHealth(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __hudBootHealth?: () => BootHealthSnapshot }
  w.__hudBootHealth = collectBootHealth
}

export function __resetBootValidationForTests(): void {
  capturedErrors.length = 0
  bootGeneration = 0
  installed = false
}
