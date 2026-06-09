/**
 * Balanced interaction host — workspace long-press + radial (600ms hold).
 */

import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useMapContext } from '../../context/MapContext'
import { useAppContext } from '../../context/AppContext'
import { RadialIntentMenu, type RadialMenuAction } from '../../components/RadialIntentMenu'
import RadialMenuHint from '../../components/RadialMenuHint'
import { installLongPressHandler, type LongPressController } from '../../lib/mapIntent/longPress'
import { LONG_PRESS_DURATION_MS, type RadialMenuPosition } from '../../lib/mapIntent/types'
import {
  getMapInteractionSnapshot,
  setRadialAnchor,
  subscribeMapInteraction,
} from '../../lib/mapInteractionController'
import { registerMapInteractionOwner } from '../../lib/mapInteractionRegistry'
import { handleBalancedRadialAction } from './balancedRadialActions'

export type BalancedInteractionHostProps = {
  onOpenOverlay?: (id: string) => void
}

export function BalancedInteractionHost({ onOpenOverlay }: BalancedInteractionHostProps) {
  const { map } = useMapContext()
  const { state, addWaypoint, setWaypoints } = useAppContext()
  const longPressRef = useRef<LongPressController | null>(null)

  const interactionSnapshot = useSyncExternalStore(
    subscribeMapInteraction,
    getMapInteractionSnapshot,
    getMapInteractionSnapshot,
  )

  const radialOsgActive = interactionSnapshot.radialActive
  const radialMenuPosition: RadialMenuPosition = interactionSnapshot.radialAnchor ?? {
    x: 0,
    y: 0,
    lng: 0,
    lat: 0,
  }

  useEffect(() => {
    return registerMapInteractionOwner({
      id: 'balanced',
      showUserMarker: true,
    })
  }, [])

  useEffect(() => {
    if (!map) return

    const container = map.getContainer()
    container?.setAttribute('data-radial-ownership', 'balanced')

    const controller = installLongPressHandler(
      map,
      (position) => {
        setRadialAnchor(position)
      },
      { durationMs: LONG_PRESS_DURATION_MS },
    )
    longPressRef.current = controller

    return () => {
      controller.destroy()
      longPressRef.current = null
      container?.removeAttribute('data-radial-ownership')
    }
  }, [map])

  const handleRadialAction = useCallback(
    (action: RadialMenuAction) => {
      handleBalancedRadialAction(action, {
        map,
        radialPosition: radialMenuPosition,
        waypoints: state.waypoints,
        activeLayer: state.activeLayer,
        snapToTrailEnabled: state.snapToTrailEnabled,
        addWaypoint,
        setWaypoints,
        onOpenOverlay,
      })
    },
    [
      map,
      radialMenuPosition,
      state.waypoints,
      state.activeLayer,
      state.snapToTrailEnabled,
      addWaypoint,
      setWaypoints,
      onOpenOverlay,
    ],
  )

  const handleRadialDismiss = useCallback(() => {
    longPressRef.current?.unlockMapInteraction?.()
  }, [])

  return (
    <div
      data-balanced-interaction-host
      data-balanced-radial-host="true"
      style={{ pointerEvents: 'none', position: 'relative', zIndex: 0 }}
    >
      <RadialMenuHint hidden={radialOsgActive} balancedMode />
      {radialOsgActive && (
        <RadialIntentMenu
          position={radialMenuPosition}
          visible
          passThroughBackdrop
          onAction={handleRadialAction}
          onDismiss={handleRadialDismiss}
        />
      )}
    </div>
  )
}

export default BalancedInteractionHost
