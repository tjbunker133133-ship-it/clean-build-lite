/**
 * Operator-scoped token linking push subscriptions to one field device profile.
 * Stored device-locally; included in signed rescue packets when present.
 */

const STORAGE_KEY = 'hud_alert_watch_token_v1'
const TOKEN_RE = /^[a-z0-9]{16,64}$/i

export function isValidAlertWatchToken(token: string): boolean {
  return TOKEN_RE.test(token.trim())
}

export function loadAlertWatchToken(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)?.trim() ?? ''
    return isValidAlertWatchToken(raw) ? raw : null
  } catch {
    return null
  }
}

function generateAlertWatchToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 32)
  }
  let token = ''
  while (token.length < 24) {
    token += Math.random().toString(36).slice(2)
  }
  return token.slice(0, 32)
}

export function loadOrCreateAlertWatchToken(): string {
  const existing = loadAlertWatchToken()
  if (existing) return existing
  const token = generateAlertWatchToken()
  if (!isValidAlertWatchToken(token)) {
    return generateAlertWatchToken()
  }
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    /* quota */
  }
  return token
}

export function normalizeContactEmail(email: string): string {
  return email.trim().toLowerCase()
}
