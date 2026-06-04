/**
 * Device-local tactical operator profile + shared emergency contacts.
 * Stored in localStorage; no cloud sync. Schema is versioned by storage key.
 */

export const TACTICAL_PROFILE_STORAGE_KEY = 'tactical_profile_v1'
const MIGRATION_FLAG_KEY = 'tactical_profile_migrated_v1'

import { contactWantsEmail, contactWantsPush, normalizeAlertChannel, type AlertChannel } from './alertChannel'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type TacticalContact = {
  id: string
  name: string
  email: string
  phone: string
  /** How this contact receives alerts when operator dispatches rescue. */
  alert_channel: AlertChannel
}

export type TacticalProfile = {
  display_name: string
  reply_to_email: string
  phone: string
  contacts: TacticalContact[]
  setup_complete: boolean
  created_at: string
  updated_at: string
}

export type TacticalProfileIssue =
  | 'missing_display_name'
  | 'missing_reply_to_email'
  | 'invalid_reply_to_email'
  | 'no_contacts'
  | 'invalid_contact_email'

export type TacticalProfileAssessment = {
  operationalReady: boolean
  issues: TacticalProfileIssue[]
  validContactCount: number
  /** Short operator-facing lines for HUD banners and panels. */
  messages: string[]
}

export const TACTICAL_PROFILE_CHANGED_EVENT = 'tactical-profile-changed'

function nowIso(): string {
  return new Date().toISOString()
}

function newContactId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function createEmptyTacticalProfile(): TacticalProfile {
  const ts = nowIso()
  return {
    display_name: '',
    reply_to_email: '',
    phone: '',
    contacts: [],
    setup_complete: false,
    created_at: ts,
    updated_at: ts,
  }
}

function safeGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  } catch {
    /* private mode / quota */
  }
}

function normalizeContact(raw: unknown): TacticalContact | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const email = typeof o.email === 'string' ? o.email.trim() : ''
  if (!email) return null
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  const phone = typeof o.phone === 'string' ? o.phone.trim() : ''
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : newContactId()
  const alert_channel = normalizeAlertChannel(o.alert_channel ?? o.alertChannel)
  return { id, name, email, phone, alert_channel }
}

function normalizeProfile(raw: unknown): TacticalProfile {
  const base = createEmptyTacticalProfile()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const o = raw as Record<string, unknown>
  const contacts: TacticalContact[] = []
  if (Array.isArray(o.contacts)) {
    for (const item of o.contacts) {
      const c = normalizeContact(item)
      if (c) contacts.push(c)
    }
  }
  const created =
    typeof o.created_at === 'string' && o.created_at.trim() ? o.created_at.trim() : base.created_at
  return {
    display_name: typeof o.display_name === 'string' ? o.display_name.trim() : '',
    reply_to_email: typeof o.reply_to_email === 'string' ? o.reply_to_email.trim() : '',
    phone: typeof o.phone === 'string' ? o.phone.trim() : '',
    contacts,
    setup_complete: o.setup_complete === true,
    created_at: created,
    updated_at:
      typeof o.updated_at === 'string' && o.updated_at.trim() ? o.updated_at.trim() : created,
  }
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

export function assessTacticalProfile(profile: TacticalProfile): TacticalProfileAssessment {
  const issues: TacticalProfileIssue[] = []
  const messages: string[] = []

  if (!profile.display_name.trim()) {
    issues.push('missing_display_name')
    messages.push('Add your display name (shown on SOS, Deadman, and Check-In alerts).')
  }

  const reply = profile.reply_to_email.trim()
  if (!reply) {
    issues.push('missing_reply_to_email')
    messages.push('Add a reply-to email so contacts can reach you.')
  } else if (!isValidEmail(reply)) {
    issues.push('invalid_reply_to_email')
    messages.push('Reply-to email format is invalid.')
  }

  const validContacts = profile.contacts.filter(
    (c) => c.email.trim().length > 0 && isValidEmail(c.email),
  )
  if (profile.contacts.length === 0) {
    issues.push('no_contacts')
    messages.push('Add at least one emergency contact with a valid email.')
  } else if (validContacts.length === 0) {
    issues.push('invalid_contact_email')
    messages.push('Emergency contacts need at least one valid email address.')
  } else if (validContacts.length < profile.contacts.length) {
    issues.push('invalid_contact_email')
    messages.push('One or more emergency contacts have an invalid email — fix or remove them.')
  }

  const operationalReady =
    issues.length === 0 &&
    profile.display_name.trim().length > 0 &&
    isValidEmail(profile.reply_to_email) &&
    validContacts.length > 0

  return {
    operationalReady,
    issues,
    validContactCount: validContacts.length,
    messages,
  }
}

export function loadTacticalProfile(): TacticalProfile {
  const raw = safeGet(TACTICAL_PROFILE_STORAGE_KEY)
  if (!raw) return createEmptyTacticalProfile()
  try {
    return normalizeProfile(JSON.parse(raw))
  } catch {
    return createEmptyTacticalProfile()
  }
}

export function saveTacticalProfile(
  patch: Partial<TacticalProfile> | ((prev: TacticalProfile) => TacticalProfile),
): TacticalProfile {
  const prev = loadTacticalProfile()
  const next =
    typeof patch === 'function'
      ? patch(prev)
      : {
          ...prev,
          ...patch,
          contacts: patch.contacts ?? prev.contacts,
        }
  const normalized = normalizeProfile({
    ...next,
    updated_at: nowIso(),
    created_at: prev.created_at || next.created_at,
  })
  safeSet(TACTICAL_PROFILE_STORAGE_KEY, JSON.stringify(normalized))
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(TACTICAL_PROFILE_CHANGED_EVENT))
    }
  } catch {
    /* ignore */
  }
  return normalized
}

