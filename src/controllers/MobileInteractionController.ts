import type { DockRequestSource, InteractionController } from './InteractionController'
import { resolveDockIntent } from './resolveDockIntent'

export class MobileInteractionController implements InteractionController {
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

  onDockRequest(source: DockRequestSource): boolean {
    return resolveDockIntent(source, { isMobile: true })
  }

  onResize(run: () => void): void {
    run()
  }

  onPanelCommitPosition(run: () => void): void {
    run()
  }
}

