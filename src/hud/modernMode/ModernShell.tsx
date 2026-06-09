/**
 * ModernShell — TRUE immersive runtime boundary.
 *
 * Owns Modern presentation: environmental frame, situational context,
 * interaction layer, safety zone, overlays, and command palette.
 * Does NOT inherit legacy cockpit, dock, or panel systems.
 */

import React, { Suspense, lazy, useCallback, useEffect, useRef } from 'react'
import { useAppContext } from '../../context/AppContext'
import { ModernRoot } from '../../lib/presentationIsolation'
import { setModernActiveTool } from '../../lib/modernToolBridge'
import { ModernSituationalProvider } from './ModernSituationalContext'
import { ModernEnvironmentalFrame } from './ModernEnvironmentalFrame'
import { ModernFieldEntrySequence } from './ModernFieldEntrySequence'
import { useModernDeviceDensity } from './useModernDeviceDensity'
import { useModernERLRuntime } from './erl/useModernERLRuntime'
import ModernTopBar from './ModernTopBar'
import { EnvironmentalInteractionLayer } from '../EnvironmentalInteractionLayer'
import { ModernSafetyZone } from '../ModernSafetyZone'
import {
  ModernModeOverlays,
  type ModernModeOverlaysProps,
} from '../ModernModeOverlays'
import { ModernInteractionHost } from '../../modern/interaction/ModernInteractionHost'

const CommandPalette = lazy(() => import('../CommandPalette'))

export type ModernShellProps = ModernModeOverlaysProps

export function ModernShell({
  activeOverlay,
  onCloseOverlay,
  onOpenOverlay,
  preflightOpen = false,
  onClosePreflight,
}: ModernShellProps) {
  const { state: appState, setPendingType } = useAppContext()
  useModernDeviceDensity()
  useModernERLRuntime()
  const armedToolSyncedRef = useRef(false)

  // Mirror BalancedLayer armed-waypoint restore → OSG drop mode on Modern entry.
  useEffect(() => {
    if (armedToolSyncedRef.current || !appState.keepWaypointToolArmed) return
    armedToolSyncedRef.current = true
    setModernActiveTool('waypoint')
    const pending = appState.pendingWaypointType
    setPendingType(pending && pending !== 'default' ? pending : 'pin')
  }, [appState.keepWaypointToolArmed, appState.pendingWaypointType, setPendingType])

  const handleOpenOverlay = useCallback(
    (id: string) => {
      onOpenOverlay?.(id)
    },
    [onOpenOverlay],
  )

  return (
    <ModernRoot>
      <ModernSituationalProvider>
        <ModernFieldEntrySequence />
        <ModernEnvironmentalFrame />
        <ModernTopBar />
        <ModernInteractionHost
          activeOverlay={activeOverlay}
          onOpenOverlay={handleOpenOverlay}
        />
        <EnvironmentalInteractionLayer />
        <ModernSafetyZone />
        <ModernModeOverlays
          activeOverlay={activeOverlay}
          onCloseOverlay={onCloseOverlay}
          onOpenOverlay={handleOpenOverlay}
          preflightOpen={preflightOpen}
          onClosePreflight={onClosePreflight}
        />
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      </ModernSituationalProvider>
    </ModernRoot>
  )
}

export default ModernShell
