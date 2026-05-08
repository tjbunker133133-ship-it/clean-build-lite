import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export const supabaseConfigValid =
  isNonEmptyString(supabaseUrl) && isNonEmptyString(supabaseAnonKey)

export const hasSupabaseUrl = isNonEmptyString(supabaseUrl)
export const hasSupabaseAnon = isNonEmptyString(supabaseAnonKey)

export type SupabaseEnvReadiness =
  | 'ready'
  | 'missing_url'
  | 'missing_anon'
  | 'missing_both'

export const supabaseEnvReadiness: SupabaseEnvReadiness = hasSupabaseUrl
  ? hasSupabaseAnon
    ? 'ready'
    : 'missing_anon'
  : hasSupabaseAnon
    ? 'missing_url'
    : 'missing_both'

if (!supabaseConfigValid) {
  console.warn('[SUPABASE] missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY; backend contact features disabled')
}

export const supabase = supabaseConfigValid
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

let lastReachabilityAt: number | null = null
let lastReachable: boolean | null = null

export async function probeSupabaseReachability(): Promise<boolean> {
  if (!supabaseConfigValid || !hasSupabaseUrl || !hasSupabaseAnon) {
    lastReachabilityAt = Date.now()
    lastReachable = false
    return false
  }
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    })
    lastReachabilityAt = Date.now()
    // Any HTTP response confirms origin reachability/auth pipeline.
    lastReachable = response.status > 0
    return lastReachable
  } catch {
    lastReachabilityAt = Date.now()
    lastReachable = false
    return false
  }
}

export function getSupabaseDiagnostics() {
  return {
    hasSupabaseUrl,
    hasSupabaseAnon,
    backendConfigured: supabaseConfigValid,
    envReadiness: supabaseEnvReadiness,
    reachable: lastReachable,
    lastReachabilityAt,
  }
}
