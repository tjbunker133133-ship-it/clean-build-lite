/**
 * HUD Presentation Context - Phase 3C
 *
 * Safe presentation-layer state management.
 *
 * SAFETY:
 * - Additive only — wraps but does not modify existing systems
 * - No coupling to CockpitContext, AppContext, or Tier 1
 * - Uses localStorage for persistence (no network, no polling)
 * - No timers, no effects that modify operational systems
 * - Read-only observation of operational state allowed
 *
 * MODE ENTRY:
 * - URL param: ?mode=immersive forces mode (dev only)
 * - localStorage: hud_force_mode=immersive forces mode (dev only)
 * - Otherwise uses persisted state or defaults to hybrid
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_PRESENTATION_MODE,
  PRESENTATION_MODES,
  PRESENTATION_STORAGE_KEY,
  shouldMinimizeByDefault,
  useFloatingEmergency,
  useMicroStatusBar,
  type HudPresentationMode,
  type HudPresentationState,
} from '../types/hudPresentation'
import { flushCameraAuthority } from '../lib/cameraAuthority'
import { flushPendingCameraIntents } from '../lib/operationalPerception/perceptionEngine'
import { setUserPreferredMode, setAutoModeEnabled } from '../lib/hudRuntime'

// Mode resolution is handled by HUD RUNTIME (src/lib/hudRuntime.ts)
// which runs at import time BEFORE React mounts.
// See window.__HUD_RUNTIME__ for the resolved mode.

interface HudPresentationContextValue extends HudPresentationState {
  /** Current presentation mode */
  mode: HudPresentationMode
  /** Whether user has explicitly configured the mode */
  userConfigured: boolean

  // Derived presentation flags (computed from mode)
  /** TopBar should render as micro status strip */
  microStatusBar: boolean
  /** Dock should be visually collapsed (panels minimized) */
  dockCollapsed: boolean
  /** Map should be visually dominant */
  mapDominant: boolean
  /** Radial interaction should be visually emphasized */
  radialEmphasized: boolean
  /** Emergency systems should float (always accessible) */
  emergencyFloating: boolean
  
  // Layout behavior rules for structural UI decisions
  /** Layout behavior configuration for current mode */
  layoutRules: typeof PRESENTATION_MODES[HudPresentationMode]['layoutRules']
  /** Panel visibility rules for current mode */
  panelRules: typeof PRESENTATION_MODES[HudPresentationMode]['panelRules']

  // Actions
  /** Set presentation mode explicitly */
  setMode: (mode: HudPresentationMode) => void
  /** Reset to default (hybrid) mode */
  resetToDefault: () => void

  // Utility
  /** Check if a panel should be minimized by default in current mode */
  shouldMinimizePanel: (panelId: string) => boolean
  /** Check if a panel should only exist as transient overlay */
  isPanelTransientOnly: (panelId: string) => boolean
  /** Get current mode configuration */
  modeConfig: typeof PRESENTATION_MODES[HudPresentationMode]
}

const HudPresentationContext = createContext<HudPresentationContextValue | null>(null)

/** Load initial state from HUD RUNTIME (pre-resolved at import time) */
function loadPersistedState(): HudPresentationState {
  // Use HUD runtime state (already resolved at import time in hudRuntime.ts)
  if (typeof window !== 'undefined' && window.__HUD_RUNTIME__) {
    const runtimeMode = window.__HUD_RUNTIME__.mode

    // Only log in dev mode - runtime already logged at import
    if (import.meta.env.DEV) {
      console.log(`[HudPresentationContext] Using HUD runtime mode: "${runtimeMode}" (source: ${window.__HUD_RUNTIME__.resolvedFrom})`)
    }

    return {
      mode: runtimeMode,
      userConfigured: window.__HUD_RUNTIME__.resolvedFrom !== 'default',
    }
  }

  // Fallback for SSR
  return { mode: DEFAULT_PRESENTATION_MODE, userConfigured: false }
}

/** Persist state to localStorage */
function persistState(state: HudPresentationState): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors (private mode, quota exceeded)
  }
}

