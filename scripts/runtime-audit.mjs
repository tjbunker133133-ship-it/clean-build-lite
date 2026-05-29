#!/usr/bin/env node
/**
 * Post-build runtime audit (no deploy). Exits non-zero on hard failures.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const report = { gate: 'runtime-audit', checks: [], status: 'pass' }

function check(name, ok, detail) {
  report.checks.push({ name, ok, detail })
  if (!ok) report.status = 'fail'
}

const distIndex = path.join(root, 'dist', 'index.html')
check('dist/index.html exists', fs.existsSync(distIndex), distIndex)

const manifest = path.join(root, 'tier1-baseline.manifest.json')
check('tier1 manifest exists', fs.existsSync(manifest), manifest)

try {
  execSync('node scripts/verify-tier1-freeze.mjs', { cwd: root, stdio: 'pipe' })
  check('tier1-freeze', true, 'pass')
} catch (e) {
  check('tier1-freeze', false, String(e.stderr || e.message))
}

const capConfig = path.join(root, 'capacitor.config.ts')
check('capacitor.config.ts', fs.existsSync(capConfig), 'Play track config')

const pluginJava = path.join(
  root,
  'plugins/capacitor-hud-mission-link/android/src/main/java/com/signalone/hud/plugins/missionlink/HudMissionLinkPlugin.java',
)
check('android mission link plugin', fs.existsSync(pluginJava), pluginJava)

console.log(JSON.stringify(report, null, 2))
if (report.status !== 'pass') process.exit(1)
