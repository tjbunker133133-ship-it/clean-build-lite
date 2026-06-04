import type { OutputChannelKind, WearableSignalType } from '../wal/types'

/** Canonical wearable roles in the phone-first HUD model. */
export type WearableDeviceType = 'phone' | 'watch' | 'ring' | 'glasses'

export type WearableChannelRole =
  | 'hud_host'
  | 'status_output'
  | 'sensor_input'
  | 'hint_output'

export type WearableProjectionKind =
  | 'escalation_status'
  | 'direction_hint'
  | 'companion_test'

export type WearableDeviceContract = {
  type: WearableDeviceType
  role: WearableChannelRole
  /** Output channel kinds this device may receive (empty = input-only). */
  allowedOutputChannels: OutputChannelKind[]
  /** Signal types this device may emit toward the phone. */
  allowedInputSignals: WearableSignalType[]
  maxTitleChars: number | null
  maxBodyChars: number | null
  /** Projection kinds permitted on this device. */
  allowedProjectionKinds: WearableProjectionKind[]
}

export type WcelVerdict = 'allow' | 'block'

export type WcelViolationCode =
  | 'device_input_only'
  | 'channel_not_allowed'
  | 'title_too_long'
  | 'body_too_long'
  | 'forbidden_hud_payload'
  | 'invalid_glasses_hint'
  | 'ring_output_forbidden'
  | 'signal_type_not_allowed'
  | 'unknown_channel'

export type WcelViolation = {
  code: WcelViolationCode
  device: WearableDeviceType
  channel?: OutputChannelKind
  message: string
}

export type WcelValidationResult = {
  verdict: WcelVerdict
  violations: WcelViolation[]
}

export type WcelEnforcementRecord = {
  ts: number
  device: WearableDeviceType
  channel: OutputChannelKind | null
  verdict: WcelVerdict
  violations: WcelViolation[]
  blocked: boolean
}

export type WcelDiagnostics = {
  updatedAt: number
  totalAllowed: number
  totalBlocked: number
  lastBlocked: WcelEnforcementRecord | null
  recent: WcelEnforcementRecord[]
}
