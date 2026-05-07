import type { DockRequestSource, InteractionController } from './InteractionController'
import { resolveDockIntent } from './resolveDockIntent'

export class DesktopInteractionController implements InteractionController {
  onDragStart(run: () => void): void {
    if (import.meta.env.DEV) console.log('[DRAG FLOW]', 'start')
    run()
  }

  onDragMove(run: () => void): void {
    if (import.meta.env.DEV) console.log('[DRAG FLOW]', 'move')
    run()
  }

  onDragEnd(run: () => void): void {
    if (import.meta.env.DEV) console.log('[DRAG FLOW]', 'end')
    run()
  }

  onDockRequest(_source: DockRequestSource): boolean {
    return resolveDockIntent(_source, { isMobile: false })
  }

  onResize(run: () => void): void {
    run()
  }

  onPanelCommitPosition(run: () => void): void {
    run()
  }
}

