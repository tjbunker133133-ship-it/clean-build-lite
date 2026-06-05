import type { OutputChannelKind } from '../wal/types'
import type {
  DcrlDeviceRecord,
  DcrlDeviceType,
  DcrlEffectiveCapability,
  DcrlThrottleContext,
  DcrlWcelThrottleDirective,
} from './types'
import { getDcrlDeviceByType, recordDcrlThrottle } from './store'

function effectiveForRecord(record: DcrlDeviceRecord | null): DcrlEffectiveCapability {
  if (!record || !record.dynamic.present) {
    return {
      canReceiveOutput: false,
      canEmitInput: false,
      allowedOutputChannels: [],
      reasons: ['device_not_present'],
    }
  }

  const reasons: string[] = []
  const { dynamic, static: profile } = record

  if (!dynamic.reachable) reasons.push('device_unreachable')
  if (dynamic.degraded) reasons.push('device_degraded')
  if (dynamic.batteryLow) reasons.push('battery_low')

  const canEmitInput =
    dynamic.connected &&
    dynamic.authenticated &&
    dynamic.reachable &&
    profile.inputSignals.length > 0

  if (!dynamic.connected) reasons.push('not_connected')
  if (!dynamic.authenticated && profile.role !== 'hud_host') reasons.push('not_authenticated')

  let allowedOutputChannels = [...profile.outputChannels] as OutputChannelKind[]

  if (record.type === 'watch') {
    if (dynamic.notificationPermission !== 'granted') {
      allowedOutputChannels = allowedOutputChannels.filter((c) => c !== 'watch_notification')
      reasons.push('notification_not_granted')
    }
    if (!dynamic.connected) {
      allowedOutputChannels = []
      reasons.push('watch_not_connected')
    }
  }

  if (record.type === 'glasses') {
    if (!dynamic.connected) {
      allowedOutputChannels = []
      reasons.push('glasses_not_connected')
    }
  }

  if (record.type === 'ring') {
    allowedOutputChannels = []
    reasons.push('ring_input_only')
  }

  if (record.type === 'phone') {
    allowedOutputChannels = ['phone']
  }

  const canReceiveOutput = allowedOutputChannels.length > 0 && dynamic.reachable

  return { canReceiveOutput, canEmitInput, allowedOutputChannels, reasons }
}

export function resolveEffectiveCapability(type: DcrlDeviceType): DcrlEffectiveCapability {
  return effectiveForRecord(getDcrlDeviceByType(type))
}

/** Maps output channel to owning device type for throttle evaluation. */
export function channelOwnerDevice(channel: OutputChannelKind): DcrlDeviceType {
  switch (channel) {
    case 'watch_notification':
      return 'watch'
    case 'glasses_display':
      return 'glasses'
    case 'ring_passive':
      return 'ring'
    default:
      return 'phone'
  }
}

/**
 * DCRL throttle directive for WCEL consumers.
 * Does NOT replace WCEL contract validation — runs as a pre-condition layer.
 */
export function resolveWcelThrottleDirective(
  channel: OutputChannelKind,
  context: DcrlThrottleContext = {},
): DcrlWcelThrottleDirective {
  const device = channelOwnerDevice(channel)
  const effective = resolveEffectiveCapability(device)
  const urgency = context.urgency ?? 'info'
  const reasons = [...effective.reasons]

  if (channel === 'phone') {
    const directive: DcrlWcelThrottleDirective = {
      verdict: 'allow',
      device: 'phone',
      channel,
      allowedChannels: ['phone'],
      reasons: [],
    }
    recordDcrlThrottle({ device, channel, verdict: directive.verdict, reasons: directive.reasons })
    return directive
  }

  if (!effective.allowedOutputChannels.includes(channel)) {
    const directive: DcrlWcelThrottleDirective = {
      verdict: 'block',
      device,
      channel,
      allowedChannels: context.phoneIsSystemOfRecord !== false ? ['phone'] : [],
      reasons: reasons.length ? reasons : ['channel_unavailable'],
    }
    recordDcrlThrottle({ device, channel, verdict: directive.verdict, reasons: directive.reasons })
    return directive
  }

  if (device === 'watch' && urgency !== 'critical') {
    const phone = getDcrlDeviceByType('phone')
    if (phone && !phone.dynamic.foreground) {
      const directive: DcrlWcelThrottleDirective = {
        verdict: 'restrict',
        device,
        channel,
        allowedChannels: ['phone'],
        reasons: ['phone_background_non_critical'],
      }
      recordDcrlThrottle({ device, channel, verdict: directive.verdict, reasons: directive.reasons })
      return directive
    }
  }

  if (effective.canReceiveOutput) {
    const directive: DcrlWcelThrottleDirective = {
      verdict: 'allow',
      device,
      channel,
      allowedChannels: [channel],
      reasons: [],
    }
    recordDcrlThrottle({ device, channel, verdict: directive.verdict, reasons: directive.reasons })
    return directive
  }

  const directive: DcrlWcelThrottleDirective = {
    verdict: 'block',
    device,
    channel,
    allowedChannels: ['phone'],
    reasons,
  }
  recordDcrlThrottle({ device, channel, verdict: directive.verdict, reasons: directive.reasons })
  return directive
}

/** Diagnostic-only — DCRL does not block channels in the production pipeline. */
export function filterChannelsByDcrl(
  channels: OutputChannelKind[],
  _context: DcrlThrottleContext = {},
): OutputChannelKind[] {
  return [...channels]
}

/** @deprecated Diagnostic only — blocking is WCEL authority. Always returns true. */
export function dcrlAllowsChannelProjection(
  _channel: OutputChannelKind,
  _context: DcrlThrottleContext = {},
): boolean {
  return true
}
