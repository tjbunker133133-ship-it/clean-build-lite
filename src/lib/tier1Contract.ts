import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HALF_CORRIDOR_FEET } from './corridor'

/** Locked reference implementation per `src/.cursorrules` (2026-05-04). */
export const TIER1_REFERENCE_REL = 'src/tier1-hud.html'
// Normalized hash (LF line endings) for cross-platform consistency
export const TIER1_LOCKED_SHA256 =
  'e9e38a80488e81cb5439a7fa0f1941b945d75af60ec745f3ab70d541ecd01b01'

export const TIER1_GPS_POLL_MS = 120_000
export const TIER1_SOS_HOLD_MS = 3_000
export const TIER1_CORRIDOR_HALF_WIDTH_FEET = 5_280

export type Tier1AuditResult = {
  ok: boolean
  failures: string[]
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function auditTier1ReferenceHtml(source: string): Tier1AuditResult {
  const failures: string[] = []

  if (!source.includes('var POLL_MS=120000')) {
    failures.push('GPS poll constant POLL_MS=120000 missing or changed')
  }
  if (!source.includes('var SOS_MS=3000')) {
    failures.push('SOS hold constant SOS_MS=3000 missing or changed')
  }
  if (!source.includes('bento-root')) {
    failures.push('Bento grid root class bento-root missing')
  }
  if (!/encryptPayload\s*\(/.test(source) || !/localStorage\.setItem\s*\(/.test(source)) {
    failures.push('Forensic vault write path missing encrypt or persist')
  } else {
    const vaultHandler = source.slice(source.indexOf("vaultBtn.addEventListener('click'"))
    const encIdx = vaultHandler.indexOf('encryptPayload')
    const storeIdx = vaultHandler.indexOf('localStorage.setItem')
    if (encIdx < 0 || storeIdx < 0 || encIdx > storeIdx) {
      failures.push('Forensic vault must call encryptPayload before localStorage.setItem')
    }
  }
  if (/\bfetch\s*\(/.test(source) || /\bXMLHttpRequest\b/.test(source)) {
    failures.push('Tier 1 reference must not perform network I/O')
  }
  if (!source.includes('tap on rail does not arm')) {
    failures.push('SOS rail tap guard copy missing (tap must not arm)')
  }
  if (!source.includes('setInterval(pulseGPS,POLL_MS)')) {
    failures.push('GPS interval must use POLL_MS via setInterval')
  }

  return { ok: failures.length === 0, failures }
}

export function auditProductionSosHold(source: string): Tier1AuditResult {
  const failures: string[] = []
  if (!/\bconst\s+HOLD_MS\s*=\s*3000\b/.test(source)) {
    failures.push('SOSPanel HOLD_MS must remain 3000 (3s sustained slide)')
  }
  return { ok: failures.length === 0, failures }
}

export function auditCorridorWidth(): Tier1AuditResult {
  const failures: string[] = []
  if (HALF_CORRIDOR_FEET !== TIER1_CORRIDOR_HALF_WIDTH_FEET) {
    failures.push(
      `HALF_CORRIDOR_FEET must be ${TIER1_CORRIDOR_HALF_WIDTH_FEET} (2-mile total width); got ${HALF_CORRIDOR_FEET}`,
    )
  }
  return { ok: failures.length === 0, failures }
}

export function readTier1ReferenceFromRepo(rootDir: string): string {
  // Normalize line endings for cross-platform consistency
  return readFileSync(resolve(rootDir, TIER1_REFERENCE_REL), 'utf8').replace(/\r\n/g, '\n')
}

export function runTier1ContractAudit(rootDir: string): Tier1AuditResult {
  const failures: string[] = []
  const reference = readTier1ReferenceFromRepo(rootDir)
  const hash = sha256Hex(reference)

  if (hash !== TIER1_LOCKED_SHA256) {
    failures.push(
      `tier1-hud.html SHA-256 drift: expected ${TIER1_LOCKED_SHA256.slice(0, 16)}… got ${hash.slice(0, 16)}…`,
    )
  }

  for (const step of [
    auditTier1ReferenceHtml(reference),
    auditProductionSosHold(
      readFileSync(resolve(rootDir, 'src/hud/SOSPanel.tsx'), 'utf8'),
    ),
    auditCorridorWidth(),
  ]) {
    failures.push(...step.failures)
  }

  return { ok: failures.length === 0, failures }
}
