/**
 * Runtime mode composition audit — mount tree introspection for DEV + e2e.
 * Documents which systems are mounted, scoped, shared, or missing per mode.
 */

import type { ModeRootId } from './modeRoots'
import { presentationModeToRootId } from './modeRoots'
import type { HudPresentationMode } from '../../types/hudPresentation'

export type CompositionFlag =
  | 'SHARED_RUNTIME_TREE'
  | 'FALLBACK_RENDER_PATH'
  | 'EMPTY_MODE_ROOT'
  | 'LEGACY_COMPAT_LAYER'
  | 'MODE_COMPOSITION_COLLAPSE'
  | 'HIDDEN_ACTIVE_SYSTEM'

export type CompositionMarker = {
  selector: string
  label: string
  owner: ModeRootId
  required: boolean
  forbiddenIn?: ModeRootId[]
}

/** Authoritative ownership matrix — mounted markers per mode root. */
export const MODE_COMPOSITION_MARKERS: Record<ModeRootId, CompositionMarker[]> = {
  classic: [
    { selector: '.cockpit-hud-shell', label: 'CockpitHudShell', owner: 'classic', required: true },
    { selector: '[data-classic-navigation-hud]', label: 'NavigationHud', owner: 'classic', required: true },
    { selector: '[data-compass-layer="classic"]', label: 'ClassicCompass', owner: 'classic', required: true },
    { selector: '.cockpit-panel', label: 'CockpitPanels', owner: 'classic', required: true },
    { selector: '[data-balanced-layer]', label: 'BalancedLayer', owner: 'balanced', required: false, forbiddenIn: ['classic'] },
    { selector: '[data-testid="modern-mode-overlays"]', label: 'ModernModeOverlays', owner: 'modern', required: false, forbiddenIn: ['classic'] },
    { selector: '.modern-micro-bar', label: 'ModernMicroBar', owner: 'modern', required: false, forbiddenIn: ['classic'] },
    { selector: '.balanced-micro-bar', label: 'BalancedMicroBar', owner: 'balanced', required: false, forbiddenIn: ['classic'] },
    { selector: '[data-modern-safety-zone]', label: 'ModernSafetyZone', owner: 'modern', required: false, forbiddenIn: ['classic'] },
    { selector: '[data-env-interaction-layer="modern"]', label: 'EnvironmentalInteractionLayer', owner: 'modern', required: false, forbiddenIn: ['classic'] },
  ],
  balanced: [
    { selector: '[data-balanced-interaction-host]', label: 'BalancedInteractionHost', owner: 'balanced', required: true },
    { selector: '[data-balanced-layer][data-balanced-active="true"]', label: 'BalancedLayer', owner: 'balanced', required: true },
    { selector: '[data-balanced-workspace-bar]', label: 'BalancedQuickActions', owner: 'balanced', required: true },
    { selector: '[data-balanced-chrome="operational"]', label: 'BalancedOperationalChrome', owner: 'balanced', required: true },
    { selector: '.balanced-micro-bar', label: 'BalancedMicroBar', owner: 'balanced', required: true },
    { selector: '[data-compass-layer="balanced"]', label: 'BalancedCompass', owner: 'balanced', required: true },
    { selector: '[data-balanced-panel]', label: 'BalancedPanels', owner: 'balanced', required: false },
    { selector: '.cockpit-hud-shell', label: 'CockpitHudShell', owner: 'classic', required: false, forbiddenIn: ['balanced'] },
    { selector: '[data-testid="modern-mode-overlays"]', label: 'ModernModeOverlays', owner: 'modern', required: false, forbiddenIn: ['balanced'] },
    { selector: '.modern-micro-bar', label: 'ModernMicroBar', owner: 'modern', required: false, forbiddenIn: ['balanced'] },
    { selector: '[data-modern-safety-zone]', label: 'ModernSafetyZone', owner: 'modern', required: false, forbiddenIn: ['balanced'] },
    { selector: '[data-env-interaction-layer="modern"]', label: 'EnvironmentalInteractionLayer', owner: 'modern', required: false, forbiddenIn: ['balanced'] },
  ],
  modern: [
    { selector: '[data-testid="modern-mode-overlays"]', label: 'ModernModeOverlays', owner: 'modern', required: true },
    { selector: '[data-modern-shell="true"]', label: 'ModernShell', owner: 'modern', required: true },
    { selector: '[data-modern-radial-host="true"]', label: 'ModernInteractionHost', owner: 'modern', required: true },
    { selector: '[data-testid="modern-field-scan-rail"]', label: 'ModernFieldScanRail', owner: 'modern', required: true },
    { selector: '.modern-micro-bar', label: 'ModernMicroBar', owner: 'modern', required: true },
    { selector: '[data-compass-layer="modern"]', label: 'ModernEnvironmentalCompass', owner: 'modern', required: true },
    { selector: '[data-modern-safety-zone]', label: 'ModernSafetyZone', owner: 'modern', required: true },
    { selector: '[data-env-interaction-layer="modern"]', label: 'EnvironmentalInteractionLayer', owner: 'modern', required: true },
    { selector: '[data-balanced-layer]', label: 'BalancedLayer', owner: 'balanced', required: false, forbiddenIn: ['modern'] },
    { selector: '.balanced-micro-bar', label: 'BalancedMicroBar', owner: 'balanced', required: false, forbiddenIn: ['modern'] },
    { selector: '[data-balanced-workspace-bar]', label: 'BalancedWorkspace', owner: 'balanced', required: false, forbiddenIn: ['modern'] },
    { selector: '.cockpit-hud-shell', label: 'CockpitHudShell', owner: 'classic', required: false, forbiddenIn: ['modern'] },
    { selector: '[data-classic-navigation-hud]', label: 'NavigationHud', owner: 'classic', required: false, forbiddenIn: ['modern'] },
  ],
}

