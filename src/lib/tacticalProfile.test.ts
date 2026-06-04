import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TACTICAL_PROFILE_STORAGE_KEY,
  addTacticalContact,
  assessTacticalProfile,
  createEmptyTacticalProfile,
  isValidEmail,
  loadTacticalProfile,
  migrateTacticalProfileIfNeeded,
  rescueContactsFromProfile,
  saveTacticalProfile,
} from './tacticalProfile'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
  })
})

describe('assessTacticalProfile', () => {
  it('requires display name, reply-to email, and at least one valid contact', () => {
    const empty = assessTacticalProfile(createEmptyTacticalProfile())
    expect(empty.operationalReady).toBe(false)
    expect(empty.issues).toContain('missing_display_name')
    expect(empty.issues).toContain('missing_reply_to_email')
    expect(empty.issues).toContain('no_contacts')

    const ready = assessTacticalProfile({
      ...createEmptyTacticalProfile(),
      display_name: 'Alpha',
      reply_to_email: 'alpha@example.com',
      contacts: [
        { id: '1', name: 'Bravo', email: 'bravo@example.com', phone: '', alert_channel: 'email' },
      ],
    })
    expect(ready.operationalReady).toBe(true)
    expect(ready.validContactCount).toBe(1)
  })

  it('flags invalid contact emails when list is non-empty', () => {
    const bad = assessTacticalProfile({
      ...createEmptyTacticalProfile(),
      display_name: 'Alpha',
      reply_to_email: 'alpha@example.com',
      contacts: [{ id: '1', name: 'X', email: 'not-an-email', phone: '', alert_channel: 'email' }],
    })
    expect(bad.operationalReady).toBe(false)
    expect(bad.issues).toContain('invalid_contact_email')
  })
})

describe('persistence', () => {
  it('round-trips profile through localStorage', () => {
    saveTacticalProfile({
      display_name: 'Field Op',
      reply_to_email: 'op@example.com',
      setup_complete: true,
    })
    const loaded = loadTacticalProfile()
    expect(loaded.display_name).toBe('Field Op')
    expect(loaded.reply_to_email).toBe('op@example.com')
    expect(loaded.setup_complete).toBe(true)
    expect(localStorage.getItem(TACTICAL_PROFILE_STORAGE_KEY)).toBeTruthy()
  })

  it('addTacticalContact validates email', () => {
    const { error } = addTacticalContact({ name: 'C', email: 'bad' })
    expect(error).toBeTruthy()
    expect(loadTacticalProfile().contacts).toHaveLength(0)
  })
})

describe('rescueContactsFromProfile', () => {
  it('maps valid contacts and optional phone', () => {
    const profile = {
      ...createEmptyTacticalProfile(),
      contacts: [
        { id: '1', name: 'A', email: 'a@x.com', phone: '+15551212', alert_channel: 'email' as const },
        { id: '2', name: '', email: 'invalid', phone: '', alert_channel: 'both' as const },
      ],
    }
    expect(rescueContactsFromProfile(profile)).toEqual([
      { name: 'A', email: 'a@x.com', phone: '+15551212', alertChannel: 'email' },
    ])
  })
})

describe('isValidEmail', () => {
  it('accepts common addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
    expect(isValidEmail('bad')).toBe(false)
  })
})

describe('migrateTacticalProfileIfNeeded', () => {
  it('imports legacy local contacts only — never shared Supabase rows', async () => {
    localStorage.setItem(
      'emergency_contacts_saved',
      JSON.stringify([{ name: 'Legacy', email: 'legacy@example.com' }]),
    )
    await migrateTacticalProfileIfNeeded()
    expect(loadTacticalProfile().contacts).toEqual([
      expect.objectContaining({ name: 'Legacy', email: 'legacy@example.com' }),
    ])
  })
})
