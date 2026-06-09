/**
 * @deprecated Adapter — delegates to operationalStateGraph (canonical truth).
 */

import {
  __resetOperationalStateGraphForTests,
  osgEnterMission,
  osgExitMission,
  osgFormatMissionDuration,
  osgGetMissionDurationMs,
  osgGetMissionSnapshot,
  osgGetMissionStatus,
  osgIsMissionActive,
  osgPauseMission,
  osgResumeMission,
  osgUpdateMission,
  subscribeOperationalGraph,
} from './operationalStateGraph'

export type {
  EnterMissionInput,
  MissionSession,
  MissionStatus,
  MissionWaypointRef,
  UpdateMissionInput,
} from './missionController/types'

export { DEFAULT_MISSION_SESSION } from './missionController/types'

export const subscribeMission = subscribeOperationalGraph

type MissionSnapshotCache = {
  snapshot: ReturnType<typeof osgGetMissionSnapshot>
  revision: string
}

function missionSnapshotRevision(s: ReturnType<typeof osgGetMissionSnapshot>): string {
  return JSON.stringify({
    status: s.status,
    missionId: s.missionId,
    missionName: s.missionName,
    kind: s.kind,
    pausedAt: s.pausedAt,
    teamMissionId: s.teamMissionId,
    activeRouteId: s.activeRouteId,
    waypoints: s.waypoints,
    activeWaypointIds: s.activeWaypointIds,
    gps: s.gps,
    environment: s.environment,
    mapSession: s.mapSession,
    startTime: s.startTime,
    endTime: s.endTime,
  })
}

let missionCache: MissionSnapshotCache = {
  snapshot: osgGetMissionSnapshot(),
  revision: '',
}

function rebuildMissionSnapshotCache(): void {
  const next = osgGetMissionSnapshot()
  const revision = missionSnapshotRevision(next)
  if (revision === missionCache.revision) return
  missionCache = { snapshot: next, revision }
}

subscribeOperationalGraph(rebuildMissionSnapshotCache)
missionCache.revision = missionSnapshotRevision(missionCache.snapshot)

/** Stable reference for useSyncExternalStore — only changes when mission data changes. */
export function getMissionSnapshot(): ReturnType<typeof osgGetMissionSnapshot> {
  return missionCache.snapshot
}
export const getMissionStatus = osgGetMissionStatus
export const isMissionSessionActive = osgIsMissionActive
export const enterMission = osgEnterMission
export const updateMission = osgUpdateMission
export const pauseMission = osgPauseMission
export const resumeMission = osgResumeMission
export const exitMission = osgExitMission
export const getMissionDurationMs = osgGetMissionDurationMs
export const formatMissionDuration = osgFormatMissionDuration

export function rehydrateMissionSession() {
  return osgGetMissionSnapshot()
}

export function __resetMissionControllerForTests(): void {
  __resetOperationalStateGraphForTests()
  const snap = osgGetMissionSnapshot()
  missionCache = { snapshot: snap, revision: missionSnapshotRevision(snap) }
}