export function addTacticalContact(input: {
  name: string
  email: string
  phone?: string
  alert_channel?: AlertChannel
}): { profile: TacticalProfile; error: string | null } {
  const name = input.name.trim()
  const email = input.email.trim()
  const phone = (input.phone ?? '').trim()
  const alert_channel = normalizeAlertChannel(input.alert_channel)
  if (!email) return { profile: loadTacticalProfile(), error: 'Email is required' }
  if (!isValidEmail(email)) return { profile: loadTacticalProfile(), error: 'Invalid email format' }
  const profile = saveTacticalProfile((prev) => ({
    ...prev,
    contacts: [
      ...prev.contacts,
      { id: newContactId(), name, email, phone, alert_channel },
    ],
  }))
  return { profile, error: null }
}

export function updateTacticalContactAlertChannel(
  id: string,
  alert_channel: AlertChannel,
): TacticalProfile {
  const channel = normalizeAlertChannel(alert_channel)
  return saveTacticalProfile((prev) => ({
    ...prev,
    contacts: prev.contacts.map((c) => (c.id === id ? { ...c, alert_channel: channel } : c)),
  }))
}

export function removeTacticalContact(id: string): TacticalProfile {
  return saveTacticalProfile((prev) => ({
    ...prev,
    contacts: prev.contacts.filter((c) => c.id !== id),
  }))
}

export function markTacticalSetupComplete(complete = true): TacticalProfile {
  return saveTacticalProfile({ setup_complete: complete })
}

/** Contacts formatted for rescue packets (valid emails only). */
export function rescueContactsFromProfile(profile: TacticalProfile): {
  name: string
  email: string
  phone?: string
  alertChannel: AlertChannel
}[] {
  return profile.contacts
    .filter((c) => isValidEmail(c.email))
    .map((c) => ({
      name: c.name.trim() || 'Contact',
      email: c.email.trim(),
      alertChannel: normalizeAlertChannel(c.alert_channel),
      ...(c.phone.trim() ? { phone: c.phone.trim() } : {}),
    }))
}

export { contactWantsEmail, contactWantsPush }

export function operatorMetaFromProfile(
  profile: TacticalProfile,
): { display_name: string; reply_to_email: string; phone?: string } | undefined {
  const display_name = profile.display_name.trim()
  const reply_to_email = profile.reply_to_email.trim()
  if (!display_name && !reply_to_email && !profile.phone.trim()) return undefined
  const meta: { display_name: string; reply_to_email: string; phone?: string } = {
    display_name: display_name || 'Operator',
    reply_to_email,
  }
  if (profile.phone.trim()) meta.phone = profile.phone.trim()
  return meta
}

function parseLegacyLocalContacts(): TacticalContact[] {
  const keys = ['titanium_saved_contacts', 'emergency_contacts_saved']
  for (const key of keys) {
    const raw = safeGet(key)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) continue
      const out: TacticalContact[] = []
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue
        const row = item as Record<string, unknown>
        const email =
          (typeof row.email === 'string' ? row.email : '') ||
          (typeof row.contact_email === 'string' ? row.contact_email : '')
        const name =
          (typeof row.name === 'string' ? row.name : '') ||
          (typeof row.contact_name === 'string' ? row.contact_name : '')
        const phone = typeof row.phone === 'string' ? row.phone : ''
        const c = normalizeContact({ id: newContactId(), name, email, phone })
        if (c) out.push(c)
      }
      if (out.length > 0) return out
    } catch {
      /* try next key */
    }
  }
  return []
}

/**
 * One-time import from legacy localStorage keys on this device only.
 * Does not pull from shared Supabase — contacts must be entered in Preflight/wizard.
 * Never throws; safe to call on boot.
 */
export async function migrateTacticalProfileIfNeeded(): Promise<void> {
  if (safeGet(MIGRATION_FLAG_KEY) === 'done') return
  let profile = loadTacticalProfile()
  let changed = false

  if (profile.contacts.length === 0) {
    const legacy = parseLegacyLocalContacts()
    if (legacy.length > 0) {
      profile = saveTacticalProfile({ contacts: legacy })
      changed = true
    }
  }

  safeSet(MIGRATION_FLAG_KEY, 'done')
  if (changed) {
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(TACTICAL_PROFILE_CHANGED_EVENT))
      }
    } catch {
      /* ignore */
    }
  }
}
