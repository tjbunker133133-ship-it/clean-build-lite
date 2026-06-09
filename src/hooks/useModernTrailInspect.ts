import { useCallback, useEffect, useRef, useState } from 'react'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import {
  getInteractionMode,
  getMapInteractionSnapshot,
  subscribeMapInteraction,
} from '../lib/mapInteractionController'
import { inspectTrailAtLngLat, type TrailInspectResult } from '../lib/trailInspect'
import { setTrailInspectTapHandler } from '../lib/trailInspectBridge'
import { maptilerBasemapsConfigured } from '../lib/mapStyles'
import { isSnapAvailable, MIN_SNAP_ZOOM } from '../lib/snapToTrail'
import { trailInfoStub } from '../lib/modernLayerGuardrails'
import { useSyncExternalStore } from 'react'

export type ModernTrailInspectState = {
  selection: TrailInspectResult | null
  missHint: string | null
  dismiss: () => void
}

export function useModernTrailInspect(): ModernTrailInspectState {
  const { map } = useMapContext()
  const { state } = useAppContext()
  const { mode } = useHudPresentation()
  const interaction = useSyncExternalStore(subscribeMapInteraction, getMapInteractionSnapshot)
  const [selection, setSelection] = useState<TrailInspectResult | null>(null)
  const [missHint, setMissHint] = useState<string | null>(null)
  const missTimerRef = useRef<number | null>(null)

  const isImmersive = mode === 'immersive'
  const placementArmed = getInteractionMode() === 'drop'
  const maptilerConfigured = maptilerBasemapsConfigured()
  const inspectReady =
    isImmersive &&
    state.activeLayer === 'outdoor' &&
    !placementArmed &&
    Boolean(map) &&
    maptilerConfigured

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
      if (!inspectReady || !map) return
      if (placementArmed) {
        showMiss('Disarm waypoint tool to inspect trails')
        return
      }
      if (!isSnapAvailable(map)) {
        const z = map.getZoom()
        if (typeof z === 'number' && z < MIN_SNAP_ZOOM) {
          showMiss(`Zoom in closer (level ${MIN_SNAP_ZOOM}+) to read trails`)
        } else {
          showMiss('Vector trails not loaded — wait for map to finish loading')
        }
        return
      }

      const result = inspectTrailAtLngLat(map, lat, lng)
      if (result) {
        setSelection(result)
        setMissHint(null)
        return
      }

      const stub = trailInfoStub(lat, lng)
      setSelection({
        name: stub.name,
        ref: null,
        trailClass: 'trail',
        lat,
        lng,
        distanceMeters: 0,
        links: [],
        disclaimer: stub.disclaimer,
      })
      setMissHint(null)
    },
    [inspectReady, map, placementArmed, showMiss],
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
  }, [inspectReady, dismiss, interaction.mode])

  useEffect(
    () => () => {
      if (missTimerRef.current != null) window.clearTimeout(missTimerRef.current)
    },
    [],
  )

  return { selection, missHint, dismiss }
}
