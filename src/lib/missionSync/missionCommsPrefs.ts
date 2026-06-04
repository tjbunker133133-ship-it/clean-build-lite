const HANDS_FREE_KEY = 'mission_comms_handsfree_v1'
const HOLD_BUTTON_KEY = 'mission_comms_hold_button_v1'
const INBOUND_CONFIRM_KEY = 'mission_comms_inbound_confirm_v1'

export type MissionCommsPrefs = {
  /** HUD wake + voice steps (no button). Default on. */
  handsFree: boolean
  /** Purple hold-to-speak button. Default on — either mode can be used. */
  holdButton: boolean
  /** Recipient says accept before TTS plays. Default on. */
  inboundConfirm: boolean
}

const DEFAULTS: MissionCommsPrefs = {
  handsFree: true,
  holdButton: true,
  inboundConfirm: true,
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === '0') return false
    if (v === '1') return true
    return fallback
  } catch {
    return fallback
  }
}

export function loadMissionCommsPrefs(): MissionCommsPrefs {
  return {
    handsFree: readBool(HANDS_FREE_KEY, DEFAULTS.handsFree),
    holdButton: readBool(HOLD_BUTTON_KEY, DEFAULTS.holdButton),
    inboundConfirm: readBool(INBOUND_CONFIRM_KEY, DEFAULTS.inboundConfirm),
  }
}

export function saveMissionCommsPrefs(patch: Partial<MissionCommsPrefs>): MissionCommsPrefs {
  const next = { ...loadMissionCommsPrefs(), ...patch }
  try {
    localStorage.setItem(HANDS_FREE_KEY, next.handsFree ? '1' : '0')
    localStorage.setItem(HOLD_BUTTON_KEY, next.holdButton ? '1' : '0')
    localStorage.setItem(INBOUND_CONFIRM_KEY, next.inboundConfirm ? '1' : '0')
  } catch {
    /* ignore */
  }
  return next
}
