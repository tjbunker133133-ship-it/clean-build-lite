#!/usr/bin/env node
/**
 * Reports which VITE_* keys are set (never prints secret values).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')

function parseEnvFile(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function classifySupabaseKey(key) {
  if (!key) return 'missing'
  if (key.startsWith('eyJ')) return 'jwt (legacy)'
  if (key.startsWith('sb_publishable_')) return 'publishable (recommended)'
  if (key.startsWith('sb_secret_')) return 'secret (do not use in frontend!)'
  return 'other'
}

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_RESCUE_SIGNING_KEY',
  'VITE_RESCUE_EMAIL_URL',
]

if (!existsSync(envPath)) {
  console.error('Missing .env.local — run: npm run env:init')
  process.exit(1)
}

const env = parseEnvFile(readFileSync(envPath, 'utf8'))
let ok = true

console.log('Environment check (.env.local)\n')

for (const name of required) {
  const val = (env[name] ?? '').trim()
  const set = val.length > 0
  if (!set) ok = false
  let extra = ''
  if (name === 'VITE_SUPABASE_ANON_KEY' && set) {
    extra = ` [${classifySupabaseKey(val)}]`
  }
  if (name === 'VITE_RESCUE_EMAIL_URL' && set && !val.includes('/functions/v1/send-rescue-email')) {
    extra = ' [warn: expected send-rescue-email URL]'
  }
  console.log(`  ${set ? 'OK' : 'MISSING'}  ${name}${extra}`)
}

if (env.VITE_SUPABASE_URL && !env.VITE_RESCUE_EMAIL_URL) {
  const ref = env.VITE_SUPABASE_URL.replace(/\/$/, '')
  console.log(`\n  Hint: VITE_RESCUE_EMAIL_URL=${ref}/functions/v1/send-rescue-email`)
}

console.log(ok ? '\nAll required keys present.' : '\nFix missing keys, then restart npm run dev.')

const mapKey = (env.VITE_MAPTILER_KEY ?? '').trim()
console.log(`\n  ${mapKey ? 'OK' : 'MISSING'}  VITE_MAPTILER_KEY (optional — basemap tiles)`)

const vapid = (env.VITE_VAPID_PUBLIC_KEY ?? '').trim()
console.log(`  ${vapid ? 'OK' : 'MISSING'}  VITE_VAPID_PUBLIC_KEY (optional — push alerts)`)

const firms = (env.VITE_FIRMS_MAP_KEY ?? '').trim()
console.log(`  ${firms ? 'OK' : 'MISSING'}  VITE_FIRMS_MAP_KEY (optional — fire overlay)`)

process.exit(ok ? 0 : 1)
