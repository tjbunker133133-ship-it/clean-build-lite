#!/usr/bin/env node
/**
 * One-shot deploy: migration + push edge functions (JWT off) + VAPID secrets.
 * Prerequisite: npx supabase login  OR  set SUPABASE_ACCESS_TOKEN in environment.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const PROJECT_REF = 'nlrwmtzphoazktmseadb'

function run(cmd, args, { allowFail = false } = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true })
  if (result.status !== 0 && !allowFail) {
    console.error(`\n[deploy-alert-push] failed: ${cmd}`)
    process.exit(result.status ?? 1)
  }
  return result.status ?? 0
}

console.log('[deploy-alert-push] project', PROJECT_REF)

run('npx', ['supabase', 'db', 'push', '--linked', '--yes'], { allowFail: true })

run('npx', [
  'supabase',
  'functions',
  'deploy',
  'register-alert-push',
  'send-rescue-push',
  '--no-verify-jwt',
  '--project-ref',
  PROJECT_REF,
])

if (existsSync(resolve(root, '.env.local'))) {
  if (process.platform === 'win32') {
    run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(root, 'scripts/sync-vapid-secrets.ps1'),
    ], { allowFail: true })
  } else {
    run('npm', ['run', 'env:sync-vapid'], { allowFail: true })
  }
} else {
  console.warn('[deploy-alert-push] .env.local missing — run: npm run env:generate-vapid')
}

run('node', [resolve(root, 'scripts/verify-register-alert-push.mjs')], { allowFail: true })

console.log('\n[deploy-alert-push] done')
console.log(`  Health: https://${PROJECT_REF}.supabase.co/functions/v1/register-alert-push`)
console.log('  Dashboard: JWT verify should be OFF for register-alert-push and send-rescue-push')
