#!/usr/bin/env node
/**
 * Sync VITE_RESCUE_SIGNING_KEY from .env.local → Supabase RESCUE_SIGNING_KEY.
 * Never prints the key value.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')
const PROJECT_REF = 'nlrwmtzphoazktmseadb'

function parseSigningKey(text) {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    if (t.slice(0, i).trim() === 'VITE_RESCUE_SIGNING_KEY') {
      let val = t.slice(i + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      return val
    }
  }
  return ''
}

if (!existsSync(envPath)) {
  console.error('Missing .env.local — run: npm run env:init')
  process.exit(1)
}

const key = parseSigningKey(readFileSync(envPath, 'utf8'))
if (!key) {
  console.error('VITE_RESCUE_SIGNING_KEY is missing in .env.local')
  process.exit(1)
}

const result = spawnSync(
  'npx',
  ['supabase', 'secrets', 'set', `RESCUE_SIGNING_KEY=${key}`, '--project-ref', PROJECT_REF],
  { cwd: root, stdio: 'inherit', shell: true },
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log('RESCUE_SIGNING_KEY synced to Supabase (value not shown).')
