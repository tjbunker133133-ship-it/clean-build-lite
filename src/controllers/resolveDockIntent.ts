import type { DockIntentContext, DockRequestSource } from './InteractionController'

// This is the single source of truth for all interaction + docking decisions.
// Any new interaction behavior MUST be implemented here, not in UI components.
export function resolveDockIntent(source: DockRequestSource, context: DockIntentContext): boolean {
  const allowed = context.isMobile ? source === 'minimize' : true
  if (import.meta.env.DEV) {
    console.log('[DOCK REQUEST]', { source, allowed })
  }
  return allowed
}

