/**
 * OVERLAY RENDERMODE SCHEMA VALIDATOR
 *
 * Enforces taxonomy rules at definition/load time:
 * - "situational": Always visible when enabled, minZoom ignored
 * - "detail": Requires minZoom >= 0 for visibility gating
 *
 * This is a guardrail to prevent future classification drift.
 */

import { traceOverlay } from '../../runtime/runtimeForensics'
import type { EnvironmentalOverlayDef, OverlayRenderMode } from '../environmentalOverlays/types'

export interface ValidationResult {
  valid: boolean
  warnings: string[]
  errors: string[]
}

const VALID_RENDER_MODES: OverlayRenderMode[] = ['situational', 'detail']

/**
 * Validate a single overlay definition against renderMode taxonomy rules.
 *
 * RULES:
 * 1. renderMode MUST be explicitly defined (no undefined/fallback)
 * 2. IF renderMode === "detail":
 *    - minZoom IS REQUIRED
 *    - minZoom MUST be a number >= 0
 * 3. IF renderMode === "situational":
 *    - minZoom MAY exist for legacy (warning only)
 *    - minZoom MUST NOT be used as visibility gate (enforced at runtime)
 */
export function validateOverlayDefinition(def: EnvironmentalOverlayDef): ValidationResult {
  const warnings: string[] = []
  const errors: string[] = []

  // RULE 1: renderMode MUST be explicitly defined
  if (def.renderMode === undefined) {
    errors.push(`Overlay "${def.id}": renderMode is required (must be "situational" or "detail")`)
    traceOverlay('overlay_renderMode_missing', { overlayId: def.id })
    return { valid: false, warnings, errors }
  }

  // Validate renderMode value
  if (!VALID_RENDER_MODES.includes(def.renderMode)) {
    errors.push(
      `Overlay "${def.id}": invalid renderMode "${def.renderMode}" (must be "situational" or "detail")`
    )
    traceOverlay('overlay_schema_invalid', {
      overlayId: def.id,
      field: 'renderMode',
      value: def.renderMode,
    })
    return { valid: false, warnings, errors }
  }

  // RULE 2: Detail overlays REQUIRE minZoom
  if (def.renderMode === 'detail') {
    if (def.minZoom === undefined) {
      errors.push(`Overlay "${def.id}": detail overlays MUST have minZoom defined`)
      traceOverlay('overlay_detail_missing_minZoom', { overlayId: def.id })
    } else if (typeof def.minZoom !== 'number' || def.minZoom < 0) {
      errors.push(
        `Overlay "${def.id}": minZoom must be a number >= 0, got ${def.minZoom}`
      )
      traceOverlay('overlay_schema_invalid', {
        overlayId: def.id,
        field: 'minZoom',
        value: def.minZoom,
      })
    }
  }

  // RULE 3: Situational overlays with minZoom get warning (allowed but discouraged)
  if (def.renderMode === 'situational' && def.minZoom !== undefined) {
    warnings.push(
      `Overlay "${def.id}": situational overlay has minZoom (${def.minZoom}) which will be ignored. ` +
        `Remove minZoom or reclassify as "detail" if zoom gating is desired.`
    )
    traceOverlay('overlay_situational_misuse_warning', {
      overlayId: def.id,
      minZoom: def.minZoom,
      message: 'situational overlay should not have minZoom',
    })
  }

  const valid = errors.length === 0

  if (!valid) {
    traceOverlay('overlay_schema_invalid', {
      overlayId: def.id,
      renderMode: def.renderMode,
      errorCount: errors.length,
      warningCount: warnings.length,
    })
  }

  return { valid, warnings, errors }
}

/**
 * Validate the entire overlay catalog.
 *
 * Returns aggregate results and blocks startup only on critical errors.
 * Warnings are logged but do not block.
 */
export function validateOverlayCatalog(
  catalog: EnvironmentalOverlayDef[]
): {
  valid: boolean
  results: Map<string, ValidationResult>
  totalErrors: number
  totalWarnings: number
  blockingErrors: string[]
} {
  const results = new Map<string, ValidationResult>()
  let totalErrors = 0
  let totalWarnings = 0
  const blockingErrors: string[] = []

  for (const def of catalog) {
    const result = validateOverlayDefinition(def)
    results.set(def.id, result)

    totalErrors += result.errors.length
    totalWarnings += result.warnings.length

    if (!result.valid) {
      blockingErrors.push(...result.errors)
    }
  }

  const valid = totalErrors === 0

  // Log aggregate forensics
  traceOverlay('overlay_catalog_validation_complete', {
    totalOverlays: catalog.length,
    totalErrors,
    totalWarnings,
    valid,
  })

  return { valid, results, totalErrors, totalWarnings, blockingErrors }
}

/**
 * Runtime assertion to detect if situational overlay is being zoom-gated.
 * Call this from zoom gate logic to detect misclassification at runtime.
 */
export function assertSituationalNoZoomGate(
  overlayId: string,
  renderMode: OverlayRenderMode,
  zoomCheckPerformed: boolean
): void {
  if (renderMode === 'situational' && zoomCheckPerformed) {
    const error = `CRITICAL: Situational overlay "${overlayId}" is being zoom-gated. ` +
      `This violates the renderMode taxonomy. Fix the classification or remove the zoom gate.`

    traceOverlay('overlay_situational_misuse_warning', {
      overlayId,
      renderMode,
      violation: 'zoom_gate_applied_to_situational',
      message: error,
    })

    // In development, throw to catch immediately
    if (import.meta.env.DEV) {
      throw new Error(error)
    }

    // In production, log but don't crash - the overlay should still render
    console.error(`[OVERLAY VALIDATOR] ${error}`)
  }
}
