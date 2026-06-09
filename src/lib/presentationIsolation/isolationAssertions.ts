/**
 * Runtime isolation assertions — dev-mode loud failures for containment violations.
 */

import type { ModeRootId } from './modeRoots'
import { getActivePortals, getOrphanedPortals } from './portalRegistry'

const MODE_ROOT_SELECTOR = '[data-mode-root]'

export type IsolationViolation = {
  code: string
  message: string
  detail?: unknown
}

export function collectModeRootViolations(expected: ModeRootId): IsolationViolation[] {
  const violations: IsolationViolation[] = []
  const roots = [...document.querySelectorAll(MODE_ROOT_SELECTOR)]
  const rootIds = roots.map((el) => el.getAttribute('data-mode-root'))

  if (roots.length === 0) {
    violations.push({ code: 'NO_MODE_ROOT', message: 'No mode root mounted' })
  } else if (roots.length > 1) {
    violations.push({
      code: 'MULTIPLE_MODE_ROOTS',
      message: `Expected 1 mode root, found ${roots.length}`,
      detail: rootIds,
    })
  } else if (rootIds[0] !== expected) {
    violations.push({
      code: 'WRONG_MODE_ROOT',
      message: `Expected mode root "${expected}", found "${rootIds[0]}"`,
    })
  }

  const forbiddenSiblings: Record<ModeRootId, string[]> = {
    classic: ['balanced', 'modern'],
    balanced: ['classic', 'modern'],
    modern: ['classic', 'balanced'],
  }
  for (const forbidden of forbiddenSiblings[expected]) {
    if (document.querySelector(`[data-mode-root="${forbidden}"]`)) {
      violations.push({
        code: 'CROSS_MODE_CONTAINER',
        message: `Inactive mode root "${forbidden}" still mounted while "${expected}" is active`,
      })
    }
  }

  return violations
}

export function collectPortalViolations(expected: ModeRootId): IsolationViolation[] {
  const violations: IsolationViolation[] = []
  const orphaned = getOrphanedPortals(expected)
  if (orphaned.length > 0) {
    violations.push({
      code: 'ORPHANED_PORTAL',
      message: `${orphaned.length} portal(s) from inactive mode(s) still registered`,
      detail: orphaned,
    })
  }
  return violations
}

export function collectOverlayOwnershipViolations(expected: ModeRootId): IsolationViolation[] {
  const violations: IsolationViolation[] = []
  const checks: Array<{ selector: string; owner: ModeRootId }> = [
    { selector: '[data-testid="modern-mode-overlays"]', owner: 'modern' },
    { selector: '[data-balanced-layer]', owner: 'balanced' },
    { selector: '.cockpit-hud-shell', owner: 'classic' },
    { selector: '.modern-micro-bar', owner: 'modern' },
    { selector: '.balanced-micro-bar', owner: 'balanced' },
    { selector: '[data-compass-layer="classic"]', owner: 'classic' },
    { selector: '[data-compass-layer="balanced"]', owner: 'balanced' },
    { selector: '[data-compass-layer="modern"]', owner: 'modern' },
  ]

  for (const { selector, owner } of checks) {
    const el = document.querySelector(selector)
    if (!el) continue
    const root = el.closest('[data-mode-root]')
    const rootMode = root?.getAttribute('data-mode-root') ?? null
    if (rootMode !== owner) {
      violations.push({
        code: 'LEAKED_OVERLAY_ROOT',
        message: `${selector} found outside ${owner} mode root (in: ${rootMode ?? 'unscoped'})`,
      })
    }
    if (owner !== expected) {
      violations.push({
        code: 'INACTIVE_MODE_CHROME',
        message: `${selector} present while active mode is ${expected}`,
      })
    }
  }

  return violations
}

export function collectInteractionViolations(expected: ModeRootId): IsolationViolation[] {
  const violations: IsolationViolation[] = []
  const inactiveRoots = [...document.querySelectorAll(MODE_ROOT_SELECTOR)].filter(
    (el) => el.getAttribute('data-mode-root') !== expected,
  )
  for (const root of inactiveRoots) {
    const interactive = root.querySelectorAll('button, a, input, [role="button"], [tabindex="0"]')
    if (interactive.length > 0) {
      violations.push({
        code: 'INACTIVE_HANDLER',
        message: `Inactive mode root "${root.getAttribute('data-mode-root')}" has ${interactive.length} interactive element(s)`,
      })
    }
  }
  return violations
}

export function runIsolationAudit(expected: ModeRootId): {
  ok: boolean
  violations: IsolationViolation[]
} {
  const violations = [
    ...collectModeRootViolations(expected),
    ...collectPortalViolations(expected),
    ...collectOverlayOwnershipViolations(expected),
    ...collectInteractionViolations(expected),
  ]
  return { ok: violations.length === 0, violations }
}

export function assertModeRootIsolation(expected: ModeRootId): void {
  const { ok, violations } = runIsolationAudit(expected)
  if (ok) return

  const msg = violations.map((v) => `[${v.code}] ${v.message}`).join('\n')
  console.error(`[ISOLATION VIOLATION]\n${msg}`, violations)

  if (import.meta.env.DEV) {
    throw new Error(`Mode root isolation violated:\n${msg}`)
  }
}

export function publishIsolationApi(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & {
    __HUD_ISOLATION__?: {
      audit: (mode: ModeRootId) => ReturnType<typeof runIsolationAudit>
      portals: ReturnType<typeof getActivePortals>
      mountedModeRoots: string[]
    }
  }
  w.__HUD_ISOLATION__ = {
    ...w.__HUD_ISOLATION__,
    audit: runIsolationAudit,
    portals: getActivePortals(),
    mountedModeRoots: [...document.querySelectorAll(MODE_ROOT_SELECTOR)].map(
      (el) => el.getAttribute('data-mode-root') ?? '',
    ),
  }
}
