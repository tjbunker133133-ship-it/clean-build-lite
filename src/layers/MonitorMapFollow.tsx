import { useEffect, useRef } from 'react'
import { useMapContext } from '../context/MapContext'
import { useMissionSync } from '../context/MissionSyncContext'

const MIN_FOLLOW_ZOOM = 13.5
const EASE_MS = 480

/**
 * Tier 2 — auto-follow the field operator on the map while in read-only monitor mode.
 */
export default function MonitorMapFollow() {
  const { map } = useMapContext()
  const { role, monitorLive, monitoredPresence } = useMissionSync()
  const lastCenterRef = useRef<{ lat: number; lng: number } | null>(null)
  const zoomAppliedRef = useRef(false)

  useEffect(() => {
    if (role !== 'observer') {
      lastCenterRef.current = null
      zoomAppliedRef.current = false
    }
  }, [role])

  useEffect(() => {
    if (role !== 'observer' || !monitorLive || !map) return
    const p = monitoredPresence
    if (p?.lat == null || p.lng == null) return

    const last = lastCenterRef.current
    if (last && last.lat === p.lat && last.lng === p.lng) return
    lastCenterRef.current = { lat: p.lat, lng: p.lng }

    const zoom = map.getZoom()
    const nextZoom = !zoomAppliedRef.current && zoom < MIN_FOLLOW_ZOOM ? MIN_FOLLOW_ZOOM : zoom
    if (!zoomAppliedRef.current && nextZoom >= MIN_FOLLOW_ZOOM) zoomAppliedRef.current = true

    map.easeTo({
      center: [p.lng, p.lat],
      zoom: nextZoom,
      duration: EASE_MS,
      essential: true,
    })
  }, [role, monitorLive, map, monitoredPresence?.lat, monitoredPresence?.lng, monitoredPresence?.updatedAt])

  return null
}
