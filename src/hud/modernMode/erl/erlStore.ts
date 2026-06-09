/**
 * ERL output store — subscribe/get for compositor and overlay consumers.
 */

import type { ERLPresentationMeta, ERLState } from './types'
import { ERL_STATE_ZERO } from './types'

type Listener = () => void

let state: ERLState = { ...ERL_STATE_ZERO }
let meta: ERLPresentationMeta = { headingDeg: null, hasHeading: false }
const listeners = new Set<Listener>()

function notify(): void {
  listeners.forEach((fn) => fn())
}

export function getERLState(): ERLState {
  return state
}

export function getERLPresentationMeta(): ERLPresentationMeta {
  return meta
}

export function setERLState(next: ERLState, nextMeta?: ERLPresentationMeta): void {
  state = next
  if (nextMeta) meta = nextMeta
  notify()
}

export function resetERLState(): void {
  state = { ...ERL_STATE_ZERO }
  meta = { headingDeg: null, hasHeading: false }
  notify()
}

export function subscribeERLState(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
