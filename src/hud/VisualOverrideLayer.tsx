/**
 * Visual Override Layer - Phase 3 Visual Authority
 *
 * FINAL VISUAL AUTHORITY LAYER for HUD presentation modes.
 * Wins over all persistence, layout engines, and Tier 1 state.
 *
 * SAFETY:
 * - Pure CSS/visual — no behavioral changes
 * - Additive only — removal restores original behavior
 * - Does NOT modify CockpitContext, dock engine, or Tier 1
 * - Uses data attributes for CSS targeting
 * - Runs AFTER all other systems in render pipeline
 *
 * PURPOSE:
 * This layer exists because presentation layer was losing final render authority
 * to Tier 1 persistence + layout engine. It provides a guaranteed visual state
 * regardless of internal state complexity.
 */

import { useEffect } from 'react'
import { useHudPresentation } from '../context/HudPresentationContext'

/** Style element ID for visual override CSS */
const STYLE_ID = 'visual-override-styles'

/**
 * Applies final visual overrides to guarantee presentation mode appearance.
 * This component renders nothing but injects CSS and sets data attributes.
 */
export function VisualOverrideLayer(): null {
  const { mode } = useHudPresentation()

  // Apply visual overrides via data attributes and CSS injection
  useEffect(() => {
    if (typeof document === 'undefined') return

    const root = document.documentElement

    // Always set the hud mode data attribute for CSS targeting
    root.setAttribute('data-hud-mode', mode)

    // Inject comprehensive override styles (once)
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        /* ================================================
           VISUAL OVERRIDE LAYER - Phase 3 Authority
           These rules win over all other styling.
           ================================================= */

        /* ───────────────────────────────────────────────
           HYBRID MODE: Hard visual contract
           Map dominant, dock minimized, panels reduced
           ─────────────────────────────────────────────── */

        html[data-hud-mode="hybrid"] {
          /* CSS variable override for dock width */
          --dock-width: 72px !important;
          --dock-max-width: 72px !important;
          --panel-opacity-max: 0.85 !important;
        }

        /* DOCK: Force minimal footprint in hybrid mode */
        html[data-hud-mode="hybrid"] .cockpit-dock {
          width: 72px !important;
          max-width: 72px !important;
          min-width: 72px !important;
          overflow: hidden !important;
        }

        html[data-hud-mode="hybrid"] .cockpit-dock-left,
        html[data-hud-mode="hybrid"] .cockpit-dock-right {
          width: 72px !important;
          max-width: 72px !important;
          min-width: 72px !important;
          overflow: hidden !important;
        }

        /* DOCK STRIP: Reduce visual weight */
        html[data-hud-mode="hybrid"] .cockpit-dock-strip {
          opacity: 0.35 !important;
          width: 72px !important;
          max-width: 72px !important;
          backdrop-filter: none !important;
          background: rgba(8, 10, 11, 0.5) !important;
          border-color: rgba(199, 206, 198, 0.08) !important;
          transition: opacity 200ms ease !important;
        }

        html[data-hud-mode="hybrid"] .cockpit-dock-strip:hover {
          opacity: 0.75 !important;
          background: rgba(8, 10, 11, 0.75) !important;
        }

        /* PANELS: Reduced opacity for visual humility (NO transform - preserves dock translateX) */
        html[data-hud-mode="hybrid"] .cockpit-panel {
          opacity: 0.9 !important;
          /* transform intentionally NOT overridden - dock strip uses translateX */
          transition: opacity 200ms ease !important;
        }

        html[data-hud-mode="hybrid"] .cockpit-panel:hover {
          opacity: 0.98 !important;
        }

        /* PANEL HEADERS: More compact */
        html[data-hud-mode="hybrid"] .cockpit-panel [role="banner"] {
          padding: 6px 10px !important;
          min-height: 32px !important;
        }

        /* MAP CONTAINER: Full inset, no dock spacing */
        html[data-hud-mode="hybrid"] .map-container,
        html[data-hud-mode="hybrid"] [class*="map-container"],
        html[data-hud-mode="hybrid"] .maplibregl-map {
          inset: 0 !important;
          left: 0 !important;
          right: 0 !important;
        }

        /* TOPBAR: Force micro status (36px) - never full cockpit bar */
        html[data-hud-mode="hybrid"] .cockpit-topbar,
        html[data-hud-mode="hybrid"] [class*="topbar"],
        html[data-hud-mode="hybrid"] [class*="TopBar"] {
          height: 40px !important;
          max-height: 40px !important;
          min-height: 40px !important;
        }

        html[data-hud-mode="hybrid"] .balanced-micro-bar {
          height: 40px !important;
          background: rgba(10, 12, 13, 0.94) !important;
          border-bottom: 1px solid rgba(125, 255, 138, 0.12) !important;
        }

        html[data-hud-mode="hybrid"] [data-balanced-workspace-bar] {
          margin-top: 4px !important;
        }

        html[data-hud-mode="hybrid"] [data-balanced-quick-actions] {
          border-color: rgba(125, 255, 138, 0.22) !important;
        }

        /* MINIMIZED PANELS: Ensure they stay minimized visually */
        html[data-hud-mode="hybrid"] .cockpit-panel[data-minimized="true"],
        html[data-hud-mode="hybrid"] .cockpit-panel.minimized {
          opacity: 0.7 !important;
          /* transform intentionally NOT overridden - dock strip uses translateX */
        }

        /* COCKPIT HUD SHELL: Adjust for hybrid layout */
        html[data-hud-mode="hybrid"] .cockpit-hud-shell {
          /* Ensure shell doesn't constrain map */
          pointer-events: none !important;
        }

        /* Ensure shell children can receive pointer events */
        html[data-hud-mode="hybrid"] .cockpit-hud-shell > * {
          pointer-events: auto !important;
        }

        /* ───────────────────────────────────────────────
           MODERN MODE — scoped to mounted modern root only
           (no cockpit/balanced/dock simulation; those systems are unmounted)
           ─────────────────────────────────────────────── */

        [data-mode-root="modern"] {
          --hud-bg-primary: #1a1a1a;
          --hud-bg-overlay: rgba(28, 28, 30, 0.95);
          --hud-accent-safe: #34c759;
          --hud-accent-warn: #ff9500;
          --hud-accent-danger: #ff3b30;
          --hud-accent-action: #007aff;
          --hud-text-primary: #ffffff;
          --hud-text-secondary: rgba(255, 255, 255, 0.6);
          --hud-border-subtle: rgba(255, 255, 255, 0.1);
          --hud-radius-sm: 8px;
          --hud-radius-md: 12px;
          --hud-radius-lg: 16px;
          --hud-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
          --hud-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
        }

        [data-mode-root="modern"] .modern-micro-bar {
          height: 28px;
          max-height: 28px;
          min-height: 28px;
        }

        [data-mode-root="modern"] [data-compass-layer="modern"] {
          filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.35));
        }

        /* Immersive substrate — terrain stays readable; localized effects in modern-visual-override.css */
        html[data-hud-mode="immersive"] #map-first-container .maplibregl-canvas {
          filter: saturate(0.94) contrast(0.96) brightness(0.98);
        }

        html[data-hud-mode="immersive"][data-env-relief="active"] #map-first-container .maplibregl-canvas {
          filter: saturate(0.93) contrast(0.95) brightness(0.97);
        }

        @media (prefers-reduced-motion: reduce) {
          [data-mode-root="modern"] .modern-spatial-sheet > div,
          [data-mode-root="modern"] [data-sheet-layer="modern"] > div {
            animation: none !important;
            transition: none !important;
          }
        }

        /* LEGACY MODE: Dense cockpit — no micro bars */

        html[data-hud-mode="legacy"] .modern-micro-bar,
        html[data-hud-mode="legacy"] .balanced-micro-bar {
          display: none !important;
        }

        html[data-hud-mode="legacy"] [data-compass-layer="classic"] {
          min-width: 54px !important;
        }

        /* ───────────────────────────────────────────────
           BALANCED MODE: Operational panel identity
           ─────────────────────────────────────────────── */

        html[data-hud-mode="hybrid"] [data-balanced-panel] {
          border-radius: 10px !important;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.32) !important;
        }

        html[data-hud-mode="hybrid"] [data-compass-layer="balanced"] {
          border-radius: 6px !important;
        }

        /* ================================================
           ANIMATION: Smooth transitions between modes
           ================================================= */

        html[data-hud-mode] .cockpit-dock,
        html[data-hud-mode] .cockpit-panel,
        html[data-hud-mode] .cockpit-dock-strip {
          transition: all 250ms cubic-bezier(0.25, 0.1, 0.25, 1) !important;
        }

        /* ================================================
           ACCESSIBILITY: Reduced motion support
           ================================================= */

        @media (prefers-reduced-motion: reduce) {
          html[data-hud-mode] .cockpit-dock,
          html[data-hud-mode] .cockpit-panel,
          html[data-hud-mode] .cockpit-dock-strip {
            transition: none !important;
          }
        }
      `
      document.head.appendChild(style)
    }

    // Debug logging in DEV mode
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[VISUAL OVERRIDE] MODE:', mode, 'APPLIED')
    }

    return () => {
      // Cleanup: remove the data attribute (styles stay for performance)
      root.removeAttribute('data-hud-mode')
    }
  }, [mode])

  // This component renders nothing
  return null
}

export default VisualOverrideLayer
