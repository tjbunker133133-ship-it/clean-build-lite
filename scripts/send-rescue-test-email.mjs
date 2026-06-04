#!/usr/bin/env node
/**
 * One-off signed CHECKIN to a real inbox — verifies Gmail sender secrets.
 * Usage: node scripts/send-rescue-test-email.mjs [recipient-email]
 * Never prints signing key or full response bodies with PII.
 */
import { createHmac } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')
const to = (process.argv[2] ?? 'tjbunker133133@gmail.com').trim().toLowerCase()

function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[t.slice(0, i).trim()] = val
  }
  return out
}

function canonicalJSON(value) {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']'
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return (
      '{' +
      keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') +
      '}'
    )
  }
  return 'null'
}

if (!existsSync(envPath)) {
  console.error('Missing .env.local')
  process.exit(1)
}

const env = parseEnv(readFileSync(envPath, 'utf8'))
const signingKey = env.VITE_RESCUE_SIGNING_KEY ?? ''
const url = env.VITE_RESCUE_EMAIL_URL ?? ''
const anonKey = env.VITE_SUPABASE_ANON_KEY ?? ''

if (!signingKey || !url || !anonKey) {
  console.error('Missing VITE_RESCUE_SIGNING_KEY, VITE_RESCUE_EMAIL_URL, or VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const base = {
  triggerType: 'CHECKIN',
  timestamp: new Date().toISOString(),
  coordinates: { lat: 39.7392, lng: -104.9903 },
  contacts: [{ name: 'Sender Verification', email: to }],
  operator: {
    display_name: 'Signal One Sender Test',
    reply_to_email: 'signalonehud@gmail.com',
  },
  source: 'tactical-hud',
}

const signature = createHmac('sha256', signingKey).update(canonicalJSON(base)).digest('hex')
const packet = { ...base, signature }

const headers = { 'Content-Type': 'application/json', apikey: anonKey }
if (anonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${anonKey}`

const res = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(packet),
})

let body = {}
try {
  body = await res.json()
} catch {
  body = {}
}

console.log(
  JSON.stringify(
    {
      status: res.status,
      ok: res.ok,
      code: body.code ?? body.error ?? null,
      sentCount: body.sent ?? body.successCount ?? null,
      to,
      subjectExpected: '[CHECK-IN]',
      fromExpected: 'signalonehud@gmail.com',
    },
    null,
    2,
  ),
)

process.exit(res.ok ? 0 : 1)
