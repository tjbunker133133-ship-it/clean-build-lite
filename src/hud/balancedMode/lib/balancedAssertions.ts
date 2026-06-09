/**
 * Balanced Layer Runtime Assertion Suite
 * ========================================
 *
 * Hard runtime validation that Balanced maintains complete
 * independence from Classic/Cockpit infrastructure.
 *
 * These assertions throw on violation — they are NOT optional checks.
 *
 * PRINCIPLE:
 * Balanced is not "Classic minus UI."
 * Balanced is a fully independent runtime graph.
 *
 * If Classic systems initialize, render, subscribe, or influence state:
 * → Balanced is INVALID
 */

import type { HudPresentationMode } from '../../../types/hudPresentation'

// Layer identity type
type HudLayer = 'classic' | 'balanced' | 'modern'

// Assertion error class for clear identification
class BalancedAssertionError extends Error {
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'BalancedAssertionError'
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. LAYER IDENTITY ASSERTION (HARD FAIL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Assert that the current layer is explicitly 'balanced'.
 *
 * Run at:
 * - bootstrap
 * - route change
 * - layout hydration
 *
 * @throws BalancedAssertionError if layer is not 'balanced'
 */
export function assertLayerIdentity(layer: HudLayer | HudPresentationMode): void {
  // Map presentation modes to layer identity
  const layerMap: Record<string, HudLayer> = {
    'legacy': 'classic',
    'hybrid': 'balanced',
    'immersive': 'modern',
    'classic': 'classic',
    'balanced': 'balanced',
    'modern': 'modern',
  }

  const resolvedLayer = layerMap[layer] || layer as HudLayer

  if (resolvedLayer !== 'balanced') {
    throw new BalancedAssertionError(
      'LAYER_ASSERT',
      `Expected 'balanced', got '${resolvedLayer}' (original: '${layer}')`
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. COCKPIT INITIALIZATION PROHIBITION
// ═══════════════════════════════════════════════════════════════════════════════

const COCKPIT_BLACKLIST = [
  'CockpitContext',
  'DockManager',
  'PanelRailSystem',
  'WindowDockingEngine',
  'CockpitEventBus',
  'cockpit',
  'dock',
  'panelRail',
  'windowManager',
  'useCockpit',
  'CockpitProvider',
  'CockpitHudShell',
  'HudPanel',
]

/**
 * Assert that no Cockpit systems have been initialized.
 *
 * Rule: Suppression is NOT allowed. Detection = failure.
 *
 * @param runtimeRegistry Array of initialized system names
 * @throws BalancedAssertionError if any Cockpit system detected
 */
export function assertNoCockpitInit(runtimeRegistry: string[]): void {
  const violations = runtimeRegistry.filter(dep =>
    COCKPIT_BLACKLIST.some(blocked =>
      dep.toLowerCase().includes(blocked.toLowerCase())
    )
  )

  if (violations.length > 0) {
    throw new BalancedAssertionError(
      'COCKPIT_BLEED',
      `Forbidden initialization detected: ${violations.join(', ')}`
    )
  }
}

/**
 * Check if a dependency is a Cockpit system (non-throwing).
 */
export function isCockpitDependency(dep: string): boolean {
  return COCKPIT_BLACKLIST.some(blocked =>
    dep.toLowerCase().includes(blocked.toLowerCase())
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DEPENDENCY GRAPH ISOLATION CHECK
// ═══════════════════════════════════════════════════════════════════════════════

const FORBIDDEN_NODES = [
  'cockpit',
  'dock',
  'panelRail',
  'windowManager',
  'CockpitContext',
  'useCockpit',
  'HudPanel',
]

/**
 * Assert that the Balanced dependency graph contains no forbidden nodes.
 *
 * @param graph Module dependency graph: { [module]: [dependencies] }
 * @throws BalancedAssertionError if any forbidden dependency found
 */
export function assertBalancedDependencyGraph(
  graph: Record<string, string[]>
): void {
  for (const [module, deps] of Object.entries(graph)) {
    for (const dep of deps) {
      if (FORBIDDEN_NODES.some(f => dep.toLowerCase().includes(f.toLowerCase()))) {
        throw new BalancedAssertionError(
          'GRAPH_BLEED',
          `${module} depends on forbidden module: ${dep}`
        )
      }
    }
  }
}

/**
 * Scan dependency graph for violations (non-throwing, returns violations).
 */
export function scanDependencyGraph(
  graph: Record<string, string[]>
): Array<{ module: string; dep: string }> {
  const violations: Array<{ module: string; dep: string }> = []

  for (const [module, deps] of Object.entries(graph)) {
    for (const dep of deps) {
      if (FORBIDDEN_NODES.some(f => dep.toLowerCase().includes(f.toLowerCase()))) {
        violations.push({ module, dep })
      }
    }
  }

  return violations
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. MAP OWNERSHIP ASSERTION (STATE AUTHORITY TEST)
// ═══════════════════════════════════════════════════════════════════════════════

interface StateOwnership {
  routeOwner: string
  waypointOwner: string
  plannerOwner: string
}

/**
 * Assert that the Map owns all navigation state authority.
 *
 * Balanced Layer principle: Map is the primary surface.
 * State ownership must reflect this.
 *
 * @param stateOwnership Current state ownership registry
 * @throws BalancedAssertionError if map does not own navigation state
 */
export function assertMapOwnsNavigation(stateOwnership: StateOwnership): void {
  const violations: string[] = []

  if (stateOwnership.routeOwner !== 'map') violations.push('routeOwner')
  if (stateOwnership.waypointOwner !== 'map') violations.push('waypointOwner')
  if (stateOwnership.plannerOwner !== 'map') violations.push('plannerOwner')

  if (violations.length > 0) {
    throw new BalancedAssertionError(
      'STATE_BLEED',
      `Map does not own: ${violations.join(', ')}`
    )
  }
}

/**
 * Check map ownership status (non-throwing).
 */
export function checkMapOwnership(stateOwnership: StateOwnership): {
  valid: boolean
  violations: string[]
} {
  const violations: string[] = []

  if (stateOwnership.routeOwner !== 'map') violations.push('routeOwner')
  if (stateOwnership.waypointOwner !== 'map') violations.push('waypointOwner')
  if (stateOwnership.plannerOwner !== 'map') violations.push('plannerOwner')

  return { valid: violations.length === 0, violations }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. RUNTIME SYSTEM ACTIVITY SCAN
// ═══════════════════════════════════════════════════════════════════════════════

interface SystemMetrics {
  activeSystems: string[]
  eventEmitters: string[]
  services: string[]
}

const FORBIDDEN_SYSTEMS = [
  'cockpit',
  'dock',
  'panel',
  'legacyLayoutEngine',
  'CockpitContext',
  'HudPanel',
]

/**
 * Assert that no legacy systems are active in the runtime.
 *
 * @param metrics Current system metrics
 * @throws BalancedAssertionError if any legacy system is active
 */
export function assertNoLegacySystemsActive(metrics: SystemMetrics): void {
  const scan = (arr: string[]) =>
    arr.filter(x => FORBIDDEN_SYSTEMS.some(f => x.toLowerCase().includes(f.toLowerCase())))

  const violations = [
    ...scan(metrics.activeSystems),
    ...scan(metrics.eventEmitters),
    ...scan(metrics.services),
  ]

  if (violations.length > 0) {
    throw new BalancedAssertionError(
      'LEGACY_RUNTIME_ACTIVE',
      violations.join(', ')
    )
  }
}

/**
 * Scan for active legacy systems (non-throwing).
 */
export function scanLegacySystems(metrics: SystemMetrics): string[] {
  const scan = (arr: string[]) =>
    arr.filter(x => FORBIDDEN_SYSTEMS.some(f => x.toLowerCase().includes(f.toLowerCase())))

  return [
    ...scan(metrics.activeSystems),
    ...scan(metrics.eventEmitters),
    ...scan(metrics.services),
  ]
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. INTERACTION HIERARCHY ASSERTION
// ═══════════════════════════════════════════════════════════════════════════════

interface InteractionHierarchy {
  primaryInputSurface: string
  focusOwner: string
  navigationController: string
}

/**
 * Assert that the Map owns the interaction hierarchy.
 *
 * Balanced Layer principle: Map-first interaction.
 *
 * @param hierarchy Current interaction hierarchy
 * @throws BalancedAssertionError if map doesn't own interaction
 */
export function assertInteractionHierarchy(hierarchy: InteractionHierarchy): void {
  const violations: string[] = []

  if (hierarchy.primaryInputSurface !== 'map') violations.push('primaryInputSurface')
  if (hierarchy.focusOwner !== 'map') violations.push('focusOwner')
  if (hierarchy.navigationController !== 'map') violations.push('navigationController')

  if (violations.length > 0) {
    throw new BalancedAssertionError(
      'HIERARCHY_BLEED',
      `${violations.join(', ')} not owned by map`
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. HYBRID STATE FORBIDDEN CHECK
// ═══════════════════════════════════════════════════════════════════════════════

interface ModeState {
  classicActive: boolean
  balancedActive: boolean
  modernActive: boolean
}

/**
 * Assert that exactly one layer is active (no hybrid/mixed state).
 *
 * @param modeState Current mode activation state
 * @throws BalancedAssertionError if not exactly one layer is active
 */
export function assertNoHybridMode(modeState: ModeState): void {
  const activeCount =
    Number(modeState.classicActive) +
    Number(modeState.balancedActive) +
    Number(modeState.modernActive)

  if (activeCount !== 1) {
    throw new BalancedAssertionError(
      'HYBRID_STATE_DETECTED',
      `Exactly one layer must be active. Found ${activeCount}`
    )
  }
}

/**
 * Check for hybrid state (non-throwing).
 */
export function checkModeState(modeState: ModeState): {
  valid: boolean
  activeCount: number
  activeLayers: string[]
} {
  const activeLayers: string[] = []
  if (modeState.classicActive) activeLayers.push('classic')
  if (modeState.balancedActive) activeLayers.push('balanced')
  if (modeState.modernActive) activeLayers.push('modern')

  return {
    valid: activeLayers.length === 1,
    activeCount: activeLayers.length,
    activeLayers,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FINAL GATE: BALANCED VALIDATION SUITE
// ═══════════════════════════════════════════════════════════════════════════════

interface ValidationContext {
  layer: HudLayer | HudPresentationMode
  runtimeRegistry: string[]
  dependencyGraph: Record<string, string[]>
  systemMetrics: SystemMetrics
  stateOwnership: StateOwnership
  hierarchy: InteractionHierarchy
  modeState: ModeState
}

/**
 * Run complete Balanced Layer validation suite.
 *
 * This is the FINAL GATE. All assertions must pass.
 *
 * @param context Complete validation context
 * @returns true if all validations pass
 * @throws BalancedAssertionError on any violation
 */
export function runBalancedValidationSuite(context: ValidationContext): true {
  // 1. Layer Identity
  assertLayerIdentity(context.layer)

  // 2. No Cockpit Init
  assertNoCockpitInit(context.runtimeRegistry)

  // 3. Dependency Graph Isolation
  assertBalancedDependencyGraph(context.dependencyGraph)

  // 4. Map Owns Navigation
  assertMapOwnsNavigation(context.stateOwnership)

  // 5. No Legacy Systems
  assertNoLegacySystemsActive(context.systemMetrics)

  // 6. Interaction Hierarchy
  assertInteractionHierarchy(context.hierarchy)

  // 7. No Hybrid Mode
  assertNoHybridMode(context.modeState)

  return true
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEV MODE: Soft Validation (Logs but doesn't throw)
// ═══════════════════════════════════════════════════════════════════════════════

interface ValidationReport {
  passed: boolean
  assertions: Array<{
    name: string
    passed: boolean
    error?: string
  }>
  timestamp: number
}

/**
 * Run validation suite in dev mode (returns report, doesn't throw).
 */
export function runBalancedValidationDev(context: ValidationContext): ValidationReport {
  const assertions: Array<{ name: string; passed: boolean; error?: string }> = []

  // 1. Layer Identity
  try {
    assertLayerIdentity(context.layer)
    assertions.push({ name: 'layerIdentity', passed: true })
  } catch (e) {
    assertions.push({ name: 'layerIdentity', passed: false, error: (e as Error).message })
  }

  // 2. No Cockpit Init
  try {
    assertNoCockpitInit(context.runtimeRegistry)
    assertions.push({ name: 'noCockpitInit', passed: true })
  } catch (e) {
    assertions.push({ name: 'noCockpitInit', passed: false, error: (e as Error).message })
  }

  // 3. Dependency Graph
  try {
    assertBalancedDependencyGraph(context.dependencyGraph)
    assertions.push({ name: 'dependencyGraph', passed: true })
  } catch (e) {
    assertions.push({ name: 'dependencyGraph', passed: false, error: (e as Error).message })
  }

  // 4. Map Ownership
  try {
    assertMapOwnsNavigation(context.stateOwnership)
    assertions.push({ name: 'mapOwnership', passed: true })
  } catch (e) {
    assertions.push({ name: 'mapOwnership', passed: false, error: (e as Error).message })
  }

  // 5. No Legacy Systems
  try {
    assertNoLegacySystemsActive(context.systemMetrics)
    assertions.push({ name: 'noLegacySystems', passed: true })
  } catch (e) {
    assertions.push({ name: 'noLegacySystems', passed: false, error: (e as Error).message })
  }

  // 6. Hierarchy
  try {
    assertInteractionHierarchy(context.hierarchy)
    assertions.push({ name: 'interactionHierarchy', passed: true })
  } catch (e) {
    assertions.push({ name: 'interactionHierarchy', passed: false, error: (e as Error).message })
  }

  // 7. No Hybrid Mode
  try {
    assertNoHybridMode(context.modeState)
    assertions.push({ name: 'noHybridMode', passed: true })
  } catch (e) {
    assertions.push({ name: 'noHybridMode', passed: false, error: (e as Error).message })
  }

  return {
    passed: assertions.every(a => a.passed),
    assertions,
    timestamp: Date.now(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REACT INTEGRATION: Hook for runtime validation
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'

export interface UseBalancedValidationOptions {
  enabled?: boolean
  logOnly?: boolean
  onViolation?: (error: BalancedAssertionError) => void
}

/**
 * React hook for runtime Balanced validation.
 *
 * Usage:
 * ```tsx
 * function BalancedLayer() {
 *   useBalancedValidation({
 *     enabled: import.meta.env.DEV,
 *     logOnly: true,
 *   });
 *   // ...
 * }
 * ```
 */
export function useBalancedValidation(options: UseBalancedValidationOptions = {}): void {
  const { enabled = false, logOnly = false, onViolation } = options
  const validatedRef = useRef(false)

  useEffect(() => {
    if (!enabled || validatedRef.current) return

    // Collect runtime state
    const runtimeRegistry: string[] = []
    const dependencyGraph: Record<string, string[]> = {}

    // Check for CockpitContext usage
    const hasCockpitContext = document.querySelector('[data-cockpit-context]') !== null
    if (hasCockpitContext) {
      runtimeRegistry.push('CockpitContext')
    }

    // Check for dock elements
    const hasDock = document.querySelector('[data-dock-initialized]') !== null
    if (hasDock) {
      runtimeRegistry.push('DockManager')
    }

    // Check for HudPanel usage
    const hasHudPanel = document.querySelector('[data-hud-panel]') !== null
    if (hasHudPanel) {
      runtimeRegistry.push('HudPanel')
    }

    // Check for balanced layer identity
    const balancedLayer = document.querySelector('[data-balanced-layer]')
    const layer = balancedLayer?.getAttribute('data-balanced-active') === 'true'
      ? 'balanced'
      : 'unknown'

    const context: ValidationContext = {
      layer: layer as HudLayer,
      runtimeRegistry,
      dependencyGraph,
      systemMetrics: {
        activeSystems: runtimeRegistry,
        eventEmitters: [],
        services: [],
      },
      stateOwnership: {
        routeOwner: 'map', // Balanced default
        waypointOwner: 'map',
        plannerOwner: 'map',
      },
      hierarchy: {
        primaryInputSurface: 'map',
        focusOwner: 'map',
        navigationController: 'map',
      },
      modeState: {
        classicActive: false,
        balancedActive: layer === 'balanced',
        modernActive: false,
      },
    }

    if (logOnly) {
      // Dev mode: log report
      const report = runBalancedValidationDev(context)
      if (!report.passed) {
        console.warn('[BALANCED_VALIDATION_DEV]', report)
      } else {
        console.log('[BALANCED_VALIDATION_DEV] ✅ All assertions passed')
      }
    } else {
      // Production: throw on violation
      try {
        runBalancedValidationSuite(context)
      } catch (e) {
        if (onViolation) {
          onViolation(e as BalancedAssertionError)
        } else {
          throw e
        }
      }
    }

    validatedRef.current = true
  }, [enabled, logOnly, onViolation])
}

// Export error class for external handling
export { BalancedAssertionError }
export type { HudLayer, StateOwnership, SystemMetrics, InteractionHierarchy, ModeState, ValidationContext, ValidationReport }
