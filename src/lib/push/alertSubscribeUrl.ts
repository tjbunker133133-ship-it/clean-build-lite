import { normalizeContactEmail } from './alertWatchToken'

export function buildAlertSubscribeUrl(watchToken: string, contactEmail?: string): string {
  if (typeof window === 'undefined') return '/'
  const url = new URL(window.location.origin)
  url.pathname = '/'
  url.searchParams.set('alertWatch', watchToken.trim())
  if (contactEmail?.trim()) {
    url.searchParams.set('email', normalizeContactEmail(contactEmail))
  }
  return url.toString()
}

export function buildAlertInviteText(args: {
  operatorName: string
  watchToken: string
  contactEmail?: string
}): string {
  const link = buildAlertSubscribeUrl(args.watchToken, args.contactEmail)
  const who = args.operatorName.trim() || 'Your teammate'
  return [
    `${who} invited you to Signal One HUD push alerts.`,
    '',
    'Install/open the HUD, allow notifications, and confirm your email.',
    `Link: ${link}`,
    '',
    'Push replaces SMS for now — email alerts still send when configured.',
  ].join('\n')
}

export function parseAlertWatchLocation(search: string): {
  watchToken: string | null
  contactEmail: string | null
} {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
  const watchToken = params.get('alertWatch')?.trim() ?? null
  const contactEmail = params.get('email')?.trim().toLowerCase() ?? null
  return { watchToken, contactEmail }
}
