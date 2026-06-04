#!/usr/bin/env node
/** Cross-platform VAPID secret sync (Windows uses Credential Manager bridge). */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

if (process.platform === 'win32') {
  const ps1 = resolve(root, 'scripts/sync-vapid-secrets.ps1')
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    { cwd: root, stdio: 'inherit' },
  )
  process.exit(r.status ?? 1)
}

const r = spawnSync('node', [resolve(root, 'scripts/sync-vapid-secrets.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(r.status ?? 1)
