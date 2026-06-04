/** Optional WebRTC TURN relay for remote mission monitors (coast-to-coast). */
export function isMissionTurnConfigured(): boolean {
  const url = import.meta.env.VITE_MISSION_TURN_URL as string | undefined
  const user = import.meta.env.VITE_MISSION_TURN_USERNAME as string | undefined
  const cred = import.meta.env.VITE_MISSION_TURN_CREDENTIAL as string | undefined
  return Boolean(url?.trim() && user?.trim() && cred?.trim())
}

export const MISSION_TURN_SETUP_HINT =
  'Long-distance monitor links often need TURN. Add VITE_MISSION_TURN_URL, VITE_MISSION_TURN_USERNAME, and VITE_MISSION_TURN_CREDENTIAL to .env.local — see CAPACITOR_FIELD_APP.md.'
