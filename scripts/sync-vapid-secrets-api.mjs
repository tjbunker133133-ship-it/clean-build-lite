#!/usr/bin/env node
/**
 * Set VAPID secrets via Supabase Management API (fallback when CLI TransportError).
 * Requires SUPABASE_ACCESS_TOKEN in env (or run via scripts/sync-vapid-secrets.ps1).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')
const PROJECT_REF = 'nlrwmtzphoazktmseadb'

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

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN required. Run: powershell -File scripts/sync-vapid-secrets.ps1')
  process.exit(1)
}

if (!existsSync(envPath)) {
  console.error('Missing .env.local')
  process.exit(1)
}

const raw = readFileSync(envPath, 'utf8')
const secrets = [
  { name: 'VAPID_PUBLIC_KEY', value: parseEnvKey(raw, 'VITE_VAPID_PUBLIC_KEY') },
  { name: 'VAPID_PRIVATE_KEY', value: parseEnvKey(raw, 'VAPID_PRIVATE_KEY') },
  { name: 'VAPID_SUBJECT', value: parseEnvKey(raw, 'VAPID_SUBJECT') || 'mailto:signalonehud@gmail.com' },
]

for (const s of secrets) {
  if (!s.value || s.value.length < 8) {
    console.error(`Missing ${s.name} in .env.local`)
    process.exit(1)
  }
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(secrets),
})

if (!res.ok) {
  const body = await res.text().catch(() => '')
  console.error(`Management API ${res.status}:`, body.slice(0, 400))
  process.exit(1)
}

for (const s of secrets) {
  console.log(`${s.name} synced via Management API.`)
}
console.log('VAPID secrets ready.')
