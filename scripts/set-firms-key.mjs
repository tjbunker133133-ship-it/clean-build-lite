#!/usr/bin/env node
/**
 * Add or update VITE_FIRMS_MAP_KEY in .env.local (Windows-safe; no PowerShell VAR=value syntax).
 * Usage:
 *   npm run env:set-firms -- YOUR_MAP_KEY
 *   npm run env:set-firms   (prompts if no arg)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')
const KEY = 'VITE_FIRMS_MAP_KEY'

function upsertKey(text, value) {
  const lines = text.split(/\r?\n/)
  let found = false
  const out = lines.map((line) => {
    const t = line.trim()
    if (!t.startsWith(`${KEY}=`) && !t.startsWith(`${KEY} `)) return line
    found = true
    return `${KEY}=${value}`
  })
  if (!found) {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('')
    out.push('# NASA FIRMS active fire overlay (https://firms.modaps.eosdis.nasa.gov/api/map_key/)')
    out.push(`${KEY}=${value}`)
  }
  return out.join('\n') + '\n'
}

async function promptKey() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolvePrompt) => {
    rl.question('Paste NASA FIRMS MAP_KEY: ', (answer) => {
      rl.close()
      resolvePrompt(answer.trim())
    })
  })
}

const fromArg = process.argv.slice(2).join(' ').trim()
const key = fromArg || (await promptKey())

if (!key || key.length < 16) {
  console.error('Invalid MAP_KEY (too short). Get one at: https://firms.modaps.eosdis.nasa.gov/api/map_key/')
  process.exit(1)
}

if (!existsSync(envPath)) {
  console.error('Missing .env.local — run: npm run env:init')
  process.exit(1)
}

const raw = readFileSync(envPath, 'utf8')
writeFileSync(envPath, upsertKey(raw, key), 'utf8')
console.log(`${KEY} saved to .env.local (value hidden).`)
console.log('Restart dev server: stop npm run dev, then npm run dev again.')
console.log('Production: node scripts/syncVercelEnvProduction.mjs')
