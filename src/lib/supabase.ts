import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local',
    )
  }
  client ??= createClient(supabaseUrl, supabaseAnonKey)
  return client
}

/** Null when env vars are missing — app can still boot for map/GPS/HUD-only dev. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? getSupabase()
  : null

if (import.meta.env.DEV && !isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — contacts DB disabled until .env.local is restored',
  )
}
