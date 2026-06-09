/**
 * Operational Perception Layer v1.0
 *
 * Read-only translator: OSG truth → UX perception signals.
 * NEVER mutates operationalStateGraph.
 */

import {
  getOperationalGraphSnapshot,
  subscribeOperationalGraph,
} from '../operationalStateGraph'
import type { OperationalMode, OperationalStateGraph } from '../operationalStateGraph/types'
import {
  cameraProfileForMode,
  navigationPitchForSpeed,
} from './cameraProfiles'
import { environmentalToneForMode, blendWeatherTone } from './environmentalTone'
import { bearingDeg, haversineMeters } from '../../hooks/useMovementEngine'
import { smoothPosition } from './spatialStability'
import {
  buildTransitionPacket,
  microDelayForMode,
  sheetDelayForTransition,
} from './transitionAnimations'
import { fieldEngineActive, resolveFieldLayerMode } from '../../field/fieldLayerPolicy'
import {
  getRecursiveFieldSnapshot,
  setPerceptionFieldFeedback,
} from '../../field/recursive/RecursiveFieldDynamics'
import { subscribeSpatialField } from '../../field/SpatialFieldEngine'
import { recordIntentConsumed, shouldAcceptCameraIntent } from '../cameraAuthority'
import type { CameraIntent, CameraSnapshot, PerceptionSnapshot, TransitionPacket } from './types'

const listeners = new Set<() => void>()

let lastOsgMode: OperationalMode = 'idle'
let activeTransition: TransitionPacket | null = null
let spatial: PerceptionSnapshot['spatial'] = null
let frozen = false
let lastStableMode: OperationalMode = 'idle'
let lastGpsSampleMs = 0
let cameraSnapshot: CameraSnapshot | null = null
let radialRestorePending = false
let transitionBaselinePending = false
let pendingCameraIntent: (CameraIntent & { issuedAt: number }) | null = null

function trace(event: string, detail?: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    console.debug(`[OSG-PERCEPTION] ${event}`, detail)
  }
}

function buildSnapshot(osg: OperationalStateGraph): PerceptionSnapshot {
  const mode = osg.mode
  const profile = cameraProfileForMode(mode)
  const speedMs = spatial?.speedMs ?? 0

  const camera =
    mode === 'navigation'
      ? { ...profile, pitch: navigationPitchForSpeed(speedMs) }
      : profile

  const weatherIntensity =
    osg.runtime.environment.activeOverlays.length > 0 ? 0.35 : 0
  const tone = blendWeatherTone(environmentalToneForMode(mode), weatherIntensity)

  const now = Date.now()
  const transitionActive =
    activeTransition != null && now - activeTransition.issuedAt < activeTransition.durationMs

  const result: PerceptionSnapshot = {
    mode,
    pointerOwner: osg.interaction.pointerOwner,
    stable: !frozen && !transitionActive,
    frozen,
    activeTransition: transitionActive ? activeTransition : null,
    camera,
    cameraSnapshot,
    radialRestorePending,
    pendingCameraIntent,
    tone,
    spatial,
    sheetDelayMs: sheetDelayForTransition(activeTransition),
    microDelayMs: microDelayForMode(mode),
    lastStableMode,
    lastPacket: activeTransition,
    field: fieldEngineActive(resolveFieldLayerMode()) ? getRecursiveFieldSnapshot() : null,
  }
  setPerceptionFieldFeedback({ stable: result.stable, frozen: result.frozen })
  return result
}

let snapshot: PerceptionSnapshot = buildSnapshot(getOperationalGraphSnapshot())
/** Stable reference for useSyncExternalStore — rebuilt only when perception-relevant fields change. */
let clientSnapshot: PerceptionSnapshot = snapshot

function refreshClientSnapshot(): void {
  clientSnapshot = {
    ...snapshot,
    camera: { ...snapshot.camera },
    cameraSnapshot: snapshot.cameraSnapshot ? { ...snapshot.cameraSnapshot, center: [...snapshot.cameraSnapshot.center] as [number, number] } : null,
    tone: { ...snapshot.tone },
    spatial: snapshot.spatial ? { ...snapshot.spatial } : null,
    activeTransition: snapshot.activeTransition ? { ...snapshot.activeTransition } : null,
    lastPacket: snapshot.lastPacket ? { ...snapshot.lastPacket } : null,
    field: snapshot.field
      ? {
          ...snapshot.field,
          velocity: { ...snapshot.field.velocity },
          acceleration: { ...snapshot.field.acceleration },
          predicted: { ...snapshot.field.predicted },
        }
      : null,
  }
}

