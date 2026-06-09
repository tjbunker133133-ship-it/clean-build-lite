/**
 * ModernShell — TRUE immersive runtime boundary.
 *
 * Owns Modern presentation: environmental frame, situational context,
 * interaction layer, safety zone, overlays, and command palette.
 * Does NOT inherit legacy cockpit, dock, or panel systems.
 */

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppContext } from '../../context/AppContext'
import { useDeadMan } from '../../hooks/useDeadMan'
import { useTacticalProfile } from '../../hooks/useTacticalProfile'
import { dispatchModernRescue } from '../../lib/modernRescueBridge'
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
import { useModernFieldIntelligence } from './useModernFieldIntelligence'

const CommandPalette = lazy(() => import('../CommandPalette'))

function ModernFieldIntelligenceBridge({
  deadmanState,
}: {
  deadmanState: 'idle' | 'armed' | 'warning' | 'critical'
}) {
  useModernFieldIntelligence({ deadmanState })
  return null
}

export type ModernShellProps = ModernModeOverlaysProps

export function ModernShell({
  activeOverlay,
  onCloseOverlay,
  onOpenOverlay,
  preflightOpen = false,
  onClosePreflight,
}: ModernShellProps) {
  const { state: appState, setPendingType } = useAppContext()
  const { operationalReady } = useTacticalProfile()
  useModernDeviceDensity()
  useModernERLRuntime()
  const armedToolSyncedRef = useRef(false)

  const deadMan = useDeadMan(() => {
    void dispatchModernRescue('DEADMAN', { profileOperational: operationalReady })
  })

  const deadManUi = useMemo(() => {
    const maxSeconds = Math.max(1, Math.round(deadMan.durationMs / 1000))
    const secondsLeft = Math.max(0, Math.round(deadMan.remainingMs / 1000))
    let state: 'idle' | 'armed' | 'warning' | 'critical' = 'idle'
    if (deadMan.isActive) {
      if (deadMan.isCritical || deadMan.isExpired) state = 'critical'
      else if (deadMan.isWarning) state = 'warning'
      else state = 'armed'
    }
    return { secondsLeft, maxSeconds, state }
  }, [
    deadMan.durationMs,
    deadMan.remainingMs,
    deadMan.isActive,
    deadMan.isCritical,
    deadMan.isExpired,
    deadMan.isWarning,
  ])

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
        <ModernFieldIntelligenceBridge deadmanState={deadManUi.state} />
        <ModernFieldEntrySequence />
        <ModernEnvironmentalFrame />
        <ModernTopBar />
        <ModernInteractionHost
          activeOverlay={activeOverlay}
          onOpenOverlay={handleOpenOverlay}
        />
        <EnvironmentalInteractionLayer />
        <ModernSafetyZone
          deadmanSeconds={deadManUi.maxSeconds - deadManUi.secondsLeft}
          deadmanMaxSeconds={deadManUi.maxSeconds}
          deadmanState={deadManUi.state}
          onDeadmanPing={() => deadMan.reset()}
        />
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
