/**
 * Layer Contract Definitions — Classic / Balanced / Modern
 *
 * Authoritative matrix for layer isolation audits and e2e validation.
 * Does NOT modify runtime behavior; documents expected boundaries.
 */

export type LayerContractMode = 'legacy' | 'hybrid' | 'immersive'

export type LayerContract = {
  mode: LayerContractMode
  label: string
  purpose: string
  interactionPhilosophy: string
  cameraBehavior: string
  overlayBehavior: string
  toolbarBehavior: string
  compassBehavior: string
  sheetBehavior: string
  motionBehavior: string
  environmentalBehavior: string
  operationalToolExposure: string
  persistentUi: string
  mustNotAppear: readonly string[]
  domSelectors: {
    required: readonly string[]
    forbidden: readonly string[]
  }
}

export const LAYER_CONTRACTS: Record<LayerContractMode, LayerContract> = {
  legacy: {
    mode: 'legacy',
    label: 'Classic',
    purpose: 'Deterministic fallback cockpit with full dock and panel system',
    interactionPhilosophy: 'Explicit panels, dock geometry, keyboard shortcuts',
    cameraBehavior: 'User-controlled viewport; cockpit does not auto-immersive tilt',
    overlayBehavior: 'LayerPanel + environmental toggles in dock panels',
    toolbarBehavior: 'Full tactical TopBar with preflight and status widgets',
    compassBehavior: 'Full cockpit compass dial in TopBar',
    sheetBehavior: 'Classic HudPanel dock/minimize system',
    motionBehavior: 'Standard HUD motion; wake-word pulse on shell',
    environmentalBehavior: 'Display mode overlay + situation/weather panels',
    operationalToolExposure: 'Maximum — all panels, dock strips, voice, SOS, deadman',
    persistentUi: 'Dock, panels, full top bar, edge zones',
    mustNotAppear: [
      'modern-micro-bar',
      'data-balanced-layer',
      'data-testid="modern-mode-overlays"',
      'MapFirstContainer immersive-only chrome',
    ],
    domSelectors: {
      required: [
        '[data-mode-root="classic"]',
        '.cockpit-hud-shell',
        '[data-compass-layer="classic"]',
      ],
      forbidden: [
        '[data-mode-root="balanced"]',
        '[data-mode-root="modern"]',
        '.modern-micro-bar',
        '[data-balanced-layer]',
        '[data-compass-layer="balanced"]',
        '[data-compass-layer="modern"]',
      ],
    },
  },
  hybrid: {
    mode: 'hybrid',
    label: 'Balanced',
    purpose: 'Operational planning workspace — map-dominant with explicit tools',
    interactionPhilosophy: 'Workspace tools, side panels, measure/route/waypoint workflows',
    cameraBehavior: 'Map-first pan/zoom; no immersive-only cinematic constraints',
    overlayBehavior: 'BalancedOverlayTray + panel-driven layer toggles',
    toolbarBehavior: 'BalancedQuickActions WORKSPACE strip + 40px operational micro bar',
    compassBehavior: 'Tactical compass in balanced-micro-bar',
    sheetBehavior: 'Balanced panels and bottom sheets — not Modern transient sheets',
    motionBehavior: 'Responsive panel transitions; no immersive-only motion chips',
    environmentalBehavior: 'Critical hazard indicators only; operational overlay tray',
    operationalToolExposure: 'High — route, waypoints, mission, layers always reachable',
    persistentUi: 'Operational micro bar, workspace strip, floating panels',
    mustNotAppear: [
      'modern-micro-bar',
      'ModernModeOverlays',
      'CockpitHudShell dock strips',
      'immersive-only environmental movement chips',
    ],
    domSelectors: {
      required: [
        '[data-mode-root="balanced"]',
        '[data-balanced-layer][data-balanced-active="true"]',
        '[data-balanced-chrome="operational"]',
        '[data-balanced-workspace-bar]',
        '[data-compass-layer="balanced"]',
        '[data-balanced-panel]',
      ],
      forbidden: [
        '[data-mode-root="classic"]',
        '[data-mode-root="modern"]',
        '.modern-micro-bar',
        '[data-testid="modern-mode-overlays"]',
        '.cockpit-hud-shell',
        '[data-compass-layer="classic"]',
        '[data-compass-layer="modern"]',
        '[data-sheet-layer="modern"]',
      ],
    },
  },
  immersive: {
    mode: 'immersive',
    label: 'Modern',
    purpose: 'Immersive spatial field OS — environment over chrome',
    interactionPhilosophy: 'Contextual emergence via radial; transient overlays only',
    cameraBehavior: 'Map-first edge-to-edge; operational perception camera intents',
    overlayBehavior: 'ModernModeOverlays sheets; resilient seed-first environmental layers',
    toolbarBehavior: '28px environmental micro bar only — no workspace strip',
    compassBehavior: 'Environmental arc compass integrated in micro bar',
    sheetBehavior: 'ModernSheetChrome — drag dismiss, 44px close, bottom emergence',
    motionBehavior: 'Subtle movement/hazard chips; reduced motion respected',
    environmentalBehavior: 'EnvironmentalInteractionLayer; terrain relief depth cue when active',
    operationalToolExposure: 'Minimal persistent — radial + safety zone (SOS/DeadMan)',
    persistentUi: 'Micro bar, radial hint, safety zone only',
    mustNotAppear: [
      'balanced-micro-bar',
      'data-balanced-layer',
      'data-balanced-workspace-bar',
      'cockpit-dock',
      'CockpitHudShell panels',
    ],
    domSelectors: {
      required: [
        '[data-mode-root="modern"]',
        '.modern-micro-bar',
        '[data-testid="modern-mode-overlays"]',
        '[data-compass-layer="modern"]',
      ],
      forbidden: [
        '[data-mode-root="classic"]',
        '[data-mode-root="balanced"]',
        '.balanced-micro-bar',
        '[data-balanced-layer]',
        '[data-balanced-workspace-bar]',
        '.cockpit-hud-shell',
        '[data-compass-layer="classic"]',
        '[data-compass-layer="balanced"]',
        '[data-balanced-panel]',
      ],
    },
  },
}

export function getLayerContract(mode: LayerContractMode): LayerContract {
  return LAYER_CONTRACTS[mode]
}
