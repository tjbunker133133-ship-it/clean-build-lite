import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  TIER1_BASELINE_MANIFEST_REL,
  TIER1_FREEZE_DATE,
  TIER1_FREEZE_ID,
} from './tier1FreezeBoundaries'
import { TIER1_LOCKED_SHA256 } from './tier1Contract'

export type Tier1BaselineManifest = {
  freezeId: string
  frozenAt: string
  reference: { path: string; sha256: string }
  production: Record<string, string>
}

export function sha256FileHex(rootDir: string, relPath: string): string {
  const abs = resolve(rootDir, relPath)
  return createHash('sha256').update(readFileSync(abs)).digest('hex')
}

export function readTier1BaselineManifest(rootDir: string): Tier1BaselineManifest {
  const raw = readFileSync(resolve(rootDir, TIER1_BASELINE_MANIFEST_REL), 'utf8')
  return JSON.parse(raw) as Tier1BaselineManifest
}

export function auditTier1BaselineManifest(rootDir: string): {
  ok: boolean
  failures: string[]
} {
  const failures: string[] = []
  const manifestPath = resolve(rootDir, TIER1_BASELINE_MANIFEST_REL)

  if (!existsSync(manifestPath)) {
    return { ok: false, failures: [`missing ${TIER1_BASELINE_MANIFEST_REL}`] }
  }

  const manifest = readTier1BaselineManifest(rootDir)

  if (manifest.freezeId !== TIER1_FREEZE_ID) {
    failures.push(`manifest freezeId must be ${TIER1_FREEZE_ID}`)
  }
  if (manifest.frozenAt !== TIER1_FREEZE_DATE) {
    failures.push(`manifest frozenAt must be ${TIER1_FREEZE_DATE}`)
  }

  const refPath = manifest.reference.path
  if (!existsSync(resolve(rootDir, refPath))) {
    failures.push(`missing reference file ${refPath}`)
  } else {
    const refHash = sha256FileHex(rootDir, refPath)
    if (refHash !== manifest.reference.sha256) {
      failures.push(
        `${refPath} hash drift in manifest (stored ${manifest.reference.sha256.slice(0, 16)}… actual ${refHash.slice(0, 16)}…)`,
      )
    }
    if (refHash !== TIER1_LOCKED_SHA256) {
      failures.push(`${refPath} must match TIER1_LOCKED_SHA256 contract`)
    }
  }

  for (const [relPath, expected] of Object.entries(manifest.production)) {
    const abs = resolve(rootDir, relPath)
    if (!existsSync(abs)) {
      failures.push(`missing production baseline file ${relPath}`)
      continue
    }
    const actual = sha256FileHex(rootDir, relPath)
    if (actual !== expected) {
      failures.push(
        `${relPath} production baseline drift (expected ${expected.slice(0, 16)}… got ${actual.slice(0, 16)}…)`,
      )
    }
  }

  return { ok: failures.length === 0, failures }
}
