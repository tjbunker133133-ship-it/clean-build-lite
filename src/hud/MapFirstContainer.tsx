/**
 * MapFirstContainer - Recommended Mode Layout Authority
 * 
 * TRUE MAP-FIRST ARCHITECTURE:
 * - Map occupies 100% viewport with ZERO layout constraints
 * - NO dock system involvement
 * - NO cockpit shell layout
 * - UI exists ONLY as transient overlays
 * - ZERO layout shift when UI opens/closes
 * 
 * SAFETY:
 * - Additive only - doesn't modify Tier 1 systems
 * - Uses CSS containment for performance
 * - Respects safe areas on mobile devices
 */

import { ReactNode, useEffect } from 'react'
import { useHudPresentation } from '../context/HudPresentationContext'
import { cssEasing, getMotionProfile } from '../perception/motion/motionLanguage'

interface MapFirstContainerProps {
  children: ReactNode
  mapComponent: ReactNode
}

const CONTAINER_ID = 'map-first-container'
const STYLE_ID = 'map-first-container-styles'

export function MapFirstContainer({ children, mapComponent }: MapFirstContainerProps) {
  const { mode, layoutRules } = useHudPresentation()
  const isRecommendedMode = mode === 'immersive'
  const isMapFullscreen = layoutRules?.mapFullscreen ?? false

  // Inject container styles for true edge-to-edge map
  useEffect(() => {
    if (typeof document === 'undefined') return

    // Only apply in recommended mode
    if (!isRecommendedMode || !isMapFullscreen) return

    // Inject styles once
    if (!document.getElementById(STYLE_ID)) {
      const motion = getMotionProfile('modern')
      const panelEasing = cssEasing('organismEaseOut')
      const settleEasing = cssEasing('organismSettle')
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        /* ═══════════════════════════════════════════════
           MAP-FIRST CONTAINER: TRUE EDGE-TO-EDGE
           ═══════════════════════════════════════════════ */

        #${CONTAINER_ID} {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          overflow: hidden !important;
          /* Map is background layer */
          z-index: 0 !important;
        }

        /* Map layer: TRUE fullscreen, no constraints */
        #${CONTAINER_ID} .map-layer {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100% !important;
          height: 100% !important;
          z-index: 0 !important;
          /* GPU acceleration for smooth rendering */
          transform: translateZ(0) !important;
          will-change: transform !important;
        }

        /* Overlay layer: UI floats above map */
        #${CONTAINER_ID} .overlay-layer {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100% !important;
          height: 100% !important;
          z-index: 1 !important;
          /* Allow pointer events to pass through to map where no UI */
          pointer-events: none !important;
          /* Containment for performance */
          contain: layout style paint !important;
        }

        /* Interactive elements in overlay layer */
        #${CONTAINER_ID} .overlay-layer > *:not(.hud-pointer-pass-through) {
          pointer-events: auto !important;
        }

        /* Safe area: individual overlays handle insets — avoid overlay-layer padding jump */
        @supports (padding-top: env(safe-area-inset-top)) {
          #${CONTAINER_ID} .micro-status-bar {
            padding-top: env(safe-area-inset-top) !important;
          }
        }

        /* ═══════════════════════════════════════════════
           MICRO STATUS BAR: Fixed at top
           ═══════════════════════════════════════════════ */

        #${CONTAINER_ID} .modern-micro-bar {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          height: 28px !important;
          z-index: 100 !important;
          background: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0.28) 0%,
            transparent 100%
          ) !important;
          border-bottom: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          pointer-events: none !important;
        }

        #${CONTAINER_ID} .modern-micro-bar > * {
          pointer-events: auto !important;
        }

        #${CONTAINER_ID} .balanced-micro-bar {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          height: 40px !important;
          z-index: 100 !important;
        }

        /* Legacy micro-status-bar fallback */
        #${CONTAINER_ID} .micro-status-bar:not(.modern-micro-bar):not(.balanced-micro-bar) {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          height: 32px !important;
          z-index: 100 !important;
          background: linear-gradient(
            to bottom,
            rgba(10, 12, 14, 0.9) 0%,
            rgba(10, 12, 14, 0.5) 50%,
            transparent 100%
          ) !important;
          border-bottom: 1px solid rgba(148, 193, 207, 0.08) !important;
          backdrop-filter: blur(8px) saturate(1.2) !important;
          -webkit-backdrop-filter: blur(8px) saturate(1.2) !important;
          font-family: system-ui, -apple-system, sans-serif !important;
          font-size: 11px !important;
          font-weight: 500 !important;
          letter-spacing: 0.01em !important;
          display: flex !important;
          align-items: center !important;
          padding: 0 16px !important;
          gap: 16px !important;
        }

        /* ═══════════════════════════════════════════════
           SOS CONTROL: Fixed bottom-right
           ═══════════════════════════════════════════════ */

        #${CONTAINER_ID} .sos-anchor {
          position: fixed !important;
          bottom: max(16px, env(safe-area-inset-bottom, 16px)) !important;
          right: max(16px, env(safe-area-inset-right, 16px)) !important;
          z-index: 1000 !important;
        }

        #${CONTAINER_ID} .sos-button {
          width: 56px !important;
          height: 56px !important;
          border-radius: 50% !important;
          border: 2px solid rgba(255, 107, 107, 0.5) !important;
          background: rgba(255, 107, 107, 0.15) !important;
          backdrop-filter: blur(4px) !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 20px !important;
          color: #ff6b6b !important;
          cursor: pointer !important;
          transition: all ${motion.fadeFastMs}ms ${settleEasing} !important;
          box-shadow: 0 4px 16px rgba(255, 107, 107, 0.2) !important;
        }

        #${CONTAINER_ID} .sos-button:hover {
          background: rgba(255, 107, 107, 0.25) !important;
          border-color: rgba(255, 107, 107, 0.7) !important;
          transform: scale(1.05) !important;
          box-shadow: 0 6px 20px rgba(255, 107, 107, 0.3) !important;
        }

        #${CONTAINER_ID} .sos-button:active {
          transform: scale(0.95) !important;
        }

        /* ═══════════════════════════════════════════════
           RADIAL MENU: Floating centered
           ═══════════════════════════════════════════════ */

        #${CONTAINER_ID} .radial-menu-container {
          position: fixed !important;
          z-index: 5000 !important;
          /* Centered positioning handled by component */
        }

        /* ═══════════════════════════════════════════════
           TRANSIENT PANELS: Floating cards
           ═══════════════════════════════════════════════ */

        #${CONTAINER_ID} .transient-panel {
          position: fixed !important;
          background: rgba(14, 16, 18, 0.95) !important;
          border: 1px solid rgba(148, 193, 207, 0.12) !important;
          border-radius: 12px !important;
          backdrop-filter: blur(12px) saturate(1.1) !important;
          -webkit-backdrop-filter: blur(12px) saturate(1.1) !important;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
          z-index: 200 !important;
          /* Animation */
          animation: transientPanelEnter ${motion.emergenceMs}ms ${panelEasing} !important;
        }

        @keyframes transientPanelEnter {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        /* Auto-dismiss hint */
        #${CONTAINER_ID} .auto-dismiss-hint {
          position: absolute !important;
          bottom: -20px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          font-size: 10px !important;
          color: rgba(148, 193, 207, 0.5) !important;
          white-space: nowrap !important;
        }

        /* ═══════════════════════════════════════════════
           VOICE UI: Compact floating
           ═══════════════════════════════════════════════ */

        #${CONTAINER_ID} .voice-floater {
          position: fixed !important;
          bottom: max(80px, calc(env(safe-area-inset-bottom, 16px) + 64px)) !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          z-index: 300 !important;
          /* Compact styling */
          background: rgba(14, 16, 18, 0.9) !important;
          border: 1px solid rgba(148, 193, 207, 0.1) !important;
          border-radius: 24px !important;
          padding: 8px 16px !important;
          backdrop-filter: blur(8px) !important;
          /* Typography */
          font-size: 12px !important;
          color: rgba(232, 244, 248, 0.8) !important;
          /* Animation */
          transition: opacity ${motion.fadeMediumMs}ms ${settleEasing}, transform ${motion.fadeMediumMs}ms ${settleEasing} !important;
        }

        #${CONTAINER_ID} .voice-floater.inactive {
          opacity: 0.5 !important;
        }

        #${CONTAINER_ID} .voice-floater.active {
          opacity: 1 !important;
          box-shadow: 0 0 20px rgba(125, 255, 138, 0.2) !important;
        }

        /* ═══════════════════════════════════════════════
           MAP CONTROLS: Clean minimal
           ═══════════════════════════════════════════════ */

        #${CONTAINER_ID} .maplibregl-ctrl-group {
          background: rgba(14, 16, 18, 0.9) !important;
          border: 1px solid rgba(148, 193, 207, 0.1) !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
          overflow: hidden !important;
        }

        #${CONTAINER_ID} .maplibregl-ctrl-group button {
          background: transparent !important;
          border-bottom: 1px solid rgba(148, 193, 207, 0.08) !important;
          color: rgba(232, 244, 248, 0.8) !important;
          transition: all ${motion.fadeFastMs}ms ${settleEasing} !important;
        }

        #${CONTAINER_ID} .maplibregl-ctrl-group button:hover {
          background: rgba(148, 193, 207, 0.1) !important;
          color: #fff !important;
        }

        #${CONTAINER_ID} .maplibregl-ctrl-group button:last-child {
          border-bottom: none !important;
        }

        /* Compass control */
        #${CONTAINER_ID} .maplibregl-ctrl-compass {
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3)) !important;
        }

        /* ═══════════════════════════════════════════════
           ATTRIBUTION: Minimal
           ═══════════════════════════════════════════════ */

        #${CONTAINER_ID} .maplibregl-ctrl-attrib {
          background: rgba(10, 12, 14, 0.7) !important;
          font-size: 9px !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
        }

        #${CONTAINER_ID} .maplibregl-ctrl-attrib a {
          color: rgba(148, 193, 207, 0.6) !important;
        }

        /* ═══════════════════════════════════════════════
           ACCESSIBILITY
           ═══════════════════════════════════════════════ */

        @media (prefers-reduced-motion: reduce) {
          #${CONTAINER_ID} .transient-panel {
            animation: none !important;
          }
          
          #${CONTAINER_ID} .sos-button,
          #${CONTAINER_ID} .voice-floater {
            transition: none !important;
          }
        }

        /* High contrast mode */
        @media (prefers-contrast: high) {
          #${CONTAINER_ID} .micro-status-bar {
            background: rgba(10, 12, 14, 1) !important;
            border-bottom: 1px solid rgba(232, 244, 248, 0.3) !important;
          }
          
          #${CONTAINER_ID} .transient-panel {
            border: 1px solid rgba(232, 244, 248, 0.5) !important;
          }
        }
      `
      document.head.appendChild(style)
    }

    // Set container data attribute for CSS targeting
    const root = document.documentElement
    root.setAttribute('data-map-first-active', 'true')

    return () => {
      root.removeAttribute('data-map-first-active')
    }
  }, [isRecommendedMode, isMapFullscreen])

  // If not in recommended mode or map isn't fullscreen, render children normally
  if (!isRecommendedMode || !isMapFullscreen) {
    return <>{children}</>
  }

  // Recommended mode: TRUE map-first layout
  return (
    <div id={CONTAINER_ID} className="map-first-container">
      {/* Map layer: TRUE edge-to-edge, no constraints */}
      <div className="map-layer" role="region" aria-label="Map">
        {mapComponent}
      </div>

      {/* Overlay layer: UI floats above, pointer-events pass-through */}
      <div className="overlay-layer" role="region" aria-label="UI Overlays">
        {children}
      </div>
    </div>
  )
}

export default MapFirstContainer
