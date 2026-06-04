import type { WearableDeviceContract } from './types'

/** Phone is the sole HUD host — never a wearable projection target. */
export const PHONE_CONTRACT: WearableDeviceContract = {
  type: 'phone',
  role: 'hud_host',
  allowedOutputChannels: ['phone'],
  allowedInputSignals: [
    'user_emergency',
    'notification_ack',
    'heart_rate',
    'motion',
    'fall',
    'sleep',
    'stress',
    'battery',
    'inactivity',
  ],
  maxTitleChars: null,
  maxBodyChars: null,
  allowedProjectionKinds: ['escalation_status', 'companion_test'],
}

/** Watch mirrors compressed status — alerts only, no HUD panels or map data. */
export const WATCH_CONTRACT: WearableDeviceContract = {
  type: 'watch',
  role: 'status_output',
  allowedOutputChannels: ['watch_notification'],
  allowedInputSignals: ['notification_ack', 'user_emergency'],
  maxTitleChars: 64,
  maxBodyChars: 180,
  allowedProjectionKinds: ['escalation_status', 'companion_test'],
}

/** Ring is sensor input only — never receives HUD projections. */
export const RING_CONTRACT: WearableDeviceContract = {
  type: 'ring',
  role: 'sensor_input',
  allowedOutputChannels: [],
  allowedInputSignals: [
    'heart_rate',
    'motion',
    'fall',
    'sleep',
    'stress',
    'battery',
    'inactivity',
  ],
  maxTitleChars: null,
  maxBodyChars: null,
  allowedProjectionKinds: [],
}

/** Glasses may receive minimal directional hints — no panels or map tiles. */
export const GLASSES_CONTRACT: WearableDeviceContract = {
  type: 'glasses',
  role: 'hint_output',
  allowedOutputChannels: ['glasses_display'],
  allowedInputSignals: ['user_emergency', 'battery'],
  maxTitleChars: 16,
  maxBodyChars: 32,
  allowedProjectionKinds: ['direction_hint', 'escalation_status'],
}

export const WEARABLE_DEVICE_CONTRACTS: Record<
  WearableDeviceContract['type'],
  WearableDeviceContract
> = {
  phone: PHONE_CONTRACT,
  watch: WATCH_CONTRACT,
  ring: RING_CONTRACT,
  glasses: GLASSES_CONTRACT,
}

export function contractForDevice(type: WearableDeviceContract['type']): WearableDeviceContract {
  return WEARABLE_DEVICE_CONTRACTS[type]
}

/** Substrings / patterns that must never appear in wearable-bound payloads. */
export const FORBIDDEN_HUD_PROJECTION_PATTERNS: RegExp[] = [
  /\b(lat(itude)?|lng|lon(gitude)?)\s*[:=]/i,
  /\b\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\b/,
  /\bwaypoint\b/i,
  /\bpolyline\b/i,
  /\broute\s*geometry\b/i,
  /\bmap(canvas|libre|box|tiler)\b/i,
  /\bpanel\b/i,
  /\bdock(ed)?\b/i,
  /\boverlay\b/i,
  /<\/?[a-z][\s\S]*>/i,
  /\bgeojson\b/i,
  /\bsnap[\s-]?to[\s-]?trail\b/i,
  /\bmission[\s-]?sync\b/i,
  /\brescue\s*packet\b/i,
]

/** Glasses direction hints — single token or short phrase only. */
export const GLASSES_HINT_PATTERN =
  /^(N|NE|E|SE|S|SW|W|NW|north|south|east|west|hold|alert|caution|\d{1,3}°?)$/i
