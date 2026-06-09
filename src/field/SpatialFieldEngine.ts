/**
 * Spatial Field Engine — continuous spatial intensity fields derived from OSG.
 *
 * RULES:
 * - OSG is the only source of truth; this module stores NO authoritative spatial state.
 * - Values evolve smoothly via exponential damping — never instant jumps.
 * - Classic layer bypass: influence = 0, engine idle.
 */

import { bearingDeg, haversineMeters } from '../hooks/useMovementEngine'
import {
  getOperationalGraphSnapshot,
  subscribeOperationalGraph,
} from '../lib/operationalStateGraph'
import type { OperationalStateGraph } from '../lib/operationalStateGraph/types'
import {
  dampingForLayer,
  fieldEngineActive,
  fieldLayerInfluence,
  resolveFieldLayerMode,
} from './fieldLayerPolicy'
import { isPageVisible, recordBackgroundSkip } from '../perception/motion/rafLifecycle'
import { stepRecursiveFieldDynamics } from './recursive/RecursiveFieldDynamics'
import type { SpatialFieldSnapshot, SpatialFieldTargets, SpatialFieldValues } from './types'

const listeners = new Set<() => void>()

const ZERO_FIELDS: SpatialFieldValues = {
  routeIntensity: 0,
  missionFocus: 0,
  navigationPull: 0,
  radialPressure: 0,
  environmentalAwareness: 0,
}

let current: SpatialFieldValues = { ...ZERO_FIELDS }
let snapshot: SpatialFieldSnapshot = {
  ...ZERO_FIELDS,
  cameraStability: 1,
  layerInfluence: 0,
  tick: 0,
  timestamp: 0,
}

let rafId: number | null = null
let lastTickMs = 0
let osgDirty = true
let lastGpsLat: number | null = null
let lastGpsLng: number | null = null
let lastGpsSampleMs = 0
let derivedSpeedMs = 0

