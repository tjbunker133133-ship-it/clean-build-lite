/**

 * ModernCameraController — OSG + Field + Perception driven camera authority.

 *

 * Layer gating:

 * - Classic (legacy): intent queue only — no field, no physics

 * - Balanced (hybrid): perception transitions with damped easing

 * - Modern (immersive): full inertial physics solver on rAF

 *

 * Sole map.easeTo / map.zoomTo / map.jumpTo authority in the HUD.

 */



import { useEffect, useRef } from 'react'

import type { Map as MapLibreMap } from 'maplibre-gl'

import { useMapContext } from '../context/MapContext'

import { useHudPresentation } from '../context/HudPresentationContext'

import { useOperationalPerception } from '../hooks/useOperationalPerception'

import { useReducedMotion } from '../hooks/useReducedMotion'

import {

  cameraPhysicsActive,

  resolveFieldLayerMode,

} from '../field/fieldLayerPolicy'

import {

  initCameraPhysicsFromMap,

  MODERN_CAMERA_PHYSICS_CONFIG,

  stepCameraPhysics,

  type CameraPhysicsState,

} from '../field/cameraPhysicsSolver'

import { publishCameraPhysicsFeedback } from '../field/cameraPhysicsFeedback'

import { refineCameraPhysicsConfig } from '../perception/motion/motionLanguage'

import { isPageVisible, recordBackgroundSkip } from '../perception/motion/rafLifecycle'

import {
  flushCameraAuthority,
  getCameraAuthorityDebug,
  recordAutomatedCameraWrite,
  shouldAllowAutomatedCamera,
  shouldFollowGpsTo,
  stabilizedNavigationZoomOffset,
} from '../lib/cameraAuthority'
import {

  clearCameraSnapshotAfterRestore,

  commitCameraSnapshot,

  consumeCameraIntent,

  flushPendingCameraIntents,

  perceptionNeedsRadialCapture,

  perceptionNeedsTransitionBaseline,

} from '../lib/operationalPerception/perceptionEngine'

import type { CameraSnapshot } from '../lib/operationalPerception/types'

import type { OperationalMode } from '../lib/operationalStateGraph/types'
import { isFieldEntryActive, isFieldEntryLocked } from '../hud/modernMode/modernFieldEntryGate'



function readCameraFromMap(map: MapLibreMap, mode: OperationalMode): CameraSnapshot {

  const c = map.getCenter()

  return {

    center: [c.lng, c.lat],

    zoom: map.getZoom(),

    bearing: map.getBearing(),

    pitch: map.getPitch(),

    timestamp: Date.now(),

    mode,

  }

}



function applyCameraSnapshot(

  map: MapLibreMap,

  snap: CameraSnapshot,

  duration: number,

): void {

  if (map.isMoving() || map.isEasing()) {

    map.stop()

  }

  map.easeTo({

    center: snap.center,

    zoom: snap.zoom,

    bearing: snap.bearing,

    pitch: snap.pitch,

    duration,

    essential: duration > 0,

  })

}



function applyPhysicsState(map: MapLibreMap, state: CameraPhysicsState): void {

  map.jumpTo({

    center: [state.centerLng, state.centerLat],

    zoom: state.zoom,

    bearing: state.bearing,

    pitch: state.pitch,

  })

}



