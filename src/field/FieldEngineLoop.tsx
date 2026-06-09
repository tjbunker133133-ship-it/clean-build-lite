/**
 * Boots the Spatial Field Engine rAF loop when Balanced or Modern layers are active.
 * Classic layer: engine remains idle (zero influence).
 */

import { useEffect } from 'react'
import { publishPhase7Diagnostics } from '../runtime/phase7Diagnostics'
import { startSpatialFieldEngine, stopSpatialFieldEngine } from './SpatialFieldEngine'

export function FieldEngineLoop() {
  useEffect(() => {
    publishPhase7Diagnostics()
    startSpatialFieldEngine()
    return () => stopSpatialFieldEngine()
  }, [])
  return null
}
