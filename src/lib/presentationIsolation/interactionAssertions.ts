/**
 * DEV-only interaction authority assertions.
 */

import { getMapInteractionOwner } from '../mapInteractionRegistry'
import type { ModeRootId } from './modeRoots'

export type InteractionViolation = {
  code: string
  message: string
}

export function collectInteractionViolations(expectedRoot: ModeRootId): InteractionViolation[] {
  const violations: InteractionViolation[] = []
  const owner = getMapInteractionOwner()
  const domOwner = document.documentElement.getAttribute('data-map-interaction-owner')

  if (expectedRoot === 'modern') {
    if (owner?.id !== 'modern') {
      violations.push({
        code: 'MODERN_OWNER_MISSING',
        message: `Modern mode requires map interaction owner "modern" (got ${owner?.id ?? 'none'})`,
      })
    }
    if (domOwner !== 'modern') {
      violations.push({
        code: 'MODERN_DOM_OWNER',
        message: `data-map-interaction-owner must be "modern" (got ${domOwner ?? 'none'})`,
      })
    }
    const radialInMap = document.querySelector('[data-testid="map-canvas"] .radial-menu-container')
    if (radialInMap) {
      violations.push({
        code: 'RADIAL_IN_MAPCANVAS',
        message: 'Radial menu must not render inside MapCanvas in Modern mode',
      })
    }
    const modernRadial = document.querySelector('[data-mode-root="modern"] [data-modern-radial-host]')
    if (!modernRadial) {
      violations.push({
        code: 'MODERN_RADIAL_HOST_MISSING',
        message: 'Modern radial host not mounted in modern root',
      })
    }
  }

  if (expectedRoot === 'balanced') {
    if (owner?.id !== 'balanced') {
      violations.push({
        code: 'BALANCED_OWNER_MISSING',
        message: `Balanced mode requires map interaction owner "balanced" (got ${owner?.id ?? 'none'})`,
      })
    }
    const modernRadial = document.querySelector('[data-mode-root="modern"] [data-modern-radial-host]')
    if (modernRadial) {
      violations.push({
        code: 'MODERN_RADIAL_IN_BALANCED',
        message: 'Modern radial host must not mount in balanced mode',
      })
    }
  }

  if (expectedRoot === 'classic') {
    if (owner != null) {
      violations.push({
        code: 'CLASSIC_INTERACTION_OWNER',
        message: `Classic mode must not register map interaction owner (got ${owner.id})`,
      })
    }
  }

  return violations
}

/** Dev runtime guard — interaction authority per mode root. */
export function assertInteractionAuthority(expectedRoot: ModeRootId): void {
  const violations = collectInteractionViolations(expectedRoot)
  if (violations.length === 0) return
  const msg = violations.map((v) => `[${v.code}] ${v.message}`).join('\n')
  console.error(`[INTERACTION VIOLATION]\n${msg}`)
  if (import.meta.env.DEV) {
    throw new Error(`Interaction authority violated for "${expectedRoot}":\n${msg}`)
  }
}
