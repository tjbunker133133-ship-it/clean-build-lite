/**
 * Modern interaction host — mounts in ModernShell; owns map gestures and radial UI.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useMapContext } from '../../context/MapContext'
import { useAppContext } from '../../context/AppContext'
import { useFieldEmergence } from '../../field/useFieldEmergence'
import { useMotionLanguage } from '../../hooks/useMotionLanguage'
import { emergenceTransition } from '../../perception/motion/motionLanguage'
import { RadialIntentMenu, type RadialMenuAction } from '../../components/RadialIntentMenu'
import { installLongPressHandler, type LongPressController } from '../../lib/mapIntent/longPress'
import type { RadialMenuPosition } from '../../lib/mapIntent/types'
import {
  getMapInteractionSnapshot,
  setRadialAnchor,
  subscribeMapInteraction,
} from '../../lib/mapInteractionController'
import { registerMapInteractionOwner } from '../../lib/mapInteractionRegistry'
import { layerZ } from '../../lib/presentationIsolation/zIndexLayers'
import {
  createInitialModernInteractionState,
  handleModernRadialAction,
  MODERN_FIELD_SCAN_HOLD_MS,
  modernFieldScanIdleLabel,
  onModernIdleMapTap,
  onModernLongPressEngaged,
  onModernOverlayClosed,
  onModernOverlayOpened,
  onModernRadialDismissed,
  type ModernInteractionState,
} from './ModernInteractionController'

export type ModernInteractionHostProps = {
  activeOverlay: string | null
  onOpenOverlay?: (id: string) => void
}

export function ModernInteractionHost({
  activeOverlay,
  onOpenOverlay,
}: ModernInteractionHostProps) {
  const { map } = useMapContext()
  const { state, addWaypoint, setWaypoints } = useAppContext()
  const fieldEmergence = useFieldEmergence()
  const { layer: motionLayer, reducedMotion } = useMotionLanguage()
  const radialEmergenceTransition = emergenceTransition(motionLayer, reducedMotion)

  const [interactionState, setInteractionState] = useState<ModernInteractionState>(
    createInitialModernInteractionState,
  )
  const longPressRef = useRef<LongPressController | null>(null)
  const userControlRef = useRef(false)

  const interactionSnapshot = useSyncExternalStore(
    subscribeMapInteraction,
    getMapInteractionSnapshot,
    getMapInteractionSnapshot,
  )

  const radialOsgActive = interactionSnapshot.radialActive
  const radialMenuOpacity = radialOsgActive ? 1 : fieldEmergence.radialOpacity
  const radialMenuInteractive = radialOsgActive || radialMenuOpacity > 0.03
  const radialMenuPosition: RadialMenuPosition = interactionSnapshot.radialAnchor ?? {
    x: 0,
    y: 0,
    lng: 0,
    lat: 0,
  }

  useEffect(() => {
    return registerMapInteractionOwner({
      id: 'modern',
      showUserMarker: false,
      onIdleMapTap: onModernIdleMapTap,
    })
  }, [])

  useEffect(() => {
    if (activeOverlay) {
      setInteractionState((s) => onModernOverlayOpened(s))
    } else {
      setInteractionState((s) => onModernOverlayClosed(s))
    }
  }, [activeOverlay])

  useEffect(() => {
    if (!map) return

    const onMoveStart = (event: { originalEvent?: Event }) => {
      if (!event.originalEvent) return
      userControlRef.current = true
    }
    map.on('movestart', onMoveStart)
    return () => {
      map.off('movestart', onMoveStart)
    }
  }, [map])

  useEffect(() => {
    if (!map) return

    const container = map.getContainer()
    container?.setAttribute('data-radial-ownership', 'modern')

    const controller = installLongPressHandler(
      map,
      (position) => {
        setInteractionState((s) => onModernLongPressEngaged(s))
        setRadialAnchor(position)
      },
      { durationMs: MODERN_FIELD_SCAN_HOLD_MS },
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
      handleModernRadialAction(action, {
        map,
        radialPosition: radialMenuPosition,
        waypoints: state.waypoints,
        activeLayer: state.activeLayer,
        snapToTrailEnabled: state.snapToTrailEnabled,
        addWaypoint,
        setWaypoints,
        onOpenOverlay,
      })
      setInteractionState((s) => onModernRadialDismissed(s))
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
    setInteractionState((s) => onModernRadialDismissed(s))
  }, [])

  const idleLabel = modernFieldScanIdleLabel(interactionState.fieldScanPhase)

  return (
    <div data-modern-interaction-host data-modern-radial-host="true">
      {/* Persistent field-scan rail — behavior-driven idle affordance (not map-owned) */}
      <div
        data-modern-field-scan-rail
        data-testid="modern-field-scan-rail"
        aria-live="polite"
        style={{
          position: 'fixed',
          left: '50%',
          bottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
          transform: 'translateX(-50%)',
          zIndex: layerZ('CHROME'),
          pointerEvents: 'none',
          padding: '6px 14px',
          borderRadius: 16,
          background: 'rgba(12, 18, 22, 0.72)',
          border: '1px solid rgba(125, 200, 255, 0.14)',
          fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.04em',
          color: 'rgba(185, 220, 255, 0.82)',
          textTransform: 'uppercase',
        }}
      >
        {idleLabel}
      </div>

      {radialOsgActive && (
        <div
          style={{
            opacity: radialMenuOpacity,
            pointerEvents: radialMenuInteractive ? 'auto' : 'none',
            transition: radialEmergenceTransition,
          }}
        >
          <RadialIntentMenu
            position={radialMenuPosition}
            visible={radialMenuInteractive}
            onAction={handleRadialAction}
            onDismiss={handleRadialDismiss}
          />
        </div>
      )}
    </div>
  )
}

export default ModernInteractionHost