export type CompositionEntry = {
  selector: string
  label: string
  owner: ModeRootId
  mounted: boolean
  inActiveRoot: boolean
  rootScope: ModeRootId | 'unscoped' | null
  flags: CompositionFlag[]
}

export type CompositionAuditResult = {
  mode: ModeRootId
  runtimeMode: HudPresentationMode | null
  entries: CompositionEntry[]
  flags: CompositionFlag[]
  ok: boolean
}

function scopeOf(el: Element | null): ModeRootId | 'unscoped' | null {
  if (!el) return null
  const root = el.closest('[data-mode-root]')
  if (!root) return 'unscoped'
  return (root.getAttribute('data-mode-root') as ModeRootId) ?? 'unscoped'
}

function collectFlags(
  marker: CompositionMarker,
  active: ModeRootId,
  el: Element | null,
  inActiveRoot: boolean,
  rootScope: ModeRootId | 'unscoped' | null,
): CompositionFlag[] {
  const mounted = el != null
  const flags: CompositionFlag[] = []
  if (marker.required && !mounted) {
    flags.push('EMPTY_MODE_ROOT')
  }
  if (marker.forbiddenIn?.includes(active) && mounted) {
    flags.push('MODE_COMPOSITION_COLLAPSE')
  }
  if (mounted && rootScope !== active && rootScope !== null) {
    flags.push('SHARED_RUNTIME_TREE')
  }
  if (mounted && !inActiveRoot && rootScope === 'unscoped') {
    flags.push('FALLBACK_RENDER_PATH')
  }
  if (mounted && inActiveRoot && el) {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' && style.display !== 'none') {
      flags.push('HIDDEN_ACTIVE_SYSTEM')
    }
  }
  return flags
}

export function collectCompositionAudit(active: ModeRootId): CompositionAuditResult {
  const markers = MODE_COMPOSITION_MARKERS[active]
  const entries: CompositionEntry[] = []
  const allFlags = new Set<CompositionFlag>()

  for (const marker of markers) {
    const el = typeof document !== 'undefined' ? document.querySelector(marker.selector) : null
    const mounted = el != null
    const rootScope = scopeOf(el)
    const inActiveRoot = rootScope === active
    const flags = collectFlags(marker, active, el, inActiveRoot, rootScope)
    flags.forEach((f) => allFlags.add(f))
    entries.push({
      selector: marker.selector,
      label: marker.label,
      owner: marker.owner,
      mounted,
      inActiveRoot,
      rootScope,
      flags,
    })
  }

  const runtimeMode =
    typeof window !== 'undefined'
      ? ((window as Window & { __HUD_RUNTIME__?: { mode?: HudPresentationMode } }).__HUD_RUNTIME__
          ?.mode ?? null)
      : null

  const ok =
    entries.every((e) => {
      const marker = markers.find((m) => m.selector === e.selector)!
      if (marker.required && !e.mounted) return false
      if (marker.forbiddenIn?.includes(active) && e.mounted) return false
      if (e.mounted && e.rootScope !== active && e.rootScope !== null && e.rootScope !== 'unscoped') return false
      return true
    }) && allFlags.size === 0

  return {
    mode: active,
    runtimeMode,
    entries,
    flags: [...allFlags],
    ok,
  }
}

export function collectMountTree(active: ModeRootId): Record<string, unknown> {
  const root = typeof document !== 'undefined' ? document.querySelector(`[data-mode-root="${active}"]`) : null
  if (!root) {
    return { root: active, mounted: false, children: [] }
  }

  const walk = (el: Element, depth: number): Record<string, unknown> => {
    const tag =
      el.getAttribute('data-testid') ||
      el.getAttribute('data-panel-id') ||
      el.getAttribute('data-balanced-layer') ||
      el.className?.toString().split(' ').filter(Boolean).slice(0, 2).join('.') ||
      el.tagName.toLowerCase()
    const childEls = depth < 4 ? [...el.children].slice(0, 12) : []
    return {
      tag,
      children: childEls.map((c) => walk(c, depth + 1)),
    }
  }

  return {
    root: active,
    mounted: true,
    tree: walk(root, 0),
    audit: collectCompositionAudit(active),
  }
}

export function presentationModeToAuditMode(mode: HudPresentationMode): ModeRootId {
  return presentationModeToRootId(mode)
}
