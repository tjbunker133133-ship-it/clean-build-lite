import type { DockIntentContext, DockRequestSource } from './InteractionController'

// This is the single source of truth for all interaction + docking decisions.
// Any new interaction behavior MUST be implemented here, not in UI components.
export function resolveDockIntent(source: DockRequestSource, context: DockIntentContext): boolean {
  // Mobile field contract: docking is explicit-only via minimize button.
  // Drag/toggle docking remains desktop-only to avoid accidental side grabs.
  const allowed = context.isMobile ? source === 'minimize' : true
  if (import.meta.env.DEV) {
    console.log('[DOCK REQUEST]', { source, allowed })
  }
  return allowed
}

