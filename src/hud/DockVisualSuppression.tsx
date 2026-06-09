/**
 * Dock Visual Suppression - Phase 3D
 *
 * Visually suppresses dock strips in hybrid/immersive presentation modes.
 * Does NOT modify dock engine — only applies CSS presentation layer.
 *
 * SAFETY:
 * - Pure CSS/visual — no behavioral changes
 * - Uses data attributes for styling hooks
 * - No z-index changes
 * - No pointer-events blocking
 * - Additive only — removal restores original behavior
 */

import { useEffect } from 'react'
import { useHudPresentation } from '../context/HudPresentationContext'

/**
 * Applies visual suppression styles to dock elements.
 * Uses CSS custom properties for controlled visual reduction.
 */
export function DockVisualSuppression(): null {
  const { dockCollapsed, mode } = useHudPresentation()

  // Apply suppression attributes to document for CSS targeting
  useEffect(() => {
    if (typeof document === 'undefined') return

    const root = document.documentElement

    // Set data attribute for CSS targeting
    if (dockCollapsed && (mode === 'hybrid' || mode === 'immersive')) {
      root.setAttribute('data-dock-suppressed', mode)

      // Apply suppression styles via inline style injection (dev-only CSS)
      if (!document.getElementById('dock-suppression-styles')) {
        const style = document.createElement('style')
        style.id = 'dock-suppression-styles'
        style.textContent = `
          /* Phase 3D: Dock Visual Suppression */
          [data-dock-suppressed="hybrid"] .cockpit-dock-strip,
          [data-dock-suppressed="immersive"] .cockpit-dock-strip {
            /* Reduce visual weight of dock strips */
            opacity: 0.35 !important;
            backdrop-filter: none !important;
            background: rgba(8, 10, 11, 0.6) !important;
            border-color: rgba(199, 206, 198, 0.1) !important;
          }

          [data-dock-suppressed="hybrid"] .cockpit-dock-strip:hover,
          [data-dock-suppressed="immersive"] .cockpit-dock-strip:hover {
            /* Restore visibility on hover */
            opacity: 0.85 !important;
            background: rgba(8, 10, 11, 0.85) !important;
          }

          [data-dock-suppressed="immersive"] .cockpit-dock-strip {
            /* More aggressive suppression in immersive */
            opacity: 0.15 !important;
          }

          [data-dock-suppressed="immersive"] .cockpit-dock-strip:hover {
            opacity: 0.7 !important;
          }

          /* Suppress dock strip width reservation */
          [data-dock-suppressed="hybrid"] .cockpit-dock-left,
          [data-dock-suppressed="hybrid"] .cockpit-dock-right {
            width: auto !important;
            min-width: 60px !important;
          }

          [data-dock-suppressed="immersive"] .cockpit-dock-left,
          [data-dock-suppressed="immersive"] .cockpit-dock-right {
            width: auto !important;
            min-width: 40px !important;
          }
        `
        document.head.appendChild(style)
      }
    } else {
      root.removeAttribute('data-dock-suppressed')
    }

    return () => {
      root.removeAttribute('data-dock-suppressed')
    }
  }, [dockCollapsed, mode])

  return null
}

export default DockVisualSuppression
