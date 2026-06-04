import { isValidAlertWatchToken, normalizeContactEmail } from './alertWatchToken'
import { parseAlertWatchLocation } from './alertSubscribeUrl'

const STORAGE_KEY = 'hud_pending_alert_subscribe_v1'

export type PendingAlertSubscribe = {
  watchToken: string
  contactEmail: string
}

export function captureAlertWatchFromLocation(search = ''): PendingAlertSubscribe | null {
  const { watchToken, contactEmail } = parseAlertWatchLocation(
    search || (typeof window !== 'undefined' ? window.location.search : ''),
  )
  if (!watchToken || !isValidAlertWatchToken(watchToken)) return null
  const pending: PendingAlertSubscribe = {
    watchToken,
    contactEmail: contactEmail ? normalizeContactEmail(contactEmail) : '',
  }
  savePendingAlertSubscribe(pending)
  return pending
}

export function savePendingAlertSubscribe(pending: PendingAlertSubscribe | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (!pending) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
  } catch {
    /* ignore */
  }
}

export function readPendingAlertSubscribe(): PendingAlertSubscribe | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingAlertSubscribe
    if (!parsed?.watchToken || !isValidAlertWatchToken(parsed.watchToken)) return null
    return {
      watchToken: parsed.watchToken,
      contactEmail: parsed.contactEmail ? normalizeContactEmail(parsed.contactEmail) : '',
    }
  } catch {
    return null
  }
}

export function clearPendingAlertSubscribe(): void {
  savePendingAlertSubscribe(null)
}

export function isWizardCompletedPersisted(): boolean {
  try {
    return localStorage.getItem('wizardCompleted') === 'true'
  } catch {
    return false
  }
}
