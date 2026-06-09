/**
 * Modern Mode Overlays - TRUE map-first architecture
 * 
 * NO CockpitHudPanel components
 * NO drag handles
 * NO minimize bars
 * NO resize affordances
 * NO docking
 * 
 * ONLY:
 * - Contextual sheets/cards
 * - Transient modals
 * - Voice indicator
 * - SOS (persistent, draggable — see ModernSafetyZone)
 * - Top status strip
 */

import React, { Suspense, lazy, useState, useCallback } from 'react'
import { useHudPresentation } from '../context/HudPresentationContext'
import { layerZ } from '../lib/presentationIsolation/zIndexLayers'
import { AtmosphericEnvironment } from './modernMode/AtmosphericEnvironment'
import { ModernFieldNativeCompositor } from './modernMode/ModernFieldNativeCompositor'
import { ModernDirectionalAtmosphere } from './modernMode/ModernDirectionalAtmosphere'
import { ModernFieldPresence } from './modernMode/ModernFieldPresence'
import { EnvironmentalReactionLayer } from './modernMode/EnvironmentalReactionLayer'
import { ModernActiveLayersChip } from './modernMode/ModernActiveLayersChip'
import { ModernMeasureChip } from './modernMode/ModernMeasureChip'
import { ModernMapTapPulse } from './modernMode/ModernMapTapPulse'
import { ModernTrailInspectLayer } from './modernMode/ModernTrailInspectLayer'
import { ModernAdaptiveDecor } from './modernMode/ModernAdaptiveDecor'

// Lazy load overlay content components
const WeatherSheet = lazy(() => import('./modernMode/WeatherSheet'))
const MissionSheet = lazy(() => import('./modernMode/MissionSheet'))
const CheckInCard = lazy(() => import('./modernMode/CheckInCard'))
const SituationCard = lazy(() => import('./modernMode/SituationCard'))
const LayersSheet = lazy(() => import('./modernMode/LayersSheet'))
const ModernRouteSheet = lazy(() => import('./modernMode/ModernRouteSheet'))
const PreflightWizard = lazy(() => import('./modernMode/PreflightWizard'))

export interface ModernModeOverlaysProps {
  /** Currently active overlay ID */
  activeOverlay: string | null
  /** Callback to close overlay */
  onCloseOverlay: () => void
  /** Open layers sheet (chip + shortcuts) */
  onOpenOverlay?: (id: string) => void
  /** Whether preflight wizard is open */
  preflightOpen?: boolean
  /** Callback to close preflight */
  onClosePreflight?: () => void
}

/**
 * Modern Mode Overlay System
 * 
 * Renders contextual UI as sheets/cards, NOT draggable panels.
 */
export function ModernModeOverlays({ 
  activeOverlay, 
  onCloseOverlay,
  onOpenOverlay,
  preflightOpen = false,
  onClosePreflight 
}: ModernModeOverlaysProps) {
  const { mode } = useHudPresentation()
  
  // Only render in Modern (immersive) mode
  if (mode !== 'immersive') return null

  return (
    <div className="modern-mode-overlays hud-pointer-pass-through" data-testid="modern-mode-overlays" style={{
      position: 'fixed',
      inset: 0,
      pointerEvents: 'none',
      zIndex: layerZ('CHROME'),
    }}>
      {/* Field-native stack — operational layers only; decorative gated by situational density */}
      <ModernFieldNativeCompositor />
      <ModernDirectionalAtmosphere />
      <ModernAdaptiveDecor />
      <ModernFieldPresence />
      <AtmosphericEnvironment />
      <ModernMapTapPulse />
      {/* Always-on environmental reactions — proximity, approach, GPS health */}
      <div data-modern-passive="true">
        <EnvironmentalReactionLayer />
        <ModernTrailInspectLayer />
      </div>
      {onOpenOverlay ? (
        <div data-modern-transient="true">
          <ModernActiveLayersChip onOpenLayers={() => onOpenOverlay('layers')} />
        </div>
      ) : null}
      <div data-modern-transient="true">
        <ModernMeasureChip />
      </div>
      <Suspense fallback={null}>
        {activeOverlay === 'weather' && (
          <WeatherSheet onClose={onCloseOverlay} />
        )}
        {activeOverlay === 'mission' && (
          <MissionSheet onClose={onCloseOverlay} />
        )}
        {activeOverlay === 'checkin' && (
          <CheckInCard onClose={onCloseOverlay} />
        )}
        {activeOverlay === 'situation' && (
          <SituationCard onClose={onCloseOverlay} />
        )}
        {activeOverlay === 'layers' && (
          <LayersSheet onClose={onCloseOverlay} />
        )}
        {activeOverlay === 'route' && (
          <ModernRouteSheet onClose={onCloseOverlay} />
        )}
        {preflightOpen && onClosePreflight && (
          <PreflightWizard onClose={onClosePreflight} />
        )}
      </Suspense>
    </div>
  )
}

/**
 * Modern Mode UI Controller
 * Manages which overlay is active
 */
export function useModernModeUI() {
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null)
  const [preflightOpen, setPreflightOpen] = useState(false)
  
  const openOverlay = useCallback((id: string) => {
    setActiveOverlay(id)
  }, [])
  
  const closeOverlay = useCallback(() => {
    setActiveOverlay(null)
  }, [])
  
  const toggleOverlay = useCallback((id: string) => {
    setActiveOverlay(current => current === id ? null : id)
  }, [])

  const openPreflight = useCallback(() => {
    setPreflightOpen(true)
  }, [])

  const closePreflight = useCallback(() => {
    setPreflightOpen(false)
  }, [])
  
  return {
    activeOverlay,
    preflightOpen,
    openOverlay,
    closeOverlay,
    toggleOverlay,
    openPreflight,
    closePreflight,
  }
}

export default ModernModeOverlays
