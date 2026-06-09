/**
 * Phase 7 runtime diagnostics — Playwright / production validation surface.
 * Read-only snapshots; does not mutate OSG.
 */

import { getCameraPhysicsFeedback } from '../field/cameraPhysicsFeedback'
import { getRecursiveFieldSnapshot } from '../field/recursive/RecursiveFieldDynamics'
import { fieldEngineActive, recursiveDynamicsGain, resolveFieldLayerMode } from '../field/fieldLayerPolicy'
import { getSpatialFieldSnapshot } from '../field/SpatialFieldEngine'
import { getOperationalGraphSnapshot } from '../lib/operationalStateGraph'
import { getPerceptionSnapshot } from '../lib/operationalPerception/perceptionEngine'
import { getRafLifecycleStats } from '../perception/motion/rafLifecycle'

export type Phase7DiagnosticSnapshot = {
  timestamp: number
  runtime: {
    mode: string
    isImmersive: boolean
    isHybrid: boolean
    isLegacy: boolean
  } | null
  osg: {
    mode: string
    routeWaypointCount: number
    missionStatus: string
    radialActive: boolean
    measurePointCount: number
  }
  field: {
    active: boolean
    recursiveGain: number
    coherence: number | null
    cameraStability: number
    tick: number
  }
  perception: {
    stable: boolean
    frozen: boolean
    mode: string
    hasField: boolean
  }
  camera: {
    velocityMagnitude: number
  }
  raf: ReturnType<typeof getRafLifecycleStats>
  map: {
    ready: boolean
    zoom: number | null
    center: [number, number] | null
  }
}

export function collectPhase7Diagnostics(): Phase7DiagnosticSnapshot {
  const osg = getOperationalGraphSnapshot()
  const layer = resolveFieldLayerMode()
  const fieldActive = fieldEngineActive(layer)
  const recursive = fieldActive ? getRecursiveFieldSnapshot() : null
  const base = getSpatialFieldSnapshot()
  const perception = getPerceptionSnapshot()
  const camera = getCameraPhysicsFeedback()
  const runtime = typeof window !== 'undefined' ? window.__HUD_RUNTIME__ : null

  const map = (typeof window !== 'undefined'
    ? (window as Window & { __hudMap?: { isStyleLoaded?: () => boolean; getZoom?: () => number; getCenter?: () => { lng: number; lat: number } } }).__hudMap
    : null) ?? null

  let mapReady = false
  let zoom: number | null = null
  let center: [number, number] | null = null
  if (map?.isStyleLoaded?.()) {
    mapReady = true
    zoom = map.getZoom?.() ?? null
    const c = map.getCenter?.()
    if (c) center = [c.lng, c.lat]
  }

  return {
    timestamp: Date.now(),
    runtime: runtime
      ? {
          mode: runtime.mode,
          isImmersive: runtime.isImmersive,
          isHybrid: runtime.isHybrid,
          isLegacy: runtime.isLegacy,
        }
      : null,
    osg: {
      mode: osg.mode,
      routeWaypointCount: osg.session.routeWaypoints.length,
      missionStatus: osg.session.mission.status,
      radialActive: osg.interaction.radialActive,
      measurePointCount: osg.session.activeMeasurement?.points.length ?? 0,
    },
    field: {
      active: fieldActive,
      recursiveGain: recursiveDynamicsGain(layer),
      coherence: recursive?.coherence ?? null,
      cameraStability: recursive?.cameraStability ?? base.cameraStability,
      tick: recursive?.tick ?? base.tick,
    },
    perception: {
      stable: perception.stable,
      frozen: perception.frozen,
      mode: perception.mode,
      hasField: perception.field != null,
    },
    camera: {
      velocityMagnitude: camera.velocityMagnitude,
    },
    raf: getRafLifecycleStats(),
    map: { ready: mapReady, zoom, center },
  }
}

export function publishPhase7Diagnostics(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __hudPhase7Diagnostics?: () => Phase7DiagnosticSnapshot }
  w.__hudPhase7Diagnostics = collectPhase7Diagnostics
}
