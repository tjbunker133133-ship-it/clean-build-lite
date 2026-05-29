import { resolveRapidEndpointMeta } from '../lib/rescue/resolveRapidEndpoint'

export type EnvAudit = {
  timestamp: string
  supabase: {
    urlType: string
    urlPresent: boolean
    anonKeyPresent: boolean
  }
  rescue: {
    signingKeyPresent: boolean
    rescueEmailUrlPresent: boolean
    legacyEmailEndpointKeyPresent: boolean
    endpointResolved: boolean
    endpointSource: string
  }
  maps: {
    maptilerPresent: boolean
  }
  mode: string | undefined
  dev: boolean
}

/** Build-time Vite env presence (no secret values). */
export function buildEnvAudit(): EnvAudit {
  const env = import.meta.env
  const meta = resolveRapidEndpointMeta()
  return {
    timestamp: new Date().toISOString(),
    supabase: {
      urlType: typeof env.VITE_SUPABASE_URL,
      urlPresent: Boolean(String(env.VITE_SUPABASE_URL ?? '').trim()),
      anonKeyPresent: Boolean(String(env.VITE_SUPABASE_ANON_KEY ?? '').trim()),
    },
    rescue: {
      signingKeyPresent: Boolean(String(env.VITE_RESCUE_SIGNING_KEY ?? '').trim()),
      rescueEmailUrlPresent: Boolean(String(env.VITE_RESCUE_EMAIL_URL ?? '').trim()),
      legacyEmailEndpointKeyPresent: Boolean(String(env.VITE_EMAIL_ENDPOINT ?? '').trim()),
      endpointResolved: meta.url.length > 0,
      endpointSource: meta.source,
    },
    maps: {
      maptilerPresent: Boolean(String(env.VITE_MAPTILER_KEY ?? '').trim()),
    },
    mode: env.MODE,
    dev: env.DEV,
  }
}

let envAuditLogged = false

/** DEV: log env audit once + expose `window.__hudEnvAudit()`. */
export function logEnvAuditOnce(): void {
  if (!import.meta.env.DEV || envAuditLogged) return
  envAuditLogged = true

  if (typeof window !== 'undefined') {
    ;(window as Window & { __hudEnvAudit?: () => EnvAudit }).__hudEnvAudit = () =>
      buildEnvAudit()
  }
}