function perceptionNotifyNeeded(prev: PerceptionSnapshot, next: PerceptionSnapshot): boolean {
  return (
    prev.mode !== next.mode ||
    prev.frozen !== next.frozen ||
    prev.stable !== next.stable ||
    prev.pointerOwner !== next.pointerOwner ||
    prev.activeTransition?.issuedAt !== next.activeTransition?.issuedAt ||
    prev.lastPacket?.issuedAt !== next.lastPacket?.issuedAt ||
    prev.lastPacket?.toMode !== next.lastPacket?.toMode ||
    prev.camera.pitch !== next.camera.pitch ||
    prev.camera.freezeCamera !== next.camera.freezeCamera ||
    prev.camera.followGps !== next.camera.followGps ||
    prev.cameraSnapshot?.timestamp !== next.cameraSnapshot?.timestamp ||
    prev.radialRestorePending !== next.radialRestorePending ||
    prev.pendingCameraIntent?.issuedAt !== next.pendingCameraIntent?.issuedAt ||
    prev.tone.intensity !== next.tone.intensity ||
    prev.tone.desaturation !== next.tone.desaturation ||
    prev.tone.contrastBoost !== next.tone.contrastBoost ||
    prev.tone.pathGlowAccent !== next.tone.pathGlowAccent ||
    prev.tone.dimBackground !== next.tone.dimBackground ||
    prev.tone.motionTint !== next.tone.motionTint ||
    prev.sheetDelayMs !== next.sheetDelayMs ||
    prev.microDelayMs !== next.microDelayMs ||
    prev.field?.tick !== next.field?.tick ||
    prev.field?.cameraStability !== next.field?.cameraStability ||
    prev.field?.coherence !== next.field?.coherence ||
    prev.field?.inertiaBias !== next.field?.inertiaBias
  )
}

function emit(): void {
  refreshClientSnapshot()
  listeners.forEach((l) => l())
  publishDebugSurface()
}

function ingestOsg(osg: OperationalStateGraph): void {
  const mode = osg.mode

  // Allow radial transaction unwind even when frozen alignment lags stable mode.
  if (
    frozen &&
    mode !== lastStableMode &&
    mode !== lastOsgMode &&
    lastOsgMode !== 'radial'
  ) {
    trace('mismatch_freeze', { expected: lastStableMode, saw: mode })
    return
  }

  if (mode !== lastOsgMode) {
    if (mode === 'radial') {
      // Radial open: camera controller captures snapshot before freeze.
      radialRestorePending = false
      frozen = true
      trace('radial_open_pending_capture', { from: lastOsgMode })
    } else if (lastOsgMode === 'radial') {
      // Radial close: restore exact snapshot — no easing.
      radialRestorePending = true
      frozen = false
      trace('radial_close_restore', { to: mode })
    } else if (osg.control.lastTransitionFrom != null) {
      const fromMode = osg.control.lastTransitionFrom
      const packet = buildTransitionPacket({
        fromMode,
        toMode: mode,
        logicalPath: osg.control.lastTransitionPath.length
          ? osg.control.lastTransitionPath
          : [fromMode, mode],
        triggerSource: osg.control.transitionSource,
        issuedAt: osg.control.lastTransition,
      })
      activeTransition = packet
      lastStableMode = fromMode
      frozen = false
      transitionBaselinePending = true
      trace('transition_packet', {
        from: packet.perceptualPath[0],
        to: packet.perceptualPath[1],
        logical: packet.logicalPath.join('→'),
        duration: packet.durationMs,
      })
    } else {
      frozen = true
      trace('alignment_freeze', { from: lastOsgMode, to: mode })
    }
  } else if (!activeTransition || Date.now() - activeTransition.issuedAt >= activeTransition.durationMs) {
    frozen = false
    lastStableMode = mode
    transitionBaselinePending = false
  }

  const gps = osg.runtime.gps
  if (gps.lat != null && gps.lng != null) {
    const now = Date.now()
    let speedMs = spatial?.speedMs ?? 0
    let headingDeg = spatial?.headingDeg ?? 0

    if (spatial && lastGpsSampleMs > 0) {
      const dt = (now - lastGpsSampleMs) / 1000
      if (dt >= 0.1 && dt <= 10) {
        const dist = haversineMeters(spatial.lat, spatial.lng, gps.lat, gps.lng)
        speedMs = dist / dt
        if (dist >= 3) {
          headingDeg = bearingDeg(spatial.lat, spatial.lng, gps.lat, gps.lng)
        }
      }
    }

    spatial = smoothPosition(spatial, {
      lat: gps.lat,
      lng: gps.lng,
      headingDeg,
      speedMs,
    })
    lastGpsSampleMs = now
  }

  lastOsgMode = mode
  snapshot = buildSnapshot(osg)
}

