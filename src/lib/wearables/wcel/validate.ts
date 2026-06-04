import type { EscalationProjection, OutputChannelKind, WearableSignal } from '../wal/types'
import {
  contractForDevice,
  FORBIDDEN_HUD_PROJECTION_PATTERNS,
  GLASSES_HINT_PATTERN,
} from './contracts'
import type {
  WcelValidationResult,
  WcelViolation,
  WearableDeviceType,
  WearableProjectionKind,
} from './types'

function block(
  device: WearableDeviceType,
  code: WcelViolation['code'],
  message: string,
  channel?: OutputChannelKind,
): WcelValidationResult {
  return {
    verdict: 'block',
    violations: [{ code, device, message, channel }],
  }
}

function allow(): WcelValidationResult {
  return { verdict: 'allow', violations: [] }
}

function merge(...results: WcelValidationResult[]): WcelValidationResult {
  const violations = results.flatMap((r) => r.violations)
  return { verdict: violations.length > 0 ? 'block' : 'allow', violations }
}

function containsForbiddenHudLeak(text: string): boolean {
  return FORBIDDEN_HUD_PROJECTION_PATTERNS.some((re) => re.test(text))
}

function checkTextLimits(
  device: WearableDeviceType,
  title: string,
  body: string,
): WcelValidationResult {
  const contract = contractForDevice(device)
  const violations: WcelViolation[] = []
  if (contract.maxTitleChars != null && title.length > contract.maxTitleChars) {
    violations.push({
      code: 'title_too_long',
      device,
      message: `title ${title.length} chars exceeds ${contract.maxTitleChars}`,
    })
  }
  if (contract.maxBodyChars != null && body.length > contract.maxBodyChars) {
    violations.push({
      code: 'body_too_long',
      device,
      message: `body ${body.length} chars exceeds ${contract.maxBodyChars}`,
    })
  }
  return violations.length ? { verdict: 'block', violations } : allow()
}

function checkHudLeak(device: WearableDeviceType, title: string, body: string): WcelValidationResult {
  const combined = `${title}\n${body}`
  if (!containsForbiddenHudLeak(combined)) return allow()
  return block(device, 'forbidden_hud_payload', 'projection contains HUD/map/route/panel data')
}

export function channelToDevice(channel: OutputChannelKind): WearableDeviceType | null {
  switch (channel) {
    case 'phone':
      return 'phone'
    case 'watch_notification':
      return 'watch'
    case 'glasses_display':
      return 'glasses'
    case 'ring_passive':
      return 'ring'
    default:
      return null
  }
}

export function inferProjectionKind(projection: EscalationProjection): WearableProjectionKind {
  if (projection.title.toLowerCase().includes('companion test')) return 'companion_test'
  if (projection.channels.includes('glasses_display')) return 'direction_hint'
  return 'escalation_status'
}

/** Validate a WAL escalation projection against device contracts for each target channel. */
export function validateEscalationProjection(projection: EscalationProjection): WcelValidationResult {
  const results: WcelValidationResult[] = []

  for (const channel of projection.channels) {
    const device = channelToDevice(channel)
    if (!device) {
      results.push(
        block('phone', 'unknown_channel', `unknown output channel ${channel}`, channel),
      )
      continue
    }

    const contract = contractForDevice(device)

    if (contract.allowedOutputChannels.length === 0) {
      results.push(
        block(device, 'device_input_only', `${device} is input-only`, channel),
      )
      continue
    }

    if (!contract.allowedOutputChannels.includes(channel)) {
      results.push(
        block(device, 'channel_not_allowed', `channel ${channel} not allowed on ${device}`, channel),
      )
      continue
    }

    const kind = inferProjectionKind(projection)
    if (!contract.allowedProjectionKinds.includes(kind)) {
      results.push(
        block(device, 'channel_not_allowed', `projection kind ${kind} not allowed on ${device}`, channel),
      )
      continue
    }

    if (device === 'ring') {
      results.push(block(device, 'ring_output_forbidden', 'ring cannot receive projections', channel))
      continue
    }

    if (device === 'watch' || device === 'phone') {
      results.push(
        checkTextLimits(device, projection.title, projection.body),
        checkHudLeak(device, projection.title, projection.body),
      )
    }

    if (device === 'glasses') {
      results.push(
        checkTextLimits(device, projection.title, projection.body),
        checkHudLeak(device, projection.title, projection.body),
      )
      const hint = `${projection.title} ${projection.body}`.trim()
      if (!GLASSES_HINT_PATTERN.test(hint) && hint.length > 32) {
        results.push({
          verdict: 'block',
          violations: [
            {
              code: 'invalid_glasses_hint',
              device,
              channel,
              message: 'glasses payload must be minimal directional hint',
            },
          ],
        })
      }
    }
  }

  return merge(...results)
}

/** Validate inbound wearable signal against source device contract. */
export function validateWearableSignalIngress(
  signal: WearableSignal,
  sourceDevice: WearableDeviceType,
): WcelValidationResult {
  const contract = contractForDevice(sourceDevice)
  if (!contract.allowedInputSignals.includes(signal.type)) {
    return block(
      sourceDevice,
      'signal_type_not_allowed',
      `signal ${signal.type} not allowed from ${sourceDevice}`,
    )
  }
  return allow()
}

/** Map WAL adapter / connect classification to WCEL device type. */
export function inferDeviceTypeFromSource(sourceDevice: string): WearableDeviceType {
  const s = sourceDevice.toLowerCase()
  if (s.includes('ring')) return 'ring'
  if (s.includes('glass')) return 'glasses'
  if (s.includes('watch') || s.includes('wear')) return 'watch'
  return 'phone'
}
