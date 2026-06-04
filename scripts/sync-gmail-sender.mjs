#!/usr/bin/env node
/**
 * Push GMAIL_USER + GMAIL_APP_PASSWORD from .env.local → Supabase Edge Function secrets.
 * Never prints secret values.
 *
 * Prerequisite: npx supabase login (once per machine)
 *
 * In .env.local (gitignored), add:
 *   GMAIL_USER=signalonehud@gmail.com
 *   GMAIL_APP_PASSWORD=<16-char Google App Password, no spaces>
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

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
    return val.replace(/\s+/g, '')
  }
  return ''
}

if (!existsSync(envPath)) {
  console.error('Missing .env.local — add GMAIL_USER and GMAIL_APP_PASSWORD, then rerun.')
  process.exit(1)
}

const raw = readFileSync(envPath, 'utf8')
const gmailUser = parseEnvKey(raw, 'GMAIL_USER')
const gmailPass = parseEnvKey(raw, 'GMAIL_APP_PASSWORD')

if (!gmailUser || !gmailUser.includes('@')) {
  console.error('GMAIL_USER missing or invalid in .env.local')
  process.exit(1)
}
if (!gmailPass || gmailPass.length < 8) {
  console.error('GMAIL_APP_PASSWORD missing in .env.local (Google App Password, 16 chars)')
  process.exit(1)
}

for (const [name, value] of [
  ['GMAIL_USER', gmailUser],
  ['GMAIL_APP_PASSWORD', gmailPass],
]) {
  const result = spawnSync(
    'npx',
    ['supabase', 'secrets', 'set', `${name}=${value}`, '--project-ref', PROJECT_REF],
    { cwd: root, stdio: 'inherit', shell: true },
  )
  if (result.status !== 0) {
    console.error(`Failed to set ${name}. Run: npx supabase login`)
    process.exit(result.status ?? 1)
  }
  console.log(`${name} synced to Supabase (value not shown).`)
}

console.log(`Rescue emails will send From: ${gmailUser}`)
console.log('No app redeploy needed — edge function picks up secrets on next invoke.')