function onOsgUpdate(): void {
  const prev = snapshot
  ingestOsg(getOperationalGraphSnapshot())
  if (perceptionNotifyNeeded(prev, snapshot)) {
    emit()
  }
}

let subscribed = false
function onFieldTick(): void {
  if (!fieldEngineActive(resolveFieldLayerMode())) return
  const prev = snapshot
  snapshot = buildSnapshot(getOperationalGraphSnapshot())
  if (perceptionNotifyNeeded(prev, snapshot)) {
    emit()
  }
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  ingestOsg(getOperationalGraphSnapshot())
  subscribeOperationalGraph(onOsgUpdate)
  subscribeSpatialField(onFieldTick)
}

export function getPerceptionSnapshot(): PerceptionSnapshot {
  ensureSubscribed()
  return clientSnapshot
}

export function subscribePerception(listener: () => void): () => void {
  ensureSubscribed()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function perceptionShouldFreezeCamera(): boolean {
  ensureSubscribed()
  return snapshot.camera.freezeCamera || snapshot.frozen || snapshot.mode === 'radial'
}

/** Commit map camera state into perception (called by camera controller). */
export function commitCameraSnapshot(snap: CameraSnapshot): void {
  ensureSubscribed()
  cameraSnapshot = { ...snap, center: [...snap.center] as [number, number] }
  transitionBaselinePending = false
  snapshot = buildSnapshot(getOperationalGraphSnapshot())
  emit()
}

/** Clear snapshot after radial restore or transition baseline consumption. */
export function clearCameraSnapshotAfterRestore(): void {
  cameraSnapshot = null
  radialRestorePending = false
  transitionBaselinePending = false
  snapshot = buildSnapshot(getOperationalGraphSnapshot())
  emit()
}

export function perceptionNeedsTransitionBaseline(): boolean {
  ensureSubscribed()
  return transitionBaselinePending && snapshot.activeTransition != null
}

export function perceptionNeedsRadialCapture(): boolean {
  ensureSubscribed()
  return snapshot.mode === 'radial' && cameraSnapshot == null
}

/** Queue a one-shot camera intent — only ModernCameraController may apply it. */
export function requestCameraIntent(intent: CameraIntent): void {
  ensureSubscribed()
  if (!shouldAcceptCameraIntent(intent)) return
  pendingCameraIntent = { ...intent, issuedAt: Date.now() }
  snapshot = buildSnapshot(getOperationalGraphSnapshot())
  emit()
}

/** Flush pending intents — call on mode transition / overlay safety reset. */
export function flushPendingCameraIntents(): void {
  ensureSubscribed()
  pendingCameraIntent = null
  snapshot = buildSnapshot(getOperationalGraphSnapshot())
  emit()
}

export function consumeCameraIntent(): (CameraIntent & { issuedAt: number }) | null {
  const intent = pendingCameraIntent
  if (intent) {
    pendingCameraIntent = null
    snapshot = buildSnapshot(getOperationalGraphSnapshot())
    recordIntentConsumed()
  }
  return intent
}

export function publishDebugSurface(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __OPERATIONAL_PERCEPTION__?: () => PerceptionSnapshot }
  w.__OPERATIONAL_PERCEPTION__ = () => getPerceptionSnapshot()
}

export function __resetOperationalPerceptionForTests(): void {
  lastOsgMode = 'idle'
  activeTransition = null
  spatial = null
  frozen = false
  lastStableMode = 'idle'
  lastGpsSampleMs = 0
  cameraSnapshot = null
  radialRestorePending = false
  transitionBaselinePending = false
  pendingCameraIntent = null
  snapshot = buildSnapshot(getOperationalGraphSnapshot())
  refreshClientSnapshot()
}

// Boot
ensureSubscribed()
refreshClientSnapshot()
publishDebugSurface()
