export const SEND_RESCUE_PUSH_PATH = '/functions/v1/send-rescue-push'
export const REGISTER_ALERT_PUSH_PATH = '/functions/v1/register-alert-push'

function readViteEnv(name: string): string {
  return (
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name] ?? ''
  ).trim()
}

export function deriveSupabaseFunctionsBase(): string {
  const url = readViteEnv('VITE_SUPABASE_URL').replace(/\/+$/, '')
  return url ? `${url}/functions/v1` : ''
}

export function resolveRescuePushEndpoint(): string {
  const explicit = readViteEnv('VITE_RESCUE_PUSH_URL')
  if (explicit) return explicit
  const base = deriveSupabaseFunctionsBase()
  return base ? `${base}/send-rescue-push` : ''
}

export function resolveRegisterAlertPushEndpoint(): string {
  const explicit = readViteEnv('VITE_REGISTER_ALERT_PUSH_URL')
  if (explicit) return explicit
  const base = deriveSupabaseFunctionsBase()
  return base ? `${base}/register-alert-push` : ''
}

export function readVapidPublicKey(): string {
  return readViteEnv('VITE_VAPID_PUBLIC_KEY')
}

export function isWebPushConfigured(): boolean {
  return Boolean(readVapidPublicKey() && resolveRescuePushEndpoint())
}
