import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useMissionSync } from '../context/MissionSyncContext'
import { filterTeammatePresence } from '../lib/missionSync/presence'
import { dispatchTeammateTap } from '../lib/missionSync/teamCommsBridge'

const TEAM_COLORS = ['#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#fb7185', '#22d3ee']

function colorForDevice(deviceId: string): string {
  let h = 0
  for (let i = 0; i < deviceId.length; i += 1) h = (h * 31 + deviceId.charCodeAt(i)) >>> 0
  return TEAM_COLORS[h % TEAM_COLORS.length]!
}

function createTeammateMarkerEl(callsign: string, color: string, accuracyM: number | null): HTMLElement {
  const root = document.createElement('div')
  root.style.position = 'relative'
  root.style.width = '22px'
  root.style.height = '22px'
  root.style.pointerEvents = 'auto'
  root.style.cursor = 'pointer'
  root.title = `Message ${callsign}`

  const ring = document.createElement('div')
  ring.style.width = '20px'
  ring.style.height = '20px'
  ring.style.borderRadius = '50%'
  ring.style.border = `2px solid ${color}`
  ring.style.boxShadow = `0 0 12px ${color}88`
  ring.style.position = 'absolute'
  ring.style.left = '1px'
  ring.style.top = '1px'

  const core = document.createElement('div')
  core.style.width = '8px'
  core.style.height = '8px'
  core.style.borderRadius = '50%'
  core.style.background = color
  core.style.position = 'absolute'
  core.style.left = '7px'
  core.style.top = '7px'

  const label = document.createElement('div')
  label.textContent = callsign.slice(0, 12)
  label.style.position = 'absolute'
  label.style.top = '22px'
  label.style.left = '50%'
  label.style.transform = 'translateX(-50%)'
  label.style.whiteSpace = 'nowrap'
  label.style.fontSize = '10px'
  label.style.fontWeight = '700'
  label.style.color = '#e2e8f0'
  label.style.textShadow = '0 1px 3px rgba(0,0,0,0.9)'
  label.style.padding = '1px 5px'
  label.style.borderRadius = '4px'
  label.style.background = 'rgba(8, 12, 18, 0.82)'

  if (accuracyM != null && Number.isFinite(accuracyM)) {
    const acc = document.createElement('div')
    acc.textContent = `±${Math.round(accuracyM)}m`
    acc.style.position = 'absolute'
    acc.style.top = '38px'
    acc.style.left = '50%'
    acc.style.transform = 'translateX(-50%)'
    acc.style.fontSize = '9px'
    acc.style.color = '#94a3b8'
    acc.style.whiteSpace = 'nowrap'
    root.appendChild(acc)
  }

  root.appendChild(ring)
  root.appendChild(core)
  root.appendChild(label)
  return root
}

/**
 * Tier 2 — teammate GPS from mission mesh (not GPS truth for self).
 * Raw device GPS remains the red user marker in MapCanvas.
 */
export default function TeamPresenceLayer() {
  const { map } = useMapContext()
  const { teamPresence, deviceId, role, peers } = useMissionSync()
  const markersRef = useRef<Record<string, maplibregl.Marker>>({})

  useEffect(() => {
    if (!map) return

    const teammates = filterTeammatePresence(teamPresence, deviceId)
    const activeIds = new Set(teammates.map((t) => t.deviceId))

    for (const id of Object.keys(markersRef.current)) {
      if (!activeIds.has(id)) {
        markersRef.current[id]?.remove()
        delete markersRef.current[id]
      }
    }

    if (role === 'idle' && peers.length === 0) {
      Object.values(markersRef.current).forEach((m) => m.remove())
      markersRef.current = {}
      return
    }

    for (const t of teammates) {
      const color = colorForDevice(t.deviceId)
      const existing = markersRef.current[t.deviceId]
      if (existing) {
        existing.setLngLat([t.lng!, t.lat!])
        continue
      }
      const el = createTeammateMarkerEl(t.callsign, color, t.accuracy)
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        dispatchTeammateTap({ deviceId: t.deviceId, callsign: t.callsign })
      })
      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
        pitchAlignment: 'map',
        rotationAlignment: 'map',
      })
        .setLngLat([t.lng!, t.lat!])
        .addTo(map)
      markersRef.current[t.deviceId] = marker
    }
  }, [map, teamPresence, deviceId, role, peers.length])

  useEffect(() => {
    return () => {
      Object.values(markersRef.current).forEach((m) => m.remove())
      markersRef.current = {}
    }
  }, [])

  return null
}
