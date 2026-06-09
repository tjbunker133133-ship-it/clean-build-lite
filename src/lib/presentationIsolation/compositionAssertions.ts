/**
 * Mode composition identity assertions — DEV loud failures when wrong systems mount.
 */

import type { ModeRootId } from './modeRoots'
import {
  collectCompositionAudit,
  collectMountTree,
  MODE_COMPOSITION_MARKERS,
  type CompositionAuditResult,
} from './compositionAudit'

export type CompositionViolation = {
  code: string
  message: string
  detail?: unknown
}

export function collectCompositionViolations(expected: ModeRootId): CompositionViolation[] {
  const audit = collectCompositionAudit(expected)
  const violations: CompositionViolation[] = []

  for (const entry of audit.entries) {
    if (entry.flags.includes('EMPTY_MODE_ROOT')) {
      violations.push({
        code: 'MISSING_MODE_SYSTEM',
        message: `${expected} missing required system: ${entry.label} (${entry.selector})`,
      })
    }
    if (entry.flags.includes('MODE_COMPOSITION_COLLAPSE')) {
      violations.push({
        code: 'MODE_COMPOSITION_COLLAPSE',
        message: `${expected} must not mount ${entry.label} (${entry.selector})`,
      })
    }
    if (entry.flags.includes('SHARED_RUNTIME_TREE')) {
      violations.push({
        code: 'SHARED_RUNTIME_TREE',
        message: `${entry.label} scoped to ${entry.rootScope}, expected ${expected}`,
      })
    }
    if (entry.flags.includes('FALLBACK_RENDER_PATH')) {
      violations.push({
        code: 'FALLBACK_RENDER_PATH',
        message: `${entry.label} mounted outside mode root (unscoped fallback)`,
      })
    }
  }

  // Classic-specific: must have cockpit panels
  if (expected === 'classic') {
    const panelCount = document.querySelectorAll('[data-mode-root="classic"] .cockpit-panel').length
    if (panelCount < 1) {
      violations.push({
        code: 'CLASSIC_PANELS_MISSING',
        message: `Classic mode has no cockpit panels mounted (found ${panelCount})`,
      })
    }
  }

  // Balanced-specific: workspace must be visible
  if (expected === 'balanced') {
    const workspace = document.querySelector('[data-mode-root="balanced"] [data-balanced-workspace-bar]')
    if (!workspace) {
      violations.push({
        code: 'BALANCED_WORKSPACE_MISSING',
        message: 'Balanced operational workspace strip not mounted',
      })
    }
  }

  // Modern-specific: immersive systems
  if (expected === 'modern') {
    const overlays = document.querySelector('[data-mode-root="modern"] [data-testid="modern-mode-overlays"]')
    if (!overlays) {
      violations.push({
        code: 'MODERN_OVERLAYS_MISSING',
        message: 'ModernModeOverlays not mounted in modern root',
      })
    }
    const fieldScanRail = document.querySelector('[data-mode-root="modern"] [data-testid="modern-field-scan-rail"]')
    if (!fieldScanRail) {
      violations.push({
        code: 'MODERN_FIELD_SCAN_MISSING',
        message: 'Modern field scan rail not mounted',
      })
    }
    const balancedShell = document.querySelector('[data-mode-root="modern"] [data-balanced-layer]')
    if (balancedShell) {
      violations.push({
        code: 'MODERN_BALANCED_BLEED',
        message: 'Balanced workspace mounted inside modern root',
      })
    }
    const cockpit = document.querySelector('[data-mode-root="modern"] .cockpit-hud-shell')
    if (cockpit) {
      violations.push({
        code: 'MODERN_CLASSIC_BLEED',
        message: 'Classic cockpit shell mounted inside modern root',
      })
    }
  }

  return violations
}

export function runCompositionAudit(expected: ModeRootId): {
  ok: boolean
  violations: CompositionViolation[]
  audit: CompositionAuditResult
} {
  const audit = collectCompositionAudit(expected)
  const violations = collectCompositionViolations(expected)
  return { ok: violations.length === 0, violations, audit }
}

export function assertModeComposition(expected: ModeRootId): void {
  const { ok, violations } = runCompositionAudit(expected)
  if (ok) return

  const msg = violations.map((v) => `[${v.code}] ${v.message}`).join('\n')
  console.error(`[COMPOSITION VIOLATION]\n${msg}`, violations)

  if (import.meta.env.DEV) {
    throw new Error(`Mode composition identity violated for "${expected}":\n${msg}`)
  }
}

export function publishCompositionApi(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & {
    __HUD_COMPOSITION__?: {
      audit: (mode: ModeRootId) => ReturnType<typeof runCompositionAudit>
      mountTree: (mode: ModeRootId) => ReturnType<typeof import('./compositionAudit').collectMountTree>
    }
  }
  w.__HUD_COMPOSITION__ = {
    audit: runCompositionAudit,
    mountTree: collectMountTree,
    markers: MODE_COMPOSITION_MARKERS,
  }
}
