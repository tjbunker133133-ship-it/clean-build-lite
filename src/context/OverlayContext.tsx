import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ENVIRONMENTAL_OVERLAY_IDS, overlayDef } from '../lib/environmentalOverlays/catalog'
import {
  loadOverlayToggles,
  saveOverlayToggles,
  setOverlayToggle,
  type OverlayToggleState,
} from '../lib/environmentalOverlays/overlayState'
import { readEnvKey } from '../lib/environmentalOverlays/sources'
import type { EnvironmentalOverlayId, OverlayRuntimeStatus } from '../lib/environmentalOverlays/types'

type OverlayContextValue = {
  toggles: OverlayToggleState
  status: Record<EnvironmentalOverlayId, OverlayRuntimeStatus>
  setEnabled: (
    id: EnvironmentalOverlayId,
    enabled: boolean,
  ) => { applied: boolean; error?: string }
  patchStatus: (id: EnvironmentalOverlayId, patch: Partial<OverlayRuntimeStatus>) => void
  online: boolean
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

function defaultStatus(enabled: boolean): OverlayRuntimeStatus {
  return {
    enabled,
    loading: false,
    error: null,
    stale: false,
    fromCache: false,
  }
}

function buildStatusMap(toggles: OverlayToggleState): Record<EnvironmentalOverlayId, OverlayRuntimeStatus> {
  return Object.fromEntries(
    ENVIRONMENTAL_OVERLAY_IDS.map((id) => [id, defaultStatus(toggles[id])]),
  ) as Record<EnvironmentalOverlayId, OverlayRuntimeStatus>
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [toggles, setToggles] = useState<OverlayToggleState>(() => loadOverlayToggles())
  const [status, setStatus] = useState(() => buildStatusMap(toggles))
  const [online, setOnline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine !== false,
  )

  useEffect(() => {
    saveOverlayToggles(toggles)
    setStatus((prev) => {
      const next = { ...prev }
      for (const id of ENVIRONMENTAL_OVERLAY_IDS) {
        next[id] = { ...defaultStatus(toggles[id]), ...prev[id], enabled: toggles[id] }
      }
      return next
    })
  }, [toggles])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const patchStatus = useCallback((id: EnvironmentalOverlayId, patch: Partial<OverlayRuntimeStatus>) => {
    setStatus((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch, enabled: prev[id]?.enabled ?? false },
    }))
  }, [])

  const setEnabled = useCallback((id: EnvironmentalOverlayId, enabled: boolean) => {
    if (enabled) {
      const def = overlayDef(id)
      // Config-driven API key check (any overlay can require an env key)
      if (def.envKey && !readEnvKey(def.envKey)) {
        const error =
          `${def.label} API key missing — add ${def.envKey} to .env.local, sync Vercel, redeploy`
        // CRITICAL: Always clear loading and set enabled false when key missing
        patchStatus(id, {
          enabled: false,
          error,
          loading: false,
          stale: false,
          fromCache: false,
        })
        return { applied: false, error }
      }
    }
    setToggles((t) => setOverlayToggle(t, id, enabled))
    // When disabling, clear all state
    if (!enabled) {
      patchStatus(id, {
        enabled: false,
        error: null,
        loading: false,
        stale: false,
        fromCache: false,
      })
      return { applied: true }
    }
    // When enabling, set loading true (will be cleared by EnvironmentalOverlaysLayer)
    patchStatus(id, {
      enabled: true,
      error: null,
      loading: true,  // Loading will be cleared by syncOverlay
      stale: false,
      fromCache: false,
    })
    return { applied: true }
  }, [patchStatus])

  const value = useMemo(
    () => ({ toggles, status, setEnabled, patchStatus, online }),
    [toggles, status, setEnabled, patchStatus, online],
  )

  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
}

export function useOverlayContext(): OverlayContextValue {
  const ctx = useContext(OverlayContext)
  if (!ctx) throw new Error('useOverlayContext requires OverlayProvider')
  return ctx
}
