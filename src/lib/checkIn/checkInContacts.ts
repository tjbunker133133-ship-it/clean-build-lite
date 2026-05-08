/**
 * Check-In roster — separate from `emergencyContacts` / SOS (no shared storage keys or tables).
 * Optional Supabase table `check_in_contacts` when configured; otherwise local-only.
 */
import { supabase } from '../supabase'

const LOCAL_CHECKIN_CONTACTS_KEY = 'hud_checkin_contacts_v1'

export type CheckInContact = {
  id: string
  contact_name: string
  email: string
  priority: number
  created_at: string
}

export type CheckInContactInput = {
  contact_name: string
  email: string
  priority?: number
}

export type CheckInContactsResult<T> = { data: T; error: Error | null }

const SELECT_COLS = 'id, contact_name, email, priority, created_at'

function readLocal(): CheckInContact[] {
  try {
    const raw = localStorage.getItem(LOCAL_CHECKIN_CONTACTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as CheckInContact[]
  } catch {
    return []
  }
}

function writeLocal(rows: CheckInContact[]) {
  try {
    localStorage.setItem(LOCAL_CHECKIN_CONTACTS_KEY, JSON.stringify(rows))
  } catch (e) {
    console.error('[CheckInContacts] local persist failed', e)
  }
}

export async function fetchCheckInContacts(): Promise<CheckInContactsResult<CheckInContact[]>> {
  if (!supabase) {
    const data = readLocal().sort((a, b) => {
      const pa = a.priority ?? 99
      const pb = b.priority ?? 99
      if (pa !== pb) return pa - pb
      return a.created_at.localeCompare(b.created_at)
    })
    return { data, error: null }
  }
  try {
    const { data, error } = await supabase
      .from('check_in_contacts')
      .select(SELECT_COLS)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) {
      const fallback = readLocal()
      return {
        data: fallback,
        error: fallback.length ? null : new Error(error.message),
      }
    }
    return { data: (data ?? []) as CheckInContact[], error: null }
  } catch (e) {
    const fallback = readLocal()
    if (fallback.length) return { data: fallback, error: null }
    return {
      data: [],
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}

export async function createCheckInContact(
  input: CheckInContactInput,
): Promise<CheckInContactsResult<CheckInContact | null>> {
  const email = input.email.trim().toLowerCase()
  const name = input.contact_name.trim().slice(0, 80)
  if (!email || !name) {
    return { data: null, error: new Error('Name and email are required') }
  }

  if (!supabase) {
    const rows = readLocal()
    const row: CheckInContact = {
      id: `local_${crypto.randomUUID()}`,
      contact_name: name,
      email,
      priority: input.priority ?? (rows.length === 0 ? 1 : rows.length + 1),
      created_at: new Date().toISOString(),
    }
    const next = [...rows, row].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    writeLocal(next)
    return { data: row, error: null }
  }

  try {
    const { data, error } = await supabase
      .from('check_in_contacts')
      .insert({
        contact_name: name,
        email,
        priority: input.priority ?? 1,
      })
      .select(SELECT_COLS)
      .single()
    if (error) {
      const row: CheckInContact = {
        id: `local_${crypto.randomUUID()}`,
        contact_name: name,
        email,
        priority: input.priority ?? 1,
        created_at: new Date().toISOString(),
      }
      const rows = readLocal()
      writeLocal([...rows, row])
      return { data: row, error: null }
    }
    return { data: data as CheckInContact, error: null }
  } catch (e) {
    const row: CheckInContact = {
      id: `local_${crypto.randomUUID()}`,
      contact_name: name,
      email,
      priority: input.priority ?? 1,
      created_at: new Date().toISOString(),
    }
    const rows = readLocal()
    writeLocal([...rows, row])
    return { data: row, error: null }
  }
}

export async function deleteCheckInContact(id: string): Promise<{ error: Error | null }> {
  if (!supabase) {
    const rows = readLocal()
    const next = rows.filter((r) => r.id !== id)
    if (next.length === rows.length) return { error: new Error('Contact not found') }
    writeLocal(next)
    return { error: null }
  }
  try {
    const { error } = await supabase.from('check_in_contacts').delete().eq('id', id)
    if (error) {
      const rows = readLocal().filter((r) => r.id !== id)
      writeLocal(rows)
      return { error: null }
    }
    return { error: null }
  } catch {
    const rows = readLocal().filter((r) => r.id !== id)
    writeLocal(rows)
    return { error: null }
  }
}
