#!/usr/bin/env node
/**
 * Sync VITE_* vars from .env.local to the linked Vercel project.
 * Never prints secret values. Requires: vercel link + .env.local at repo root.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import project from '../projects/hud-v1/project.json' with { type: 'json' }

const root = path.resolve(import.meta.dirname, '..')
const parent = path.dirname(root)
const projectDir = path.basename(root)
const envPath = path.join(root, '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('Missing .env.local — run npm run env:init')
  process.exit(1)
}

const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
const targets = ['production', 'preview', 'development']

for (const line of lines) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!m || !m[1].startsWith('VITE_')) continue
  const name = m[1]
  let val = m[2].trim()
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1)
  }
  if (!val) {
    console.log(`skip empty ${name}`)
    continue
  }
  for (const env of targets) {
    try {
      // Run from parent dir: repo has env/ setup folder; `vercel env add … preview` mis-parses from inside root.
      const envArg =
        env === 'preview'
          ? `preview ${project.productionBranch}`
          : env
      execSync(
        `vercel env add ${name} ${envArg} --force --yes --value ${JSON.stringify(val)} --cwd ${JSON.stringify(projectDir)}`,
        { cwd: parent, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      console.log(`set ${name} ${env}`)
    } catch (e) {
      const msg = String(e.stderr ?? e.stdout ?? e.message ?? '')
      if (msg.includes('already exists') || msg.includes('Overwriting')) {
        console.log(`ok ${name} ${env}`)
      } else {
        console.error(`fail ${name} ${env}: ${msg.slice(0, 160)}`)
      }
    }
  }
}
