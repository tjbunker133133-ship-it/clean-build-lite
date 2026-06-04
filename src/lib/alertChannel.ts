export type AlertChannel = 'both' | 'email' | 'push'

export const ALERT_CHANNEL_OPTIONS: { value: AlertChannel; label: string }[] = [
  { value: 'both', label: 'Email + push' },
  { value: 'email', label: 'Email only' },
  { value: 'push', label: 'Push only (after they subscribe)' },
]

export function normalizeAlertChannel(raw: unknown): AlertChannel {
  if (raw === 'email' || raw === 'push') return raw
  return 'both'
}

export function contactWantsEmail(channel: AlertChannel): boolean {
  return channel === 'both' || channel === 'email'
}

export function contactWantsPush(channel: AlertChannel): boolean {
  return channel === 'both' || channel === 'push'
}
