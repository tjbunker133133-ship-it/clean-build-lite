import { createClient } from '@supabase/supabase-js'

function sysTraceSuccess(payload: Record<string, unknown>): void {
  if (import.meta.env.DEV) console.log('[SYSTEM TRACE]', payload)
}

function sysTraceFailure(payload: Record<string, unknown>): void {
  console.warn('[SYSTEM TRACE]', payload)
}

if (import.meta.env.PROD && (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY)) {
  console.error('CRITICAL BUILD ERROR: Production environment variables (VITE_SUPABASE_URL/ANON_KEY) are missing. Backend features will fail.');
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export const hasSupabaseUrl = isNonEmptyString(supabaseUrl)
export const hasSupabaseAnon = isNonEmptyString(supabaseAnonKey)

export const supabaseConfigValid = hasSupabaseUrl && hasSupabaseAnon

/** Hostname only (for deploy debugging). Never logs keys or full URLs. */
export function getSupabaseUrlHostnameForDiagnostics(): string | null {
  if (!hasSupabaseUrl) return null
  try {
    return new URL(String(supabaseUrl).trim()).hostname
  } catch {
    return 'unparseable_url'
  }
}

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

export type BackendFailureReason =
  | 'missing_supabase_url'
  | 'missing_supabase_anon'
  | 'missing_supabase_both'
  | null

export const backendFailureReason: BackendFailureReason =
  supabaseEnvReadiness === 'missing_url'
    ? 'missing_supabase_url'
    : supabaseEnvReadiness === 'missing_anon'
      ? 'missing_supabase_anon'
      : supabaseEnvReadiness === 'missing_both'
        ? 'missing_supabase_both'
        : null

if (!supabaseConfigValid) {
  console.error('[BACKEND] initialization blocked', {
    hasSupabaseUrl,
    hasSupabaseAnon,
    envReadiness: supabaseEnvReadiness,
    backendFailureReason,
  })
  sysTraceFailure({
    step: 'supabase_init_validation',
    success: false,
    data: {
      hasSupabaseUrl,
      hasSupabaseAnon,
      envReadiness: supabaseEnvReadiness,
    },
    error: backendFailureReason,
  })
} else {
  sysTraceSuccess({
    step: 'supabase_init_validation',
    success: true,
    data: { envReadiness: supabaseEnvReadiness },
    error: null,
  })
}

let supabaseClientInitError: string | null = null
let supabaseClientInternal: any = null

if (supabaseConfigValid) {
  try {
    supabaseClientInternal = createClient(supabaseUrl, supabaseAnonKey)
  } catch (err) {
    supabaseClientInternal = null
    supabaseClientInitError = (err as Error)?.message ?? 'unknown_create_client_error'
  }
}

export const supabase = supabaseClientInternal
export const supabaseInitialized = supabase != null
export const backendReady = supabaseConfigValid && supabaseInitialized

/** 
 * Derived connectivity truth. 
 * Requires valid config, radio network, and successful recent reachability probe.
 * Used to prevent silent queue growth during partial network failures.
 */
export function isBackendOperative(): boolean {
  return backendReady && navigator.onLine && lastReachable === true
}

if (import.meta.env.DEV) {
  console.log('[SUPABASE INIT]', {
    urlExists: hasSupabaseUrl,
    keyExists: hasSupabaseAnon,
    clientCreated: supabaseInitialized,
    error: supabaseClientInitError,
  })
} else if (supabaseClientInitError || (supabaseConfigValid && !supabaseInitialized)) {
  console.warn('[SUPABASE INIT]', {
    urlExists: hasSupabaseUrl,
    keyExists: hasSupabaseAnon,
    clientCreated: supabaseInitialized,
    error: supabaseClientInitError,
  })
}

export type BackendReadySource = {
  envValid: boolean
  supabaseInitialized: boolean
  supabasePingSuccess: boolean | null
}

export function getBackendReadySource(): BackendReadySource {
  return {
    envValid: supabaseConfigValid,
    supabaseInitialized,
    supabasePingSuccess: lastReachable,
  }
}

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
    if (lastReachable) {
      sysTraceSuccess({
        step: 'supabase_reachability_probe',
        success: true,
        data: { status: response.status },
        error: null,
      })
    } else {
      sysTraceFailure({
        step: 'supabase_reachability_probe',
        success: false,
        data: { status: response.status },
        error: 'non_positive_status',
      })
    }
    return lastReachable
  } catch {
    lastReachabilityAt = Date.now()
    lastReachable = false
    sysTraceFailure({
      step: 'supabase_reachability_probe',
      success: false,
      data: null,
      error: 'network_or_cors_failure',
    })
    return false
  }
}

export function getSupabaseDiagnostics() {
  const backendReadySource = getBackendReadySource()
  return {
    backendReady,
    backendReadySource,
    supabaseClientInitError,
    hasSupabaseUrl,
    hasSupabaseAnon,
    supabaseUrlHost: getSupabaseUrlHostnameForDiagnostics(),
    backendConfigured: supabaseConfigValid,
    envReadiness: supabaseEnvReadiness,
    reachable: lastReachable,
    lastReachabilityAt,
    buildTimeEnvMode: import.meta.env.MODE,
  }
}
