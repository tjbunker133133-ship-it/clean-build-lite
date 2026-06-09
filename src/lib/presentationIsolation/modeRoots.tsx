/**
 * Mode root isolation boundaries — exactly ONE mode root mounted at a time.
 */

import React, { useEffect, type CSSProperties, type ReactNode } from 'react'
import { useHudPresentation } from '../../context/HudPresentationContext'
import type { HudPresentationMode } from '../../types/hudPresentation'
import { layerZ } from './zIndexLayers'
import { assertModeRootIsolation } from './isolationAssertions'
import { assertModeComposition, runCompositionAudit } from './compositionAssertions'
import { assertInteractionAuthority } from './interactionAssertions'
import { getMapInteractionOwner } from '../mapInteractionRegistry'

export type ModeRootId = 'classic' | 'balanced' | 'modern'

const MODE_ROOT_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  overflow: 'hidden',
  isolation: 'isolate',
  contain: 'layout paint',
  pointerEvents: 'none',
}

export function presentationModeToRootId(mode: HudPresentationMode): ModeRootId {
  switch (mode) {
    case 'legacy':
      return 'classic'
    case 'hybrid':
      return 'balanced'
    case 'immersive':
      return 'modern'
  }
}

function ModeRootBase({
  mode,
  children,
  testId,
}: {
  mode: ModeRootId
  children: ReactNode
  testId: string
}) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-active-mode-root', mode)
    publishModeRootDiagnostics()
    return () => {
      document.documentElement.removeAttribute('data-active-mode-root')
    }
  }, [mode])

  return (
    <div
      data-mode-root={mode}
      data-testid={testId}
      data-modern-shell={mode === 'modern' ? 'true' : undefined}
      className={`hud-mode-root hud-mode-root--${mode} hud-pointer-pass-through`}
      style={{ ...MODE_ROOT_STYLE, zIndex: layerZ('MODE_UI') }}
    >
      {children}
      <ModePortalHost mode={mode} />
    </div>
  )
}

export function ClassicRoot({ children }: { children: ReactNode }) {
  return (
    <ModeRootBase mode="classic" testId="mode-root-classic">
      {children}
    </ModeRootBase>
  )
}

export function BalancedRoot({ children }: { children: ReactNode }) {
  return (
    <ModeRootBase mode="balanced" testId="mode-root-balanced">
      {children}
    </ModeRootBase>
  )
}

export function ModernRoot({ children }: { children: ReactNode }) {
  return (
    <ModeRootBase mode="modern" testId="mode-root-modern">
      {children}
    </ModeRootBase>
  )
}

/** Portal mount target inside each mode root. Mode-owned overlays render here. */
export function ModePortalHost({ mode }: { mode: ModeRootId }) {
  return (
    <div
      data-mode-portal-root={mode}
      data-testid={`mode-portal-root-${mode}`}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: layerZ('MODE_OVERLAY'),
        isolation: 'isolate',
        contain: 'layout paint',
      }}
    />
  )
}

/** Dedicated global overlay root — confirm dialogs, SW banners that span modes. */
export function GlobalOverlayRoot() {
  useEffect(() => {
    if (typeof document === 'undefined') return
    let el = document.getElementById('hud-global-overlay-root')
    if (!el) {
      el = document.createElement('div')
      el.id = 'hud-global-overlay-root'
      el.setAttribute('data-global-overlay-root', 'true')
      el.setAttribute('data-testid', 'global-overlay-root')
      Object.assign(el.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: String(layerZ('OVERLAY')),
        isolation: 'isolate',
        contain: 'layout paint',
      })
      document.body.appendChild(el)
    }
    publishModeRootDiagnostics()
    return () => {
      /* Global root persists across mode switches */
    }
  }, [])
  return null
}

/** Interaction owner registers in child useEffect — wait until ready before DEV assert. */
function isInteractionOwnerReady(expectedRoot: ModeRootId): boolean {
  const owner = getMapInteractionOwner()
  if (expectedRoot === 'classic') return owner == null
  return owner?.id === expectedRoot
}

/** Dev-mode guard: fail loudly if more than one mode root is mounted. */
export function ModeRootIsolationGuard() {
  const { mode } = useHudPresentation()

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const id = presentationModeToRootId(mode)
    let cancelled = false
    let attempts = 0
    const maxAttempts = 50

    const tryAssert = () => {
      if (cancelled) return
      const { ok } = runCompositionAudit(id)
      const ownerReady = isInteractionOwnerReady(id)
      if (ok && ownerReady) {
        assertModeRootIsolation(id)
        assertInteractionAuthority(id)
        return
      }
      attempts += 1
      if (attempts < maxAttempts) {
        window.setTimeout(tryAssert, 100)
        return
      }
      assertModeRootIsolation(id)
      assertModeComposition(id)
      assertInteractionAuthority(id)
    }

    const timer = window.setTimeout(tryAssert, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mode])

  return null
}

function publishModeRootDiagnostics(): void {
  if (typeof window === 'undefined') return
  const roots = [...document.querySelectorAll('[data-mode-root]')].map((el) =>
    el.getAttribute('data-mode-root'),
  )
  const w = window as Window & { __HUD_ISOLATION__?: Record<string, unknown> }
  w.__HUD_ISOLATION__ = {
    ...w.__HUD_ISOLATION__,
    mountedModeRoots: roots,
    activeModeRoot: document.documentElement.getAttribute('data-active-mode-root'),
    globalOverlayRoot: !!document.querySelector('[data-global-overlay-root]'),
  }
}

export function getModePortalTarget(mode: ModeRootId): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(`[data-mode-portal-root="${mode}"]`)
}

export function getGlobalOverlayTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.getElementById('hud-global-overlay-root')
}
