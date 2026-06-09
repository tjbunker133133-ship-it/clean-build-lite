import { useSyncExternalStore } from 'react'
import { fieldEngineActive, resolveFieldLayerMode } from '../field/fieldLayerPolicy'
import {
  getRecursiveFieldSnapshot,
  subscribeRecursiveField,
} from '../field/recursive/RecursiveFieldDynamics'
import type { RecursiveFieldSnapshot } from '../field/recursive/types'
import {
  getSpatialFieldSnapshot,
  subscribeSpatialField,
} from '../field/SpatialFieldEngine'
import type { SpatialFieldSnapshot } from '../field/types'

function getFieldSnapshot(): RecursiveFieldSnapshot | SpatialFieldSnapshot {
  if (!fieldEngineActive(resolveFieldLayerMode())) {
    return getSpatialFieldSnapshot()
  }
  return getRecursiveFieldSnapshot()
}

function subscribeField(listener: () => void): () => void {
  const unsubBase = subscribeSpatialField(listener)
  const unsubRecursive = subscribeRecursiveField(listener)
  return () => {
    unsubBase()
    unsubRecursive()
  }
}

/** Derived spatial field snapshot (recursive when active) — NOT authoritative. */
export function useSpatialField() {
  return useSyncExternalStore(subscribeField, getFieldSnapshot, getFieldSnapshot)
}