export function ModernCameraController() {

  const { map } = useMapContext()

  const { mode: hudMode } = useHudPresentation()

  const perception = useOperationalPerception()

  const reducedMotion = useReducedMotion()



  const isClassic = hudMode === 'legacy'

  const isBalanced = hudMode === 'hybrid'

  const isModern = hudMode === 'immersive'

  const cameraAuthority = isClassic || isBalanced || isModern



  const lastAppliedKeyRef = useRef<string | null>(null)

  const lastModeRef = useRef<OperationalMode | null>(null)

  const physicsRef = useRef<CameraPhysicsState | null>(null)

  const physicsRafRef = useRef<number | null>(null)

  const physicsPausedRef = useRef(false)

  const lastBearingRef = useRef<number | null>(null)
  const lastTargetZoomRef = useRef<number | null>(null)
  const prevHudModeRef = useRef(hudMode)

  // Mode transition / authority reset (skip initial mount)
  useEffect(() => {
    if (!map) return
    if (prevHudModeRef.current === hudMode) return
    prevHudModeRef.current = hudMode
    flushCameraAuthority()
    flushPendingCameraIntents()
    try {
      if (map.isMoving() || map.isEasing()) map.stop()
    } catch {
      /* ignore */
    }
    physicsRef.current = null
    physicsPausedRef.current = false
    lastAppliedKeyRef.current = null
    lastTargetZoomRef.current = null
  }, [map, hudMode])

  // Temporary debug surface (dev + e2e only)
  useEffect(() => {
    if (!import.meta.env.DEV && !(typeof window !== 'undefined' && window.location.search.includes('e2e=1'))) {
      return
    }
    const id = window.setInterval(() => {
      const dbg = getCameraAuthorityDebug()
      if (dbg.userOverrideActive || dbg.intentQueueDepth > 0) {
        console.debug('[CAMERA-AUTHORITY] tick', dbg)
      }
    }, 5000)
    return () => window.clearInterval(id)
  }, [])

  // ── Event-driven path: intents, radial, transitions, balanced easing ──

  useEffect(() => {

    if (!map || !cameraAuthority) return



    if (isFieldEntryLocked()) {
      lastModeRef.current = perception.mode
      return
    }

    const intent = consumeCameraIntent()

    if (intent) {

      const key = `intent:${intent.issuedAt}:${intent.kind}`

      if (lastAppliedKeyRef.current !== key) {

        if (intent.kind === 'ease_to') {

          const c = map.getCenter()

          map.easeTo({

            center: intent.center ?? [c.lng, c.lat],

            zoom: intent.zoom ?? map.getZoom(),

            bearing: intent.bearing ?? map.getBearing(),

            duration: intent.durationMs,

            essential: true,

          })

          recordAutomatedCameraWrite('intent:ease_to')

        } else if (intent.kind === 'zoom_by') {

          map.zoomTo(map.getZoom() + intent.delta, { duration: intent.durationMs })

          recordAutomatedCameraWrite('intent:zoom_by')

        }

        lastAppliedKeyRef.current = key

        if (isModern) {

          const c = map.getCenter()

          physicsRef.current = initCameraPhysicsFromMap(

            c.lng,

            c.lat,

            map.getZoom(),

            map.getBearing(),

            map.getPitch(),

          )

        }

      }

      return

    }



    // Classic: perception-driven camera is disabled — intents only.

    if (isClassic) return



    const osgMode = perception.mode

    const prevMode = lastModeRef.current



    if (perceptionNeedsRadialCapture()) {

      commitCameraSnapshot(readCameraFromMap(map, osgMode))

      physicsPausedRef.current = true

      lastModeRef.current = osgMode

      return

    }



    if (perception.radialRestorePending && perception.cameraSnapshot) {

      const key = `radial-restore:${perception.cameraSnapshot.timestamp}`

      if (lastAppliedKeyRef.current !== key) {

        applyCameraSnapshot(map, perception.cameraSnapshot, 0)

        clearCameraSnapshotAfterRestore()

        lastAppliedKeyRef.current = key

        if (isModern) {

          physicsRef.current = initCameraPhysicsFromMap(

            perception.cameraSnapshot.center[0],

            perception.cameraSnapshot.center[1],

            perception.cameraSnapshot.zoom,

            perception.cameraSnapshot.bearing,

            perception.cameraSnapshot.pitch,

          )

        }

      }

      physicsPausedRef.current = false

      lastModeRef.current = osgMode

      return

    }



    if (osgMode === 'radial' || perception.camera.freezeCamera) {

      physicsPausedRef.current = true

      lastModeRef.current = osgMode

      return

    }



    physicsPausedRef.current = false



    const packet = perception.activeTransition

    const profile = perception.camera

    const spatial = perception.spatial

    const field = perception.field



    let transitionBaseline = perception.cameraSnapshot

    if (packet && perceptionNeedsTransitionBaseline()) {

      transitionBaseline = readCameraFromMap(map, packet.fromMode)

      commitCameraSnapshot(transitionBaseline)

    }



    if (packet && transitionBaseline) {

      const key = `transition:${packet.issuedAt}:${packet.toMode}`

      if (lastAppliedKeyRef.current !== key) {

        const baseline = transitionBaseline

        const fieldDamp = field?.layerInfluence ?? (isBalanced ? 0.55 : 1)

        const duration = reducedMotion ? 0 : Math.round(packet.durationMs * (0.7 + fieldDamp * 0.3))

        const zoomOffset =

          packet.toMode === 'navigation' && spatial

            ? stabilizedNavigationZoomOffset(spatial.speedMs)

            : 0

        const targetZoom = (profile.zoom ?? baseline.zoom) + zoomOffset

        const targetCenter: [number, number] =

          profile.followGps && spatial

            ? [spatial.lng, spatial.lat]

            : baseline.center



        applyCameraSnapshot(

          map,

          {

            ...baseline,

            center: targetCenter,

            zoom: targetZoom,

            bearing: profile.bearing ?? baseline.bearing,

            pitch: profile.pitch,

            mode: packet.toMode,

            timestamp: Date.now(),

          },

          duration,

        )

        lastAppliedKeyRef.current = key

        if (isModern) {

          physicsRef.current = initCameraPhysicsFromMap(

            targetCenter[0],

            targetCenter[1],

            targetZoom,

            profile.bearing ?? baseline.bearing,

            profile.pitch,

          )

        }

      }

      lastModeRef.current = osgMode

      return

    }



    // Balanced: damped easeTo for GPS follow. Modern: defer to physics rAF loop.

    if (!isModern && profile.followGps && spatial && !packet && shouldAllowAutomatedCamera()) {

      if (!shouldFollowGpsTo(spatial.lng, spatial.lat)) {

        lastModeRef.current = osgMode

        return

      }

      const key = `follow:${Math.round(spatial.lat * 1e4)}:${Math.round(spatial.lng * 1e4)}:${profile.pitch}`

      if (lastAppliedKeyRef.current !== key) {

        const duration = reducedMotion ? 0 : 480

        map.easeTo({

          center: [spatial.lng, spatial.lat],

          pitch: profile.pitch,

          bearing: profile.bearing ?? map.getBearing(),

          zoom: (profile.zoom ?? map.getZoom()) + stabilizedNavigationZoomOffset(spatial.speedMs),

          duration,

          essential: true,

        })

        recordAutomatedCameraWrite('balanced:gps_follow')

        lastAppliedKeyRef.current = key

      }

      lastModeRef.current = osgMode

      return

    }



    if (prevMode !== null && prevMode !== osgMode && !packet) {

      const key = `pitch:${osgMode}:${profile.pitch}`

      if (lastAppliedKeyRef.current !== key && Math.abs(map.getPitch() - profile.pitch) > 0.5) {

        map.easeTo({

          pitch: profile.pitch,

          duration: reducedMotion ? 0 : 320,

          essential: false,

        })

        lastAppliedKeyRef.current = key

      }

    }



    lastModeRef.current = osgMode

  }, [

    map,

    cameraAuthority,

    isClassic,

    isBalanced,

    isModern,

    reducedMotion,

    perception.mode,

    perception.radialRestorePending,

    perception.cameraSnapshot,

    perception.camera.freezeCamera,

    perception.camera.followGps,

    perception.camera.pitch,

    perception.camera.bearing,

    perception.camera.zoom,

    perception.activeTransition,

    perception.spatial,

    perception.pendingCameraIntent,

    perception.field?.tick,

  ])



  // ── Modern-only: inertial physics solver (non-event-driven) ──

  useEffect(() => {

    if (!map || !isModern || reducedMotion) return

    if (!cameraPhysicsActive(resolveFieldLayerMode())) return



    let lastFrameMs = performance.now()



    const step = (nowMs: number) => {

      if (!isPageVisible()) {

        recordBackgroundSkip()

        lastFrameMs = nowMs

        physicsRafRef.current = requestAnimationFrame(step)

        return

      }

      if (physicsPausedRef.current || !shouldAllowAutomatedCamera() || isFieldEntryActive()) {

        lastFrameMs = nowMs

        physicsRafRef.current = requestAnimationFrame(step)

        return

      }



      const profile = perception.camera

      const spatial = perception.spatial

      const field = perception.field



      if (!profile.followGps || !spatial || perception.mode === 'radial') {

        lastFrameMs = nowMs

        physicsRafRef.current = requestAnimationFrame(step)

        return

      }

      if (!shouldFollowGpsTo(spatial.lng, spatial.lat)) {

        lastFrameMs = nowMs

        physicsRafRef.current = requestAnimationFrame(step)

        return

      }



      const dtSec = Math.min((nowMs - lastFrameMs) / 1000, 0.05)

      lastFrameMs = nowMs



      if (!physicsRef.current) {

        const c = map.getCenter()

        physicsRef.current = initCameraPhysicsFromMap(

          c.lng,

          c.lat,

          map.getZoom(),

          map.getBearing(),

          map.getPitch(),

        )

      }



      const predicted = field?.predicted

      const navPull = predicted?.navigationPull ?? field?.navigationPull ?? 0.5

      const missionFocus = predicted?.missionFocus ?? field?.missionFocus ?? 0

      const coherence = field?.coherence ?? 1

      const attractionWeight = Math.min(
        1,
        (navPull * 0.7 + missionFocus * 0.3) * (0.82 + coherence * 0.18),
      )



      let targetZoom =

        (profile.zoom ?? map.getZoom()) + stabilizedNavigationZoomOffset(spatial.speedMs)

      const prevTargetZoom = lastTargetZoomRef.current

      if (prevTargetZoom != null && Math.abs(targetZoom - prevTargetZoom) < 0.12) {

        targetZoom = prevTargetZoom

      } else {

        lastTargetZoomRef.current = targetZoom

      }

      const targetBearing = profile.bearing ?? map.getBearing()

      const prevBearing = lastBearingRef.current ?? targetBearing

      let bearingDelta = targetBearing - prevBearing

      while (bearingDelta > 180) bearingDelta -= 360

      while (bearingDelta < -180) bearingDelta += 360

      lastBearingRef.current = targetBearing

      const physicsConfig = refineCameraPhysicsConfig(MODERN_CAMERA_PHYSICS_CONFIG, {

        coherence,

        speedMs: spatial.speedMs,

        bearingDelta,

        reducedMotion,

      })



      physicsRef.current = stepCameraPhysics(

        physicsRef.current,

        {

          centerLng: spatial.lng,

          centerLat: spatial.lat,

          zoom: targetZoom,

          bearing: targetBearing,

          pitch: profile.pitch,

          attractionWeight,

        },

        physicsConfig,

        dtSec,

      )



      publishCameraPhysicsFeedback(physicsRef.current)

      applyPhysicsState(map, physicsRef.current)

      recordAutomatedCameraWrite('modern:physics_rAF')

      physicsRafRef.current = requestAnimationFrame(step)

    }



    physicsRafRef.current = requestAnimationFrame(step)

    return () => {

      if (physicsRafRef.current != null) {

        cancelAnimationFrame(physicsRafRef.current)

        physicsRafRef.current = null

      }

    }

  }, [

    map,

    isModern,

    reducedMotion,

    perception.camera.followGps,

    perception.camera.pitch,

    perception.camera.bearing,

    perception.camera.zoom,

    perception.spatial,

    perception.mode,

    perception.field?.navigationPull,

    perception.field?.missionFocus,

    perception.field?.coherence,

    perception.field?.predicted?.navigationPull,

  ])



  return null

}



export default ModernCameraController


