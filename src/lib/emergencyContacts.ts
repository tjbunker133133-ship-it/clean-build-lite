import { supabase } from './supabase'

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

export async function fetchEmergencyContacts(
  operatorId?: string | null,
): Promise<ContactsResult<EmergencyContact[]>> {
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
      return { data: [], error: new Error(error.message) }
    }
    return { data: (data ?? []) as EmergencyContact[], error: null }
  } catch (e) {
    return {
      data: [],
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}

export async function createEmergencyContact(
  input: EmergencyContactInput,
): Promise<ContactsResult<EmergencyContact | null>> {
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
      return { data: null, error: new Error(error.message) }
    }
    return { data: data as EmergencyContact, error: null }
  } catch (e) {
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
      return { data: null, error: new Error(error.message) }
    }
    return { data: data as EmergencyContact, error: null }
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}

export async function deleteEmergencyContact(
  id: string,
): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase
      .from('emergency_contacts')
      .delete()
      .eq('id', id)
    if (error) {
      return { error: new Error(error.message) }
    }
    return { error: null }
  } catch (e) {
    return {
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}
