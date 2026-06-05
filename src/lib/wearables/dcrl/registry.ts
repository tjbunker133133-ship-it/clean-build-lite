import type { DcrlDeviceType, DcrlStaticProfile } from './types'

/** Phone — sole HUD host; full map, GPS, SOS authority. */
export const PHONE_STATIC_PROFILE: DcrlStaticProfile = {
  type: 'phone',
  role: 'hud_host',
  staticCapabilities: [
    'hud_host',
    'gps_host',
    'map_render',
    'sos_dispatch',
    'notification_out',
    'status_output',
    'heart_rate_in',
    'motion_in',
    'fall_in',
    'battery_report',
  ],
  outputChannels: ['phone'],
  inputSignals: [
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
}

/** Watch — compressed status mirror; no HUD panels or map payloads. */
export const WATCH_STATIC_PROFILE: DcrlStaticProfile = {
  type: 'watch',
  role: 'status_output',
  staticCapabilities: ['status_output', 'notification_out', 'haptic_out'],
  outputChannels: ['watch_notification'],
  inputSignals: ['notification_ack', 'user_emergency'],
}

/** Ring — sensor ingress only; never receives projections. */
export const RING_STATIC_PROFILE: DcrlStaticProfile = {
  type: 'ring',
  role: 'sensor_input',
  staticCapabilities: ['sensor_input', 'heart_rate_in', 'motion_in', 'fall_in', 'battery_report'],
  outputChannels: [],
  inputSignals: ['heart_rate', 'motion', 'fall', 'sleep', 'stress', 'battery', 'inactivity'],
}

/** Glasses — minimal directional hints; no panels or map tiles. */
export const GLASSES_STATIC_PROFILE: DcrlStaticProfile = {
  type: 'glasses',
  role: 'hint_output',
  staticCapabilities: ['hint_output', 'display_out'],
  outputChannels: ['glasses_display'],
  inputSignals: ['user_emergency', 'battery'],
}

export const DCRL_STATIC_REGISTRY: Record<DcrlDeviceType, DcrlStaticProfile> = {
  phone: PHONE_STATIC_PROFILE,
  watch: WATCH_STATIC_PROFILE,
  ring: RING_STATIC_PROFILE,
  glasses: GLASSES_STATIC_PROFILE,
}

export function staticProfileFor(type: DcrlDeviceType): DcrlStaticProfile {
  return DCRL_STATIC_REGISTRY[type]
}

export function defaultDynamicState(present = false): import('./types').DcrlDynamicState {
  return {
    present,
    connected: false,
    authenticated: false,
    reachable: true,
    notificationPermission: 'unsupported',
    batteryPct: null,
    batteryLow: false,
    foreground: true,
    degraded: false,
    streaming: false,
    lastSeenAt: null,
  }
}
