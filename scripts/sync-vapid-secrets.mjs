#!/usr/bin/env node
/**
 * Push VAPID keys from .env.local → Supabase Edge Function secrets.
 * Prerequisite: npx supabase login
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')
const PROJECT_REF = 'nlrwmtzphoazktmseadb'

/** Pass token via env when `supabase login` is unavailable in CI/automation. */
function supabaseEnv() {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (!token) return {}
  return { SUPABASE_ACCESS_TOKEN: token }
}

function parseEnvKey(text, keyName) {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    if (t.slice(0, i).trim() !== keyName) continue
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    return val
  }
  return ''
}

if (!existsSync(envPath)) {
  console.error('Missing .env.local — run: npm run env:generate-vapid')
  process.exit(1)
}

const raw = readFileSync(envPath, 'utf8')
const pub = parseEnvKey(raw, 'VITE_VAPID_PUBLIC_KEY')
const priv = parseEnvKey(raw, 'VAPID_PRIVATE_KEY')

if (!pub || pub.length < 20) {
  console.error('VITE_VAPID_PUBLIC_KEY missing — run: npm run env:generate-vapid and add to .env.local')
  process.exit(1)
}
if (!priv || priv.length < 20) {
  console.error('VAPID_PRIVATE_KEY missing in .env.local (server only, from env:generate-vapid)')
  process.exit(1)
}

for (const [name, value] of [
  ['VAPID_PUBLIC_KEY', pub],
  ['VAPID_PRIVATE_KEY', priv],
  ['VAPID_SUBJECT', parseEnvKey(raw, 'VAPID_SUBJECT') || 'mailto:signalonehud@gmail.com'],
]) {
  const result = spawnSync(
    'npx',
    ['supabase', 'secrets', 'set', `${name}=${value}`, '--project-ref', PROJECT_REF],
    { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...supabaseEnv() } },
  )
  if (result.status !== 0) {
    console.error(
      `Failed to set ${name}. Run: npx supabase login  OR  set SUPABASE_ACCESS_TOKEN (dashboard → Account → Access Tokens)`,
    )
    process.exit(result.status ?? 1)
  }
  console.log(`${name} synced to Supabase.`)
}

console.log('Push secrets ready. Deploy functions: npx supabase functions deploy register-alert-push send-rescue-push --project-ref', PROJECT_REF)
