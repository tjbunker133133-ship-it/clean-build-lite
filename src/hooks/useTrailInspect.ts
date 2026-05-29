import { useCallback, useEffect, useRef, useState } from 'react'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { isWaypointPlacementAllowed } from '../lib/waypointPlacement'
import { inspectTrailAtLngLat, type TrailInspectResult } from '../lib/trailInspect'
import { setTrailInspectTapHandler } from '../lib/trailInspectBridge'
import { maptilerBasemapsConfigured } from '../lib/mapStyles'
import { isSnapAvailable, MIN_SNAP_ZOOM } from '../lib/snapToTrail'

function snapPreviewActive(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('[data-trail-snap-preview]') != null
}

export type TrailInspectState = {
  selection: TrailInspectResult | null
  missHint: string | null
  dismiss: () => void
  inspectReady: boolean
  vectorTrailsAvailable: boolean
  maptilerConfigured: boolean
}

export function useTrailInspect(): TrailInspectState {
  const { map } = useMapContext()
  const { state } = useAppContext()
  const { panels } = useCockpit()
  const { activeLayer, pendingWaypointType } = state
  const waypointsDocked = panels.waypoints?.docked === true
  const [selection, setSelection] = useState<TrailInspectResult | null>(null)
  const [missHint, setMissHint] = useState<string | null>(null)
  const missTimerRef = useRef<number | null>(null)

  const maptilerConfigured = maptilerBasemapsConfigured()
  const placementArmed = isWaypointPlacementAllowed(waypointsDocked, pendingWaypointType)
  const vectorTrailsAvailable = Boolean(map && isSnapAvailable(map))
  const inspectReady =
    activeLayer === 'outdoor' && !placementArmed && Boolean(map) && maptilerConfigured

  const dismiss = useCallback(() => {
    setSelection(null)
    setMissHint(null)
    if (missTimerRef.current != null) {
      window.clearTimeout(missTimerRef.current)
      missTimerRef.current = null
    }
  }, [])

  const showMiss = useCallback((message: string) => {
    setMissHint(message)
    if (missTimerRef.current != null) window.clearTimeout(missTimerRef.current)
    missTimerRef.current = window.setTimeout(() => {
      setMissHint(null)
      missTimerRef.current = null
    }, 5000)
  }, [])

  const tryInspect = useCallback(
    (lat: number, lng: number) => {
      if (activeLayer !== 'outdoor') return
      if (placementArmed) {
        showMiss('Disarm waypoint tool first — tap a route type, then DISARM to inspect trails.')
        return
      }
      if (!maptilerConfigured) {
        showMiss('MapTiler key missing — add VITE_MAPTILER_KEY to .env.local and restart dev server.')
        return
      }
      if (!map) return
      if (snapPreviewActive()) return

      if (!isSnapAvailable(map)) {
        const z = map.getZoom()
        if (typeof z === 'number' && z < MIN_SNAP_ZOOM) {
          showMiss(`Zoom in closer (level ${MIN_SNAP_ZOOM}+) to read trails.`)
        } else {
          showMiss(
            'Vector trails not loaded — switch to Outdoor and wait for the map to finish loading.',
          )
        }
        return
      }

      const result = inspectTrailAtLngLat(map, lat, lng)
      if (result) {
        setSelection(result)
        setMissHint(null)
        return
      }
      showMiss('No trail here — tap directly on a trail line.')
    },
    [activeLayer, placementArmed, map, maptilerConfigured, showMiss],
  )

  useEffect(() => {
    if (!inspectReady) {
      setTrailInspectTapHandler(null)
      return
    }
    setTrailInspectTapHandler((lat, lng) => {
      tryInspect(lat, lng)
    })
    return () => setTrailInspectTapHandler(null)
  }, [inspectReady, tryInspect])

  useEffect(() => {
    if (!inspectReady) dismiss()
  }, [inspectReady, dismiss])

  useEffect(
    () => () => {
      if (missTimerRef.current != null) window.clearTimeout(missTimerRef.current)
    },
    [],
  )

  return {
    selection,
    missHint,
    dismiss,
    inspectReady,
    vectorTrailsAvailable,
    maptilerConfigured,
  }
}
