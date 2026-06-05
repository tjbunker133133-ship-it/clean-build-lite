#!/usr/bin/env node
/**
 * Update Tier 1 manifest with normalized (LF) line ending hashes
 * This fixes cross-platform hash drift between Windows (CRLF) and Unix (LF)
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifestPath = resolve(root, 'tier1-baseline.manifest.json')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

// Normalize all production file hashes
const normalized = {}
for (const [rel, oldHash] of Object.entries(manifest.production)) {
  try {
    const data = readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n')
    const hash = createHash('sha256').update(data, 'utf8').digest('hex')
    normalized[rel] = hash
    console.log(`${rel}:`)
    console.log(`  old: ${oldHash}`)
    console.log(`  new: ${hash}`)
    console.log()
  } catch (e) {
    console.error(`Error reading ${rel}: ${e.message}`)
  }
}

// Update reference hash
const refData = readFileSync(resolve(root, manifest.reference.path), 'utf8').replace(/\r\n/g, '\n')
const refHash = createHash('sha256').update(refData, 'utf8').digest('hex')
console.log('reference:')
console.log(`  path: ${manifest.reference.path}`)
console.log(`  old: ${manifest.reference.sha256}`)
console.log(`  new: ${refHash}`)

// Update manifest
manifest.reference.sha256 = refHash
manifest.production = normalized

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`\nUpdated ${manifestPath}`)
