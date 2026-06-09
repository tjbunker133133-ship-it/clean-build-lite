/**
 * MissionControllerBridge — binds live GPS, route, map, and environment into mission session.
 * Subscribes only; does not own GPS or waypoints.
 */

import { useEffect, useRef } from 'react'
import { useAppContext } from '../context/AppContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useOverlayContext } from '../context/OverlayContext'
import { useOperationalSession } from '../context/OperationalSessionContext'
import { useGPS } from '../hooks/useGPS'
import { useMissionSync } from '../context/MissionSyncContext'
import {
  enterMission,
  exitMission,
  getMissionSnapshot,
  isMissionSessionActive,
  subscribeMission,
  updateMission,
} from '../lib/missionController'
import { osgGetRouteWaypoints } from '../lib/operationalStateGraph'
import type { MissionWaypointRef } from '../lib/missionController/types'
import { ENVIRONMENTAL_OVERLAY_IDS } from '../lib/environmentalOverlays/catalog'

function toWaypointRefs(waypoints: ReturnType<typeof useAppContext>['state']['waypoints']): MissionWaypointRef[] {
  return waypoints
    .filter((w) => w.status !== 'archived')
    .map((w) => ({
      id: w.id,
      lat: w.lat,
      lng: w.lng,
      label: w.label,
      type: w.type,
    }))
}

export function MissionControllerBridge() {
  const { state } = useAppContext()
  const gps = useGPS()
  const { mode } = useHudPresentation()
  const { session, setPhase } = useOperationalSession()
  const { toggles, online } = useOverlayContext()
  const missionSync = useMissionSync()
  const phaseRef = useRef(session.phase)
  phaseRef.current = session.phase
  const lastMissionBindingRef = useRef('')

  // Phase bridge: mission status → operational session phase (skip redundant patches)
  useEffect(() => {
    return subscribeMission(() => {
      const snap = getMissionSnapshot()
      const nextPhase =
        snap.status === 'active'
          ? 'navigating'
          : snap.status === 'paused'
            ? 'planning'
            : 'idle'
      if (phaseRef.current === nextPhase) return
      phaseRef.current = nextPhase
      setPhase(nextPhase)
    })
  }, [setPhase])

  // Team mesh → mission controller envelope
  useEffect(() => {
    if (missionSync.role === 'idle') {
      const snap = getMissionSnapshot()
      if (snap.kind === 'team' && isMissionSessionActive()) {
        exitMission('team_disconnected')
      }
      return
    }
    const snap = getMissionSnapshot()
    if (snap.kind === 'team' && snap.teamMissionId === missionSync.missionId && isMissionSessionActive()) {
      return
    }
    enterMission({
      missionName: missionSync.missionName || 'Team mission',
      kind: 'team',
      teamMissionId: missionSync.missionId,
      missionId: missionSync.missionId ?? undefined,
      routeName: session.routeName,
      waypoints: toWaypointRefs([...osgGetRouteWaypoints()]),
      mapSession: {
        presentationMode: mode,
        basemap: state.activeLayer,
        routeName: session.routeName,
      },
    })
  }, [
    missionSync.role,
    missionSync.missionId,
    missionSync.missionName,
    mode,
    session.routeName,
    state.activeLayer,
    state.waypoints,
  ])

  // Live bindings while session active/paused (skip identical patches — avoids OSG emit storms)
  useEffect(() => {
    if (!isMissionSessionActive()) {
      lastMissionBindingRef.current = ''
      return
    }

    const activeOverlays = ENVIRONMENTAL_OVERLAY_IDS.filter((id) => toggles[id])
    const bindingFingerprint = JSON.stringify({
      waypoints: toWaypointRefs([...osgGetRouteWaypoints()]),
      mapSession: {
        presentationMode: mode,
        basemap: state.activeLayer,
        routeName: session.routeName,
      },
      gps: {
        lat: gps.lat,
        lng: gps.lng,
        accuracy: gps.accuracy,
      },
      environment: {
        online,
        activeOverlays,
        terrainOverlayEnabled: toggles.relief_usgs === true,
        weatherAvailable: online,
      },
    })
    if (bindingFingerprint === lastMissionBindingRef.current) return
    lastMissionBindingRef.current = bindingFingerprint

    updateMission({
      waypoints: toWaypointRefs([...osgGetRouteWaypoints()]),
      mapSession: {
        presentationMode: mode,
        basemap: state.activeLayer,
        routeName: session.routeName,
      },
      gps: {
        lat: gps.lat,
        lng: gps.lng,
        accuracy: gps.accuracy,
        updatedAt: gps.lat != null ? Date.now() : null,
      },
      environment: {
        online,
        activeOverlays,
        terrainOverlayEnabled: toggles.relief_usgs === true,
        weatherAvailable: online,
      },
    })
  }, [
    state.waypoints,
    state.activeLayer,
    session.routeName,
    mode,
    gps.lat,
    gps.lng,
    gps.accuracy,
    toggles,
    online,
  ])

  return null
}

export default MissionControllerBridge
