#!/usr/bin/env node
/** Compare VITE_RESCUE_SIGNING_KEY digest to Supabase RESCUE_SIGNING_KEY. */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')
const PROJECT_REF = 'nlrwmtzphoazktmseadb'

function parseKey(text) {
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

function remoteSigningKeyDigest() {
  const result = spawnSync(
    'npx',
    ['supabase', 'secrets', 'list', '--project-ref', PROJECT_REF],
    { cwd: root, encoding: 'utf8', shell: true },
  )
  if (result.status !== 0) return null
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.includes('RESCUE_SIGNING_KEY')) continue
    const parts = line.split('|').map((p) => p.trim())
    if (parts.length >= 2 && parts[0] === 'RESCUE_SIGNING_KEY') return parts[1]
  }
  return null
}

if (!existsSync(envPath)) {
  console.error('Missing .env.local')
  process.exit(1)
}

const key = parseKey(readFileSync(envPath, 'utf8'))
const localDigest = createHash('sha256').update(key).digest('hex')
const remoteDigest = remoteSigningKeyDigest()
const digestMatch = Boolean(remoteDigest && localDigest === remoteDigest)

console.log(
  JSON.stringify({
    keyPresent: key.length > 0,
    keyLen: key.length,
    remoteDigestAvailable: Boolean(remoteDigest),
    digestMatch,
  }),
)
process.exit(digestMatch ? 0 : 1)
