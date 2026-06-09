/**
 * DEV-only ERL console bridge — window.__erl for field diagnostics.
 * Gated behind import.meta.env.DEV; never shipped to production behavior.
 */

import { getERLState } from './erlStore'
import type { EnvironmentalRelationshipLayer } from './EnvironmentalRelationshipLayer'
import type { ERLSimulationPatch, FIMRuntimeSnapshot } from './types'

export type ERLDevBridge = {
  instance: EnvironmentalRelationshipLayer
  state: () => ReturnType<typeof getERLState>
  simulate: (snap: Partial<FIMRuntimeSnapshot>, patch?: ERLSimulationPatch) => void
  clear: () => void
  activate: () => void
  handleSOSArmed: () => void
}

export function installERLDevBridge(instance: EnvironmentalRelationshipLayer): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return

  const bridge: ERLDevBridge = {
    instance,
    state: () => getERLState(),
    simulate: (snap, patch) => instance.injectSimulatedMovement(snap, patch),
    clear: () => instance.clearSimulatedMovement(),
    activate: () => instance.activate(),
    handleSOSArmed: () => instance.handleSOSArmed(),
  }

  ;(window as Window & { __erl?: ERLDevBridge }).__erl = bridge
}

export function uninstallERLDevBridge(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  delete (window as Window & { __erl?: ERLDevBridge }).__erl
}
