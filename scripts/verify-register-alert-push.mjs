#!/usr/bin/env node
/**
 * Smoke-test register-alert-push (GET health + POST upsert).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const PROJECT_REF = 'nlrwmtzphoazktmseadb'
const BASE = `https://${PROJECT_REF}.supabase.co/functions/v1/register-alert-push`

function parseEnv() {
  const envPath = resolve(root, '.env.local')
  if (!existsSync(envPath)) return {}
  const text = readFileSync(envPath, 'utf8')
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

const env = parseEnv()
const anonKey = env.VITE_SUPABASE_ANON_KEY ?? ''

function headers() {
  const h = { 'Content-Type': 'application/json' }
  if (anonKey) {
    h.apikey = anonKey
    if (anonKey.startsWith('eyJ')) h.Authorization = `Bearer ${anonKey}`
  }
  return h
}

async function main() {
  const getRes = await fetch(BASE, { method: 'GET' })
  const getBody = await getRes.json().catch(() => ({}))
  console.log('[verify] GET', getRes.status, getBody.ok ? 'ok' : getBody)

  const payload = {
    watchToken: `verifypush${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 32),
    contactEmail: 'verify-push@signalone.test',
    subscription: {
      endpoint: `https://fcm.googleapis.com/fcm/send/verify-${Date.now()}`,
      keys: {
        p256dh: 'BNcRdreALRFXTkOOU4h4uqgLnznEBTB2fyi06AUR0gKj0VwJ0xqHdYxHdWxhWqGx1wN0xQ8vJ8xQ8vJ8xQ8',
        auth: 'tBHItJI5svapreBJ3ZW0wA',
      },
    },
  }

  const postRes = await fetch(BASE, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })
  const postBody = await postRes.json().catch(() => ({}))
  console.log('[verify] POST', postRes.status, postBody)

  if (!getRes.ok || getBody.ok !== true) {
    console.error('[verify] GET health failed')
    process.exit(1)
  }
  if (!postRes.ok || postBody.ok !== true) {
    console.error('[verify] POST registration failed')
    process.exit(1)
  }
  console.log('[verify] register-alert-push OK')
}

main().catch((e) => {
  console.error('[verify] error', e)
  process.exit(1)
})
