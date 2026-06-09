/**
 * Operational State Graph — formal transition rules (v1.0)
 * @see OPERATIONAL_STATE_GRAPH_TRANSITION_RULES
 */

import type { OperationalMode } from './types'

export type TransitionVerdict = 'allow' | 'deny' | 'conditional'

/** FROM \ TO — spec matrix v1.0 */
export const TRANSITION_MATRIX: Record<OperationalMode, Record<OperationalMode, TransitionVerdict>> = {
  idle: {
    idle: 'allow',
    measure: 'allow',
    route: 'allow',
    mission: 'allow',
    radial: 'allow',
    navigation: 'allow',
  },
  measure: {
    idle: 'allow',
    measure: 'allow',
    route: 'deny',
    mission: 'conditional',
    radial: 'allow',
    navigation: 'allow',
  },
  route: {
    idle: 'allow',
    measure: 'deny',
    route: 'allow',
    mission: 'allow',
    radial: 'allow',
    navigation: 'allow',
  },
  mission: {
    idle: 'allow',
    measure: 'deny',
    route: 'allow',
    mission: 'allow',
    radial: 'allow',
    navigation: 'allow',
  },
  radial: {
    idle: 'allow',
    measure: 'allow',
    route: 'allow',
    mission: 'allow',
    radial: 'allow',
    navigation: 'allow',
  },
  navigation: {
    idle: 'allow',
    measure: 'deny',
    route: 'allow',
    mission: 'allow',
    radial: 'allow',
    navigation: 'allow',
  },
}

export type TransitionValidationContext = {
  measurementPointCount: number
  missionActive: boolean
}

export type TransitionValidationResult = {
  allowed: boolean
  verdict: TransitionVerdict
  reason?: string
  resolvedPath: OperationalMode[]
}

function verdictFor(from: OperationalMode, to: OperationalMode): TransitionVerdict {
  if (from === to) return 'allow'
  return TRANSITION_MATRIX[from]?.[to] ?? 'deny'
}

function evaluateConditional(
  from: OperationalMode,
  to: OperationalMode,
  ctx: TransitionValidationContext,
): { allowed: boolean; reason?: string } {
  if (from === 'measure' && to === 'mission') {
    // Measurement geometry persists in session — mode switch does not require clearing.
    return { allowed: true }
  }
  return { allowed: true }
}

/** Resolve a legal multi-hop path when direct transition is denied. */
export function resolveTransitionPath(
  from: OperationalMode,
  to: OperationalMode,
  ctx: TransitionValidationContext,
): OperationalMode[] {
  if (from === to) return [to]

  const direct = verdictFor(from, to)
  if (direct === 'allow') return [to]

  if (direct === 'conditional') {
    const cond = evaluateConditional(from, to, ctx)
    if (cond.allowed) return [to]
    // Auto-exit measure then enter mission
    if (from === 'measure' && to === 'mission') {
      return ['idle', 'mission']
    }
    return []
  }

  // Denied direct — try idle as hub (deterministic escape hatch)
  if (from !== 'idle' && to !== 'idle') {
    const toIdle = verdictFor(from, 'idle')
    const fromIdle = verdictFor('idle', to)
    if (toIdle === 'allow' && fromIdle === 'allow') return ['idle', to]
  }

  return []
}

export function validateModeTransition(
  from: OperationalMode,
  to: OperationalMode,
  ctx: TransitionValidationContext,
): TransitionValidationResult {
  if (from === to) {
    return { allowed: true, verdict: 'allow', resolvedPath: [to] }
  }

  const verdict = verdictFor(from, to)

  if (verdict === 'conditional') {
    const cond = evaluateConditional(from, to, ctx)
    if (!cond.allowed) {
      const path = resolveTransitionPath(from, to, ctx)
      if (path.length > 0) {
        return { allowed: true, verdict: 'conditional', resolvedPath: path, reason: cond.reason }
      }
      return { allowed: false, verdict: 'conditional', resolvedPath: [], reason: cond.reason }
    }
    return { allowed: true, verdict: 'conditional', resolvedPath: [to] }
  }

  if (verdict === 'allow') {
    return { allowed: true, verdict: 'allow', resolvedPath: [to] }
  }

  const path = resolveTransitionPath(from, to, ctx)
  if (path.length > 0) {
    return {
      allowed: true,
      verdict: 'deny',
      resolvedPath: path,
      reason: `resolved via ${path.join('→')}`,
    }
  }

  return {
    allowed: false,
    verdict: 'deny',
    resolvedPath: [],
    reason: `blocked transition ${from}→${to}`,
  }
}

export function pointerOwnerForMode(mode: OperationalMode, variant: 'drop' | 'inspect' | 'plan' | null): string {
  switch (mode) {
    case 'measure': return 'measure'
    case 'route': return 'route'
    case 'mission': return 'mission'
    case 'radial': return 'radial'
    case 'navigation': return 'map'
    case 'idle': return variant === 'inspect' ? 'map' : 'map'
    default: return 'map'
  }
}
