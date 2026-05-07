// This is the single source of truth for all interaction + docking decisions.
// Any new interaction behavior MUST be implemented here, not in UI components.
export type DockRequestSource = 'drag' | 'minimize' | 'toggle' | 'programmatic'

export type DockIntentContext = {
  isMobile: boolean
}

export type InteractionController = {
  onDragStart(run: () => void): void
  onDragMove(run: () => void): void
  onDragEnd(run: () => void): void
  onDockRequest(source: DockRequestSource): boolean
  onResize(run: () => void): void
  onPanelCommitPosition(run: () => void): void
}

