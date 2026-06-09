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
 * - SOS (persistent, non-draggable)
 * - Top status strip
 */

import React, { Suspense, lazy, useState, useCallback } from 'react'
import { useHudPresentation } from '../context/HudPresentationContext'
import { layerZ } from '../lib/presentationIsolation/zIndexLayers'
import { AtmosphericEnvironment } from './modernMode/AtmosphericEnvironment'
import { ModernFieldMotionLayer } from './modernMode/ModernFieldMotionLayer'
import { ModernFieldNativeCompositor } from './modernMode/ModernFieldNativeCompositor'
import { ModernDirectionalAtmosphere } from './modernMode/ModernDirectionalAtmosphere'
import { ModernFieldPresence } from './modernMode/ModernFieldPresence'
import { ModernSubstrateVeil } from './modernMode/ModernSubstrateVeil'
import { EnvironmentalReactionLayer } from './modernMode/EnvironmentalReactionLayer'
import { ModernActiveLayersChip } from './modernMode/ModernActiveLayersChip'
import { ModernMeasureChip } from './modernMode/ModernMeasureChip'
import { ModernMapTapPulse } from './modernMode/ModernMapTapPulse'
import { ModernTrailInspectLayer } from './modernMode/ModernTrailInspectLayer'

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
      {/* Field-native stack — field primary, geography embedded inside */}
      <ModernFieldNativeCompositor />
      <ModernDirectionalAtmosphere />
      <ModernSubstrateVeil />
      <ModernFieldPresence />
      <ModernFieldMotionLayer />
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

/**
 * Modern Mode Top Bar
 * Clean minimal status strip
 */
export function ModernTopBar() {
  return (
    <header className="modern-top-bar">
      {/* GPS status */}
      <div className="status-group">
        <GPSIndicator />
      </div>
      
      {/* Mission/Team status */}
      <div className="status-group">
        <MissionStatus />
      </div>
      
      {/* Battery/Connectivity */}
      <div className="status-group">
        <BatteryIndicator />
        <ConnectivityIndicator />
      </div>
    </header>
  )
}

function GPSIndicator() {
  // TODO: Wire to actual GPS context
  return (
    <div className="gps-indicator">
      <span className="gps-icon">◉</span>
      <span className="gps-status">GPS Active</span>
    </div>
  )
}

function MissionStatus() {
  // TODO: Wire to mission context
  return (
    <div className="mission-status">
      <span className="mission-icon">⌘</span>
      <span className="mission-label">Ready</span>
    </div>
  )
}

function BatteryIndicator() {
  // TODO: Wire to battery API
  return (
    <div className="battery-indicator">
      <span className="battery-icon">🔋</span>
      <span className="battery-level">85%</span>
    </div>
  )
}

function ConnectivityIndicator() {
  // TODO: Wire to connectivity context
  return (
    <div className="connectivity-indicator online">
      <span className="conn-icon">●</span>
    </div>
  )
}

/**
 * Modern Mode SOS Control
 * Fixed position, non-draggable, always accessible
 */
export function ModernSOSControl() {
  const [isActive, setIsActive] = useState(false)
  
  const handleSOSClick = () => {
    setIsActive(true)
    // TODO: Wire to actual SOS activation
  }
  
  if (isActive) {
    return (
      <div className="modern-sos-active">
        <div className="sos-countdown">
          <span className="sos-text">SOS ACTIVATING</span>
          <span className="sos-timer">3</span>
        </div>
        <button className="sos-cancel" onClick={() => setIsActive(false)}>
          CANCEL
        </button>
      </div>
    )
  }
  
  return (
    <button 
      className="modern-sos-button"
      onClick={handleSOSClick}
      aria-label="Activate SOS Emergency Signal"
    >
      <span className="sos-icon">🆘</span>
      <span className="sos-label">SOS</span>
    </button>
  )
}

/**
 * Modern Mode Voice Indicator
 * Floating pill when listening/speaking
 */
export function ModernVoiceIndicator() {
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle')
  
  // TODO: Wire to actual voice state
  
  if (voiceState === 'idle') {
    return (
      <button 
        className="modern-voice-pill idle"
        onClick={() => setVoiceState('listening')}
        aria-label="Activate voice commands"
      >
        <span className="voice-icon">🎤</span>
      </button>
    )
  }
  
  return (
    <div className={`modern-voice-pill ${voiceState}`}>
      <span className="voice-icon">
        {voiceState === 'listening' && '🔴'}
        {voiceState === 'processing' && '⚙️'}
        {voiceState === 'speaking' && '🔊'}
      </span>
      <span className="voice-text">
        {voiceState === 'listening' && 'Listening...'}
        {voiceState === 'processing' && 'Processing...'}
        {voiceState === 'speaking' && 'Speaking...'}
      </span>
    </div>
  )
}

export default ModernModeOverlays