export function HudPresentationProvider({ children }: { children: ReactNode }) {
  // Initialize from HUD BOOT KERNEL (already resolved at import time)
  const [state, setState] = useState<HudPresentationState>(loadPersistedState)

  // Log that context is using HUD runtime state
  useEffect(() => {
    if (import.meta.env.DEV && window.__HUD_RUNTIME__) {
      console.log('[HudPresentationContext] Mounted with HUD runtime mode:', {
        mode: state.mode,
        source: window.__HUD_RUNTIME__.resolvedFrom,
        userConfigured: state.userConfigured,
      })
    }
  }, [])

  // Mode change handler with logging
  const setMode = useCallback((mode: HudPresentationMode) => {
    if (import.meta.env.DEV) {
      console.log(`[MODE BOOT STRAP] setMode CALLED: changing from "${state.mode}" to "${mode}"`)
    }
    const newState: HudPresentationState = {
      mode,
      userConfigured: true,
    }
    setState(newState)
    persistState(newState)
  }, [state.mode])

  // Reset handler
  const resetToDefault = useCallback(() => {
    const newState: HudPresentationState = {
      mode: DEFAULT_PRESENTATION_MODE,
      userConfigured: false,
    }
    setState(newState)
    persistState(newState)
  }, [])

  // Memoized derived values from current mode
  const modeConfig = PRESENTATION_MODES[state.mode]

  const microStatusBar = useMicroStatusBar(state.mode)
  const dockCollapsed = modeConfig.dockCollapsed
  const mapDominant = modeConfig.mapDominant
  const radialEmphasized = modeConfig.radialEmphasized
  const emergencyFloating = useFloatingEmergency(state.mode)
  
  // Layout rules for structural UI decisions
  const layoutRules = modeConfig.layoutRules
  const panelRules = modeConfig.panelRules

  // Panel minimization check
  const shouldMinimizePanel = useCallback(
    (panelId: string) => shouldMinimizeByDefault(panelId, state.mode),
    [state.mode]
  )
  
  // Panel transient-only check (for recommended mode)
  const isPanelTransientOnly = useCallback(
    (panelId: string) => {
      return panelRules.transientOnly.includes(panelId.toLowerCase())
    },
    [panelRules]
  )

  // Context value
  const value = useMemo<HudPresentationContextValue>(
    () => ({
      ...state,
      microStatusBar,
      dockCollapsed,
      mapDominant,
      radialEmphasized,
      emergencyFloating,
      layoutRules,
      panelRules,
      setMode,
      resetToDefault,
      shouldMinimizePanel,
      isPanelTransientOnly,
      modeConfig,
    }),
    [
      state,
      microStatusBar,
      dockCollapsed,
      mapDominant,
      radialEmphasized,
      emergencyFloating,
      layoutRules,
      panelRules,
      setMode,
      resetToDefault,
      shouldMinimizePanel,
      isPanelTransientOnly,
      modeConfig,
    ]
  )

  return (
    <HudPresentationContext.Provider value={value}>
      {children}
    </HudPresentationContext.Provider>
  )
}

/** Hook to access presentation context — throws if used outside provider */
export function useHudPresentation(): HudPresentationContextValue {
  const ctx = useContext(HudPresentationContext)
  if (!ctx) {
    throw new Error('useHudPresentation must be used within HudPresentationProvider')
  }
  return ctx
}

/**
 * Hook for components that want to gracefully degrade if presentation
 * context is not available (optional consumption).
 */
export function useHudPresentationOptional(): HudPresentationContextValue | null {
  return useContext(HudPresentationContext)
}

/**
 * LAYOUT STYLE SELECTOR - Mode Switcher
 * 
 * Allows users to switch between Modern, Balanced, and Classic modes.
 * Positioned at bottom-left for easy access.
 */
