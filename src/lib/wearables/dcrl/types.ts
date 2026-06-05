import type { OutputChannelKind, WearableSignalType } from '../wal/types'

/** Canonical device classes in the phone-first HUD model. */
export type DcrlDeviceType = 'phone' | 'watch' | 'ring' | 'glasses'

export type DcrlDeviceRole =
  | 'hud_host'
  | 'status_output'
  | 'sensor_input'
  | 'hint_output'

/** Static capability flags — what a device class CAN do when fully available. */
export type DcrlStaticCapability =
  | 'hud_host'
  | 'status_output'
  | 'sensor_input'
  | 'hint_output'
  | 'notification_out'
  | 'display_out'
  | 'haptic_out'
  | 'gps_host'
  | 'map_render'
  | 'sos_dispatch'
  | 'heart_rate_in'
  | 'motion_in'
  | 'fall_in'
  | 'battery_report'

export type DcrlNotificationPermission =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported'

/** Runtime conditions — what the device CAN do RIGHT NOW. */
export type DcrlDynamicState = {
  present: boolean
  connected: boolean
  authenticated: boolean
  reachable: boolean
  notificationPermission: DcrlNotificationPermission
  batteryPct: number | null
  batteryLow: boolean
  foreground: boolean
  degraded: boolean
  streaming: boolean
  lastSeenAt: number | null
}

export type DcrlStaticProfile = {
  type: DcrlDeviceType
  role: DcrlDeviceRole
  staticCapabilities: readonly DcrlStaticCapability[]
  /** Output channels this device may ever target (static ceiling). */
  outputChannels: readonly OutputChannelKind[]
  /** Signal types this device may emit toward the phone. */
  inputSignals: readonly WearableSignalType[]
}

export type DcrlDeviceRecord = {
  deviceId: string
  type: DcrlDeviceType
  displayName: string
  static: DcrlStaticProfile
  dynamic: DcrlDynamicState
  updatedAt: number
}

/** Effective capability = static ∩ dynamic availability for a given action. */
export type DcrlEffectiveCapability = {
  canReceiveOutput: boolean
  canEmitInput: boolean
  allowedOutputChannels: OutputChannelKind[]
  reasons: string[]
}

export type DcrlWcelThrottleVerdict = 'allow' | 'restrict' | 'block'

/** Advisory directive for WCEL consumers — does not alter WCEL contract rules. */
export type DcrlWcelThrottleDirective = {
  verdict: DcrlWcelThrottleVerdict
  device: DcrlDeviceType
  channel: OutputChannelKind | null
  /** When restrict: channels that may still proceed after DCRL filtering. */
  allowedChannels: OutputChannelKind[]
  reasons: string[]
}

export type DcrlThrottleRecord = {
  ts: number
  device: DcrlDeviceType
  channel: OutputChannelKind | null
  verdict: DcrlWcelThrottleVerdict
  reasons: string[]
}

export type DcrlDiagnostics = {
  updatedAt: number
  devices: DcrlDeviceRecord[]
  lastThrottle: DcrlThrottleRecord | null
  recentThrottles: DcrlThrottleRecord[]
}

export type DcrlThrottleContext = {
  urgency?: 'info' | 'warn' | 'critical'
  /** When true, non-critical throttles may still allow phone channel. */
  phoneIsSystemOfRecord?: boolean
}
