/**
 * Push selected VITE_* vars from .env.local to Vercel Production.
 * - Never prints secret values (only key names + status).
 * - Windows: uses shell + temp file pipe (stdin to npx is unreliable with spawnSync).
 * Usage: node scripts/syncVercelEnvProduction.mjs
 */
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const envPath = join(root, '.env.local')

const KEYS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_RESCUE_EMAIL_URL',
  'VITE_RESCUE_SIGNING_KEY',
  'VITE_RAPID_ENDPOINT_URL',
]

function parseEnv(content) {
  const m = {}
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    m[k] = v
  }
  return m
}

function redactLog(s) {
  return String(s || '')
    .replace(/eyJ[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .replace(/https?:\/\/[a-z0-9-]+\.supabase\.co/gi, 'https://[redacted].supabase.co')
}

function vercelPipeFromFile(key, file) {
  const quoted = file.replace(/"/g, '\\"')
  const cmd = `type "${quoted}" | npx --yes vercel@latest env add ${key} production --yes --force`
  return spawnSync(cmd, {
    shell: true,
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  })
}

function main() {
  if (!existsSync(envPath)) {
    console.error('[sync-vercel-env] missing .env.local')
    process.exit(1)
  }
  const fileEnv = parseEnv(readFileSync(envPath, 'utf8'))
  let anyFail = false

  for (const key of KEYS) {
    const val = fileEnv[key]
    if (!val || !String(val).trim()) {
      console.log(`[sync-vercel-env] ${key}: skip (empty in .env.local)`)
      continue
    }

    const tmp = join(tmpdir(), `hud-vercel-env-${key}-${Date.now()}.txt`)
    try {
      writeFileSync(tmp, val, 'utf8')
      const add = vercelPipeFromFile(key, tmp)
      const merged = redactLog((add.stderr || '') + (add.stdout || ''))

      if (add.status === 0) {
        console.log(`[sync-vercel-env] ${key}: synced production`)
      } else {
        console.error(`[sync-vercel-env] ${key}: failed (exit ${add.status})`)
        if (merged.trim()) console.error(merged.slice(0, 800))
        anyFail = true
      }
    } finally {
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
    }
  }

  process.exit(anyFail ? 1 : 0)
}

main()
