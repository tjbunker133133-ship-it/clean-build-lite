#!/usr/bin/env node
/**
 * Tier 1 freeze gate: production baseline manifest must match working tree.
 * Pair with verify-tier1-contract.mjs and tier1Freeze.test.ts.
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifestPath = resolve(root, 'tier1-baseline.manifest.json')
// Normalized hash (LF line endings) for cross-platform consistency
const TIER1_LOCKED =
  'e9e38a80488e81cb5439a7fa0f1941b945d75af60ec745f3ab70d541ecd01b01'

function fail(msg) {
  console.error(`[tier1-freeze] ${msg}`)
  process.exit(1)
}

function sha256(rel) {
  // Normalize line endings for consistent hashing across platforms
  const data = readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

if (!existsSync(manifestPath)) {
  fail(`missing ${manifestPath}`)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

if (manifest.freezeId !== 'tier1-field-proven-2026-05-24') {
  fail(`unexpected freezeId: ${manifest.freezeId}`)
}

const ref = manifest.reference?.path ?? 'src/tier1-hud.html'
const refExpected = manifest.reference?.sha256 ?? TIER1_LOCKED
if (!existsSync(resolve(root, ref))) fail(`missing reference ${ref}`)
const refActual = sha256(ref)
if (refActual !== refExpected) {
  fail(`${ref} manifest reference hash drift`)
}
if (refActual !== TIER1_LOCKED) {
  fail(`${ref} must match tier1 contract hash`)
}

for (const [rel, expected] of Object.entries(manifest.production ?? {})) {
  if (!existsSync(resolve(root, rel))) fail(`missing ${rel}`)
  const actual = sha256(rel)
  if (actual !== expected) {
    fail(`${rel} baseline drift (expected ${expected.slice(0, 16)}… got ${actual.slice(0, 16)}…)`)
  }
}

console.log(
  JSON.stringify({
    gate: 'tier1-freeze',
    freezeId: manifest.freezeId,
    productionFiles: Object.keys(manifest.production ?? {}).length,
    status: 'pass',
  }),
)
