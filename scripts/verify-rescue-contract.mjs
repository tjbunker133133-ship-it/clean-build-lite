#!/usr/bin/env node
/** Live contract probe: operator + coords (no PII in stdout). */
import { createHmac } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')

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
  console.error('Missing signing key, rescue URL, or anon key')
  process.exit(1)
}

const iso = new Date().toISOString()
const base = {
  triggerType: 'SOS',
  timestamp: iso,
  coordinates: { lat: 37.7749, lng: -122.4194 },
  contacts: [{ name: 'Verify', email: 'verify@example.com' }],
  source: 'tactical-hud',
  operator: {
    display_name: 'Contract Probe',
    reply_to_email: 'probe-reply@example.com',
    phone: '+15551234567',
  },
}
const signature = createHmac('sha256', signingKey).update(canonicalJSON(base)).digest('hex')
const headers = { 'Content-Type': 'application/json', apikey: anonKey }
if (anonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${anonKey}`

const res = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({ ...base, signature }),
})
let body = null
try {
  body = await res.json()
} catch {
  body = { parseError: true }
}

const operatorAccepted = res.status !== 400 || body?.message?.includes('operator') !== true
console.log(
  JSON.stringify({
    endpointPath: new URL(url).pathname,
    timestampSent: iso,
    status: res.status,
    code: body?.code ?? body?.error ?? null,
    operatorFieldAccepted: operatorAccepted,
    partial: body?.partial ?? false,
    sent: body?.sent ?? null,
  }),
)
process.exit(res.status === 200 || res.status === 207 ? 0 : 1)
