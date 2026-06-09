import { useSyncExternalStore } from 'react'
import {
  getPerceptionSnapshot,
  subscribePerception,
} from '../lib/operationalPerception/perceptionEngine'

/** Returns the stable perception snapshot (useSyncExternalStore-safe). */
export function useOperationalPerception() {
  return useSyncExternalStore(subscribePerception, getPerceptionSnapshot, getPerceptionSnapshot)
}
