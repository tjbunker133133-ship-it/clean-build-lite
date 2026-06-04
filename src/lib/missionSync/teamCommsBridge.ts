/** Tier 2 bridge: TeamPresenceLayer tap → HUD comms UI (no MapCanvas / Tier 1 edits). */

export type TeammateTapPayload = {
  deviceId: string
  callsign: string
}

export type TeammateTapHandler = (payload: TeammateTapPayload) => void

let handler: TeammateTapHandler | null = null

export function setTeammateTapHandler(fn: TeammateTapHandler | null): void {
  handler = fn
}

export function dispatchTeammateTap(payload: TeammateTapPayload): void {
  if (!handler) return
  const callsign = payload.callsign?.trim()
  if (!callsign || !payload.deviceId) return
  handler({ deviceId: payload.deviceId, callsign })
}
