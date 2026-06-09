import { useEffect, useRef } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { requestCameraIntent } from '../lib/operationalPerception/perceptionEngine'

const MIN_FOLLOW_ZOOM = 13.5
const EASE_MS = 480

/**
 * Tier 2 — auto-follow the field operator on the map while in read-only monitor mode.
 * Camera via perception intent queue only.
 */
export default function MonitorMapFollow() {
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
    if (role !== 'observer' || !monitorLive) return
    const p = monitoredPresence
    if (p?.lat == null || p.lng == null) return

    const last = lastCenterRef.current
    if (last && last.lat === p.lat && last.lng === p.lng) return
    lastCenterRef.current = { lat: p.lat, lng: p.lng }

    const nextZoom = !zoomAppliedRef.current ? MIN_FOLLOW_ZOOM : undefined
    if (!zoomAppliedRef.current) zoomAppliedRef.current = true

    requestCameraIntent({
      kind: 'ease_to',
      center: [p.lng, p.lat],
      zoom: nextZoom,
      durationMs: EASE_MS,
    })
  }, [role, monitorLive, monitoredPresence?.lat, monitoredPresence?.lng, monitoredPresence?.updatedAt])

  return null
}