export function LayoutStyleSelector(): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(true)
  
  // Access runtime for current state (read-only during session)
  const runtime = typeof window !== 'undefined' ? window.__HUD_RUNTIME__ : null
  const currentMode = runtime?.userPreferredMode ?? 'hybrid'
  const autoModeEnabled = runtime?.autoModeEnabled ?? true

  // Helper to set preference (requires reload)
  const setPreference = (style: 'immersive' | 'hybrid' | 'legacy') => {
    flushCameraAuthority()
    flushPendingCameraIntents()
    setUserPreferredMode(style)
    // Explicit user choice must win over auto-context promotion on reload
    setAutoModeEnabled(false)
    window.location.reload()
  }

  const setAutoMode = (enabled: boolean) => {
    flushCameraAuthority()
    flushPendingCameraIntents()
    setAutoModeEnabled(enabled)
    window.location.reload()
  }

  // Style labels (user-friendly)
  const styles = [
    {
      key: 'immersive' as const,
      label: 'Modern',
      description: 'Map-first OS',
      icon: '◉',
    },
    {
      key: 'hybrid' as const,
      label: 'Balanced',
      description: 'Map + tools',
      icon: '◐',
    },
    {
      key: 'legacy' as const,
      label: 'Classic',
      description: 'Full cockpit',
      icon: '□',
    },
  ]

  // Get current mode name for display
  const currentStyle = styles.find(s => s.key === currentMode)

  if (collapsed) {
    // Collapsed: show just current mode indicator
    return (
      <button
        data-layout-style-selector
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed',
          bottom: 12,
          left: 12,
          zIndex: 999999,
          padding: '6px 10px',
          borderRadius: 20,
          background: 'rgba(28, 28, 30, 0.95)',
          border: '1px solid rgba(120, 120, 128, 0.3)',
          fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
          fontSize: 12,
          color: 'rgba(255, 255, 255, 0.9)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          backdropFilter: 'blur(12px)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'all 200ms ease',
        }}
        title="Click to change mode"
      >
        <span style={{ fontSize: 14 }}>{currentStyle?.icon}</span>
        <span style={{ fontWeight: 500 }}>{currentStyle?.label}</span>
        <span style={{ opacity: 0.5, marginLeft: 2 }}>▾</span>
      </button>
    )
  }

  return (
    <div
      data-layout-style-selector
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: 999999,
        padding: '12px',
        borderRadius: 12,
        background: 'rgba(28, 28, 30, 0.98)',
        border: '1px solid rgba(120, 120, 128, 0.25)',
        fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
        fontSize: 13,
        color: 'rgba(255, 255, 255, 0.9)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(20px)',
        minWidth: 160,
        animation: 'modeSelectorEnter 200ms ease-out',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: '1px solid rgba(120, 120, 128, 0.2)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12, color: 'rgba(255, 255, 255, 0.7)' }}>
          Display Mode
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.5)',
            cursor: 'pointer',
            fontSize: 14,
            padding: '2px 4px',
            borderRadius: 4,
          }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Style options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {styles.map((style) => (
          <button
            key={style.key}
            onClick={() => setPreference(style.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid',
              borderColor:
                currentMode === style.key
                  ? 'rgba(0, 122, 255, 0.5)'
                  : 'transparent',
              background:
                currentMode === style.key
                  ? 'rgba(0, 122, 255, 0.15)'
                  : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 150ms ease',
            }}
          >
            <span style={{ 
              fontSize: 16, 
              opacity: currentMode === style.key ? 1 : 0.6,
              color: currentMode === style.key ? '#0a84ff' : 'rgba(255, 255, 255, 0.7)',
            }}>
              {style.icon}
            </span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: currentMode === style.key ? 600 : 500,
                  color: currentMode === style.key ? '#fff' : 'rgba(255, 255, 255, 0.9)',
                }}
              >
                {style.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'rgba(255, 255, 255, 0.5)',
                  marginTop: 1,
                }}
              >
                {style.description}
              </div>
            </div>
            {currentMode === style.key && (
              <span style={{ color: '#0a84ff', fontSize: 14 }}>✓</span>
            )}
          </button>
        ))}
      </div>

      <style>{`
        @keyframes modeSelectorEnter {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  )
}

/**
 * @deprecated Use LayoutStyleSelector instead
 */
export function DevModeSelector(): JSX.Element | null {
  // Redirect to new component
  return LayoutStyleSelector()
}
