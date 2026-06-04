import { haversineMeters } from '../haversine'
import { minMovementGateM, STOPPED_MPS } from '../travelSpeed'
import type { TeamPresence } from './types'

/** Stabilize mesh presence so standing devices do not wander on teammates' maps. */
export function buildStabilizedTeamPresence(args: {
  deviceId: string
  callsign: string
  lat: number
  lng: number
  accuracy: number | null
  elevationM?: number
  speedMph?: number
  speedMps?: number | null
  headingDeg?: number
  lastPublished: TeamPresence | null
  nowMs?: number
}): TeamPresence {
  const gateM = minMovementGateM(args.accuracy)
  let lat = args.lat
  let lng = args.lng
  let headingDeg = args.headingDeg
  const last = args.lastPublished
  let movedEnough = true

  if (last?.lat != null && last?.lng != null) {
    const movedM = haversineMeters(last.lat, last.lng, lat, lng)
    if (movedM < gateM) {
      movedEnough = false
      lat = last.lat
      lng = last.lng
      headingDeg = last.headingDeg
    }
  }

  const speedMph =
    movedEnough &&
    args.speedMps != null &&
    args.speedMps >= STOPPED_MPS &&
    args.speedMph != null
      ? args.speedMph
      : undefined

  return {
    deviceId: args.deviceId,
    callsign: args.callsign,
    lat,
    lng,
    accuracy: args.accuracy,
    updatedAt: args.nowMs ?? Date.now(),
    speedMph,
    headingDeg: speedMph != null ? headingDeg : undefined,
    elevationM: args.elevationM,
  }
}
