import { supabase } from './supabase'

/** Offline / no-Supabase deployments: same shape as DB rows, stored locally. */
const LOCAL_CONTACTS_KEY = 'hud_emergency_contacts_shadow_v1'

export type EmergencyContact = {
  id: string
  operator_id: string | null
  contact_name: string
  email: string
  phone?: string | null
  relationship: string | null
  priority: number
  created_at: string
}

export type EmergencyContactInput = {
  operator_id?: string | null
  contact_name: string
  email: string
  phone?: string | null
  relationship?: string | null
  priority?: number
}

export type ContactsResult<T> = { data: T; error: Error | null }

const SELECT_COLS =
  'id, operator_id, contact_name, email, relationship, priority, created_at'

function sysTraceContacts(payload: {
  step: string
  success: boolean
  data: unknown
  error: string | null
}): void {
  if (!payload.success) {
    console.warn('[SYSTEM TRACE]', payload)
    return
  }
  if (import.meta.env.DEV) console.log('[SYSTEM TRACE]', payload)
}

function readLocalContacts(): EmergencyContact[] {
  try {
    const raw = localStorage.getItem(LOCAL_CONTACTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as EmergencyContact[]
  } catch {
    return []
  }
}

function writeLocalContacts(rows: EmergencyContact[]) {
  try {
    localStorage.setItem(LOCAL_CONTACTS_KEY, JSON.stringify(rows))
  } catch (e) {
    console.error('[EmergencyContacts] local persist failed', e)
  }
}

/** `supabase` client exists → remote table; otherwise local shadow file. */
export function getContactsStorageMode(): 'supabase' | 'local' {
  return supabase ? 'supabase' : 'local'
}

export function countLocalEmergencyContacts(): number {
  return readLocalContacts().length
}

export async function fetchEmergencyContacts(
  operatorId?: string | null,
): Promise<ContactsResult<EmergencyContact[]>> {
  if (!supabase) {
    const data = readLocalContacts().filter((c) => {
      if (!operatorId) return true
      return c.operator_id === operatorId
    })
    sysTraceContacts( {
      step: 'contacts_fetch_precheck',
      success: true,
      data: { operatorId: operatorId ?? null, mode: 'local_shadow', count: data.length },
      error: null,
    })
    return { data, error: null }
  }
  try {
    let query = supabase
      .from('emergency_contacts')
      .select(SELECT_COLS)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
    if (operatorId) {
      query = query.eq('operator_id', operatorId)
    }
    const { data, error } = await query
    if (error) {
      sysTraceContacts( {
        step: 'contacts_fetch_query',
        success: false,
        data: { operatorId: operatorId ?? null },
        error: error.message,
      })
      return { data: [], error: new Error(error.message) }
    }
    sysTraceContacts( {
      step: 'contacts_fetch_query',
      success: true,
      data: { count: (data ?? []).length, operatorId: operatorId ?? null },
      error: null,
    })
    return { data: (data ?? []) as EmergencyContact[], error: null }
  } catch (e) {
    console.error('[EmergencyContacts] fetch failed', e)
    return {
      data: [],
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}

export async function createEmergencyContact(
  input: EmergencyContactInput,
): Promise<ContactsResult<EmergencyContact | null>> {
  if (!supabase) {
    const rows = readLocalContacts()
    const row: EmergencyContact = {
      id: `local_${crypto.randomUUID()}`,
      operator_id: input.operator_id ?? null,
      contact_name: input.contact_name,
      email: input.email,
      phone: input.phone ?? null,
      relationship: input.relationship ?? null,
      priority: input.priority ?? (rows.length === 0 ? 1 : 2),
      created_at: new Date().toISOString(),
    }
    const next = [...rows, row].sort((a, b) => {
      const pa = a.priority ?? 99
      const pb = b.priority ?? 99
      if (pa !== pb) return pa - pb
      return a.created_at.localeCompare(b.created_at)
    })
    writeLocalContacts(next)
    sysTraceContacts( {
      step: 'contacts_create_precheck',
      success: true,
      data: { email: input.email, mode: 'local_shadow', id: row.id },
      error: null,
    })
    return { data: row, error: null }
  }
  try {
    const { data, error } = await supabase
      .from('emergency_contacts')
      .insert({
        operator_id: input.operator_id ?? null,
        contact_name: input.contact_name,
        email: input.email,
        relationship: input.relationship ?? null,
        priority: input.priority ?? 1,
      })
      .select(SELECT_COLS)
      .single()
    if (error) {
      sysTraceContacts( {
        step: 'contacts_create_query',
        success: false,
        data: { email: input.email },
        error: error.message,
      })
      return { data: null, error: new Error(error.message) }
    }
    sysTraceContacts( {
      step: 'contacts_create_query',
      success: true,
      data: { id: (data as EmergencyContact).id, email: input.email },
      error: null,
    })
    return { data: data as EmergencyContact, error: null }
  } catch (e) {
    console.error('[EmergencyContacts] create failed', e)
    return {
      data: null,
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}

export async function updateEmergencyContact(
  id: string,
  input: EmergencyContactInput,
): Promise<ContactsResult<EmergencyContact | null>> {
  if (!supabase) {
    const rows = readLocalContacts()
    const idx = rows.findIndex((r) => r.id === id)
    if (idx < 0) {
      return { data: null, error: new Error('Contact not found (local roster)') }
    }
    const prev = rows[idx]
    const row: EmergencyContact = {
      ...prev,
      contact_name: input.contact_name,
      email: input.email,
      phone: input.phone ?? prev.phone ?? null,
      relationship: input.relationship ?? null,
      priority: input.priority ?? prev.priority,
    }
    const next = [...rows.slice(0, idx), row, ...rows.slice(idx + 1)]
    writeLocalContacts(next)
    sysTraceContacts( {
      step: 'contacts_update_precheck',
      success: true,
      data: { id, mode: 'local_shadow' },
      error: null,
    })
    return { data: row, error: null }
  }
  try {
    const { data, error } = await supabase
      .from('emergency_contacts')
      .update({
        contact_name: input.contact_name,
        email: input.email,
        relationship: input.relationship ?? null,
      })
      .eq('id', id)
      .select(SELECT_COLS)
      .single()
    if (error) {
      sysTraceContacts( {
        step: 'contacts_update_query',
        success: false,
        data: { id },
        error: error.message,
      })
      return { data: null, error: new Error(error.message) }
    }
    sysTraceContacts( {
      step: 'contacts_update_query',
      success: true,
      data: { id },
      error: null,
    })
    return { data: data as EmergencyContact, error: null }
  } catch (e) {
    console.error('[EmergencyContacts] update failed', e)
    return {
      data: null,
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}

export async function deleteEmergencyContact(
  id: string,
): Promise<{ error: Error | null }> {
  if (!supabase) {
    const rows = readLocalContacts()
    const next = rows.filter((r) => r.id !== id)
    if (next.length === rows.length) {
      return { error: new Error('Contact not found (local roster)') }
    }
    writeLocalContacts(next)
    sysTraceContacts( {
      step: 'contacts_delete_precheck',
      success: true,
      data: { id, mode: 'local_shadow' },
      error: null,
    })
    return { error: null }
  }
  try {
    const { error } = await supabase
      .from('emergency_contacts')
      .delete()
      .eq('id', id)
    if (error) {
      sysTraceContacts( {
        step: 'contacts_delete_query',
        success: false,
        data: { id },
        error: error.message,
      })
      return { error: new Error(error.message) }
    }
    sysTraceContacts( {
      step: 'contacts_delete_query',
      success: true,
      data: { id },
      error: null,
    })
    return { error: null }
  } catch (e) {
    console.error('[EmergencyContacts] delete failed', e)
    return {
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}
