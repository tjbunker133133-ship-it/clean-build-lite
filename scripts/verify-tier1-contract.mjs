#!/usr/bin/env node
/**
 * Fast Tier 1 hardening gate (no network). Fails CI/pre-merge if reference drifts.
 * Full invariants (corridor width, etc.) run in vitest: src/lib/tier1Contract.test.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const referencePath = resolve(root, 'src/tier1-hud.html')
const LOCKED =
  '898d8f46e5dd5b35d78cfcb7b5a3843cba7d61b396a3d9e91540ee78d3dbe397'

function fail(msg) {
  console.error(`[tier1-contract] ${msg}`)
  process.exit(1)
}

if (!existsSync(referencePath)) {
  fail(`missing ${referencePath}`)
}

const reference = readFileSync(referencePath, 'utf8')
const hash = createHash('sha256').update(reference, 'utf8').digest('hex')
if (hash !== LOCKED) {
  fail(`SHA-256 drift (expected ${LOCKED.slice(0, 16)}…, got ${hash.slice(0, 16)}…)`)
}

const checks = [
  ['POLL_MS=120000', reference.includes('var POLL_MS=120000')],
  ['SOS_MS=3000', reference.includes('var SOS_MS=3000')],
  ['bento-root', reference.includes('bento-root')],
  ['no fetch', !/\bfetch\s*\(/.test(reference)],
  ['encrypt before write', (() => {
    const h = reference.slice(reference.indexOf("vaultBtn.addEventListener('click'"))
    const enc = h.indexOf('encryptPayload')
    const store = h.indexOf('localStorage.setItem')
    return enc >= 0 && store > enc
  })()],
]

for (const [label, ok] of checks) {
  if (!ok) fail(`reference contract failed: ${label}`)
}

const sosPath = resolve(root, 'src/hud/SOSPanel.tsx')
if (!existsSync(sosPath)) fail('missing SOSPanel.tsx')
const sos = readFileSync(sosPath, 'utf8')
if (!/\bconst\s+HOLD_MS\s*=\s*3000\b/.test(sos)) {
  fail('SOSPanel HOLD_MS must be 3000')
}

console.log(
  JSON.stringify({
    gate: 'tier1-contract',
    referenceHash: hash.slice(0, 16),
    pollMs: 120000,
    sosHoldMs: 3000,
    status: 'pass',
  }),
)
