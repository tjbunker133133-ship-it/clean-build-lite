/**
 * Grounded entry — gentle camera settle + environmental fade-in.
 * No snaps, no pitch drama, no interaction lock. Camera stays trustworthy.
 */

import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useMapContext } from '../../context/MapContext'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { useGPS } from '../../hooks/useGPS'
import { useDeviceHeading } from '../../hooks/useDeviceHeading'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { recordAutomatedCameraWrite } from '../../lib/cameraAuthority'
import { resetFieldEntry, setFieldEntryPhase } from './modernFieldEntryGate'

const FALLBACK_CENTER = { lng: -105.7821, lat: 39.5501 }
const SETTLE_MS = 1600
const FIELD_FADE_MS = 500
const GPS_WAIT_MS = 2200

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function waitForMoveEnd(map: MapLibreMap, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (!map.isMoving() && !map.isEasing()) {
      resolve()
      return
    }
    const timer = window.setTimeout(() => {
      map.off('moveend', onEnd)
      resolve()
    }, timeoutMs)
    const onEnd = () => {
      window.clearTimeout(timer)
      resolve()
    }
    map.once('moveend', onEnd)
  })
}

function isE2eFastPath(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.location.search.includes('e2e=1') ||
    (navigator as Navigator & { webdriver?: boolean }).webdriver === true
  )
}

function resolveAnchor(
  map: MapLibreMap,
  gps: { lat: number | null; lng: number | null },
): [number, number] {
  if (gps.lat != null && gps.lng != null) return [gps.lng, gps.lat]
  try {
    const c = map.getCenter()
    if (Number.isFinite(c.lng) && Number.isFinite(c.lat)) return [c.lng, c.lat]
  } catch {
    // ignore
  }
  return [FALLBACK_CENTER.lng, FALLBACK_CENTER.lat]
}

/** Soft heading nudge — 25% toward device bearing, never a snap. */
function softBearing(map: MapLibreMap, hasHeading: boolean, heading: number | null): number {
  const current = map.getBearing()
  if (!hasHeading || heading == null) return current
  let delta = heading - current
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  if (Math.abs(delta) < 4) return current
  return current + delta * 0.25
}

async function runGentleSettle(
  map: MapLibreMap,
  lng: number,
  lat: number,
  hasHeading: boolean,
  heading: number | null,
  reducedMotion: boolean,
): Promise<void> {
  const anchor: [number, number] = [lng, lat]
  const targetZoom = Math.max(11, Math.min(14, map.getZoom()))
  const targetBearing = softBearing(map, hasHeading, heading)

  setFieldEntryPhase('settling')

  if (reducedMotion || isE2eFastPath()) {
    map.easeTo({
      center: anchor,
      zoom: targetZoom,
      pitch: 0,
      bearing: targetBearing,
      duration: reducedMotion ? 0 : 480,
      essential: false,
    })
    recordAutomatedCameraWrite('field-entry:settle-fast')
    await waitForMoveEnd(map, 600)
    await delay(FIELD_FADE_MS)
    setFieldEntryPhase('complete')
    return
  }

  map.easeTo({
    center: anchor,
    zoom: targetZoom,
    pitch: 0,
    bearing: targetBearing,
    duration: SETTLE_MS,
    essential: false,
  })
  recordAutomatedCameraWrite('field-entry:gentle-settle')
  await waitForMoveEnd(map, SETTLE_MS + 400)
  await delay(FIELD_FADE_MS)
  setFieldEntryPhase('complete')
}

export function ModernFieldEntrySequence() {
  const { mode } = useHudPresentation()
  const { map } = useMapContext()
  const gps = useGPS()
  const deviceHeading = useDeviceHeading()
  const reducedMotion = useReducedMotion()
  const startedRef = useRef(false)
  const gpsWaitTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (mode !== 'immersive') {
      resetFieldEntry()
      startedRef.current = false
      if (gpsWaitTimerRef.current != null) {
        window.clearTimeout(gpsWaitTimerRef.current)
        gpsWaitTimerRef.current = null
      }
      return
    }

    if (!map || startedRef.current) return

    const launch = (lng: number, lat: number) => {
      if (startedRef.current) return
      startedRef.current = true
      if (gpsWaitTimerRef.current != null) {
        window.clearTimeout(gpsWaitTimerRef.current)
        gpsWaitTimerRef.current = null
      }

      const hasHeading =
        deviceHeading.heading != null &&
        (deviceHeading.status === 'active' || deviceHeading.status === 'level')

      void runGentleSettle(
        map,
        lng,
        lat,
        hasHeading,
        deviceHeading.heading,
        reducedMotion,
      ).catch(() => setFieldEntryPhase('complete'))
    }

    if (gps.lat != null && gps.lng != null) {
      launch(gps.lng, gps.lat)
      return
    }

    gpsWaitTimerRef.current = window.setTimeout(() => {
      const [lng, lat] = resolveAnchor(map, gps)
      launch(lng, lat)
    }, GPS_WAIT_MS)

    return () => {
      if (gpsWaitTimerRef.current != null) {
        window.clearTimeout(gpsWaitTimerRef.current)
        gpsWaitTimerRef.current = null
      }
    }
  }, [
    mode,
    map,
    gps.lat,
    gps.lng,
    deviceHeading.heading,
    deviceHeading.status,
    reducedMotion,
  ])

  return null
}

export default ModernFieldEntrySequence