function emit(): void {
  listeners.forEach((fn) => fn())
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function smoothToward(currentVal: number, target: number, damping: number, dtSec: number): number {
  if (damping <= 0 || dtSec <= 0) return target
  const alpha = 1 - Math.exp(-damping * dtSec)
  return currentVal + (target - currentVal) * alpha
}

/** Compute instantaneous targets from OSG — discrete truth → gradient endpoints. */
export function computeFieldTargets(osg: OperationalStateGraph): SpatialFieldTargets {
  const mode = osg.mode
  const wpCount = osg.session.routeWaypoints.length
  const missionStatus = osg.session.mission.status
  const hasMission = missionStatus === 'active' || missionStatus === 'paused'
  const overlays = osg.runtime.environment.activeOverlays.length
  const speedMs = derivedSpeedMs

  let routeIntensity = 0
  if (mode === 'route' || mode === 'measure') routeIntensity = 0.85
  else if (wpCount > 0) routeIntensity = clamp01(0.35 + wpCount * 0.08)

  let missionFocus = 0
  if (mode === 'mission') missionFocus = 0.9
  else if (hasMission) missionFocus = 0.55

  let navigationPull = 0
  if (mode === 'navigation') navigationPull = 0.95
  else if (speedMs > 0.4) navigationPull = clamp01(speedMs / 4)

  let radialPressure = 0
  if (mode === 'radial' || osg.interaction.radialActive) radialPressure = 1
  else if (osg.interaction.pointerOwner === 'radial') radialPressure = 0.4

  let environmentalAwareness = clamp01(overlays * 0.2)
  if (osg.runtime.environment.weatherAvailable) {
    environmentalAwareness = Math.max(environmentalAwareness, 0.35)
  }

  return {
    routeIntensity: clamp01(routeIntensity),
    missionFocus: clamp01(missionFocus),
    navigationPull: clamp01(navigationPull),
    radialPressure: clamp01(radialPressure),
    environmentalAwareness: clamp01(environmentalAwareness),
  }
}

function blendTargets(
  raw: SpatialFieldTargets,
  influence: number,
): SpatialFieldTargets {
  if (influence <= 0) return { ...ZERO_FIELDS }
  return {
    routeIntensity: raw.routeIntensity * influence,
    missionFocus: raw.missionFocus * influence,
    navigationPull: raw.navigationPull * influence,
    radialPressure: raw.radialPressure * influence,
    environmentalAwareness: raw.environmentalAwareness * influence,
  }
}

function fieldVelocityMagnitude(prev: SpatialFieldValues, next: SpatialFieldValues): number {
  return (
    Math.abs(next.routeIntensity - prev.routeIntensity) +
    Math.abs(next.missionFocus - prev.missionFocus) +
    Math.abs(next.navigationPull - prev.navigationPull) +
    Math.abs(next.radialPressure - prev.radialPressure) +
    Math.abs(next.environmentalAwareness - prev.environmentalAwareness)
  )
}

function tickFields(nowMs: number): void {
  const layer = resolveFieldLayerMode()
  const influence = fieldLayerInfluence(layer)

  if (!fieldEngineActive(layer)) {
    if (current.routeIntensity !== 0) {
      current = { ...ZERO_FIELDS }
      snapshot = {
        ...ZERO_FIELDS,
        cameraStability: 1,
        layerInfluence: 0,
        tick: snapshot.tick + 1,
        timestamp: nowMs,
      }
      stepRecursiveFieldDynamics(snapshot, 0)
      emit()
    }
    return
  }

  const dtSec = lastTickMs > 0 ? Math.min((nowMs - lastTickMs) / 1000, 0.1) : 1 / 60
  lastTickMs = nowMs

  const osg = getOperationalGraphSnapshot()
  const gps = osg.runtime.gps
  if (gps.lat != null && gps.lng != null) {
    const now = gps.updatedAt ?? nowMs
    if (lastGpsLat != null && lastGpsLng != null && lastGpsSampleMs > 0) {
      const dt = (now - lastGpsSampleMs) / 1000
      if (dt >= 0.1 && dt <= 10) {
        const dist = haversineMeters(lastGpsLat, lastGpsLng, gps.lat, gps.lng)
        derivedSpeedMs = dist / dt
        if (dist >= 3) bearingDeg(lastGpsLat, lastGpsLng, gps.lat, gps.lng)
      }
    }
    lastGpsLat = gps.lat
    lastGpsLng = gps.lng
    lastGpsSampleMs = now
  }
  const rawTargets = computeFieldTargets(osg)
  const targets = blendTargets(rawTargets, influence)
  const damping = dampingForLayer(layer)

  const prev = { ...current }
  current = {
    routeIntensity: smoothToward(current.routeIntensity, targets.routeIntensity, damping.routeIntensity, dtSec),
    missionFocus: smoothToward(current.missionFocus, targets.missionFocus, damping.missionFocus, dtSec),
    navigationPull: smoothToward(current.navigationPull, targets.navigationPull, damping.navigationPull, dtSec),
    radialPressure: smoothToward(current.radialPressure, targets.radialPressure, damping.radialPressure, dtSec),
    environmentalAwareness: smoothToward(
      current.environmentalAwareness,
      targets.environmentalAwareness,
      damping.environmentalAwareness,
      dtSec,
    ),
  }

  const velocity = fieldVelocityMagnitude(prev, current)
  const cameraStability = clamp01(1 - velocity * 4)

  snapshot = {
    ...current,
    cameraStability,
    layerInfluence: influence,
    tick: snapshot.tick + 1,
    timestamp: nowMs,
  }

  stepRecursiveFieldDynamics(snapshot, dtSec)

  if (osgDirty || velocity > 0.0001) {
    osgDirty = false
    emit()
  }
}

function rafLoop(nowMs: number): void {
  if (!isPageVisible()) {
    recordBackgroundSkip()
    if (fieldEngineActive(resolveFieldLayerMode())) {
      rafId = requestAnimationFrame(rafLoop)
    }
    return
  }
  tickFields(nowMs)
  if (fieldEngineActive(resolveFieldLayerMode())) {
    rafId = requestAnimationFrame(rafLoop)
  } else {
    rafId = null
  }
}

function ensureLoop(): void {
  if (rafId != null) return
  if (!fieldEngineActive(resolveFieldLayerMode())) return
  lastTickMs = 0
  rafId = requestAnimationFrame(rafLoop)
}

function stopLoop(): void {
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function onOsgChange(): void {
  osgDirty = true
  const layer = resolveFieldLayerMode()
  if (fieldEngineActive(layer)) {
    ensureLoop()
    tickFields(performance.now())
  } else {
    stopLoop()
    tickFields(performance.now())
  }
}

subscribeOperationalGraph(onOsgChange)

/** Start the field tick loop (called from FieldEngineLoop mount). */
export function startSpatialFieldEngine(): void {
  onOsgChange()
}

/** Stop the field tick loop. */
export function stopSpatialFieldEngine(): void {
  stopLoop()
}

export function getSpatialFieldSnapshot(): SpatialFieldSnapshot {
  return snapshot
}

export function subscribeSpatialField(listener: () => void): () => void {
  listeners.add(listener)
  ensureLoop()
  return () => listeners.delete(listener)
}

