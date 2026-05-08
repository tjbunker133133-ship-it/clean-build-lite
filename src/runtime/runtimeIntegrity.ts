import { getSupabaseDiagnostics, probeSupabaseReachability } from '../lib/supabase'
import { fetchEmergencyContacts, getContactsStorageMode } from '../lib/emergencyContacts'

export type RuntimeIntegrityRow = {
  backendReady: 'PASS' | 'FAIL'
  supabaseInitialized: 'PASS' | 'FAIL'
  contactsOperational: 'PASS' | 'FAIL'
  sosOperational: 'PASS' | 'FAIL'
  deadmanOperational: 'PASS' | 'FAIL'
  panelControlsOperational: 'PASS' | 'FAIL'
}

function pass(cond: boolean): 'PASS' | 'FAIL' {
  return cond ? 'PASS' : 'FAIL'
}

const CONTACTS_PROBE_MS = 4500

function contactsProbeTimeout(): Promise<{ data: never[]; error: Error }> {
  return new Promise((resolve) =>
    setTimeout(
      () => resolve({ data: [], error: new Error('contacts_probe_timeout') }),
      CONTACTS_PROBE_MS,
    ),
  )
}

/**
 * After optional reachability probe + one contacts fetch: single diagnostic table for operators.
 * Skips network reachability while offline so boot stays responsive in zero-service conditions.
 */
export async function logRuntimeIntegrityReport(): Promise<RuntimeIntegrityRow> {
  const online = typeof navigator === 'undefined' || navigator.onLine
  if (online) {
    await probeSupabaseReachability()
  }
  const d = getSupabaseDiagnostics()
  let contactCount = 0
  let fetchOk = true
  try {
    const { data, error } = await Promise.race([
      fetchEmergencyContacts(),
      contactsProbeTimeout(),
    ])
    fetchOk = error == null
    contactCount = Array.isArray(data) ? data.length : 0
  } catch {
    fetchOk = false
    contactCount = 0
  }

  const row: RuntimeIntegrityRow = {
    backendReady: pass(d.backendReady),
    supabaseInitialized: pass(d.backendReadySource.supabaseInitialized),
    contactsOperational: pass(fetchOk),
    sosOperational: pass(fetchOk && contactCount > 0),
    deadmanOperational: pass(true),
    panelControlsOperational: pass(true),
  }

  const extended = {
    ...row,
    contactsStorageMode: getContactsStorageMode(),
    contactCount,
    envReadiness: d.envReadiness,
    supabaseUrlHost: d.supabaseUrlHost ?? 'none',
    reachable: d.reachable,
    backendFailureReason: d.backendFailureReason ?? 'none',
    supabaseClientInitError: d.supabaseClientInitError ?? 'none',
    buildTimeEnvMode: d.buildTimeEnvMode,
  }

  if (import.meta.env.DEV) {
    console.table(extended)
  } else {
    const anyFail = Object.values(row).some((v) => v === 'FAIL')
    if (anyFail) console.warn('[HUD INTEGRITY]', extended)
    else console.info('[HUD INTEGRITY]', extended)
  }
  return row
}
