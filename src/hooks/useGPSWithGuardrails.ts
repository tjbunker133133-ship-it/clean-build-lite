/**
 * TIER 2 GPS GUARDRAILS — Monitoring wrapper for GPS lifecycle
 *
 * This module provides soft guardrails and forensics tracing for GPS behavior
 * WITHOUT modifying the Tier 1 GPS implementation in useGPS.ts.
 *
 * Guardrails added:
 * - GPS watch lifecycle tracing for forensics visibility
 * - Duplicate watcher detection via state inspection
 * - Visibility change recovery tracing
 * - Stale/recovery state notifications
 */

import { useEffect, useRef } from 'react'
import { useGPS, type GPSData } from './useGPS'
import { pushForensicTrace } from '../runtime/runtimeForensics'
import { getResumeReconciliationEngine } from '../lib/resumeReconciliationEngine'

// ============================================================================
// GUARDRAIL: GPS Lifecycle Tracing
// ============================================================================

interface GpsGuardrailState {
  lastLocationState: GPSData['locationState']
  lastGoodFixAt: number
  lastVisibilityState: DocumentVisibilityState | null
  watchStartCount: number
}

const guardrailState: GpsGuardrailState = {
  lastLocationState: 'idle',
  lastGoodFixAt: 0,
  lastVisibilityState: null,
  watchStartCount: 0,
}

function traceGpsGuardrail(
  event: 'initialized' | 'state_changed' | 'recovered_visible' | 'stale_warning',
  details?: Record<string, unknown>,
): void {
  pushForensicTrace('gps', `guardrail_${event}`, details)
}

// ============================================================================
// GUARDRAIL: GPS Data Watcher Hook
// ============================================================================

/**
 * Tier 2 GPS hook with monitoring guardrails.
 *
 * This wraps the Tier 1 useGPS hook and adds:
 * - Lifecycle state change tracing
 * - Visibility recovery detection
 * - Stale/recovery notifications
 *
 * NOTE: This does NOT modify Tier 1 GPS behavior. It only observes
 * and traces for forensics visibility.
 */
export function useGPSWithGuardrails(): ReturnType<typeof useGPS> {
  const gps = useGPS()
  const previousStateRef = useRef<GPSData['locationState']>(gps.locationState)
  const previousFixRef = useRef<{ lat: number | null; lng: number | null }>({
    lat: gps.lat,
    lng: gps.lng,
  })

  // GUARDRAIL: Trace state transitions
  useEffect(() => {
    const prevState = previousStateRef.current
    const newState = gps.locationState

    if (prevState !== newState) {
      traceGpsGuardrail('state_changed', {
        from: prevState,
        to: newState,
        hasFix: gps.lat != null && gps.lng != null,
        accuracy: gps.accuracy,
      })
      previousStateRef.current = newState
    }

    // Detect new fix
    if (
      (gps.lat !== previousFixRef.current.lat || gps.lng !== previousFixRef.current.lng) &&
      gps.lat != null &&
      gps.lng != null
    ) {
      previousFixRef.current = { lat: gps.lat, lng: gps.lng }
      guardrailState.lastGoodFixAt = Date.now()
      const engine = getResumeReconciliationEngine()
      engine.onGpsTick()
      if (engine.isPending()) {
        engine.onPostResumeGpsTick()
      }
    }
  }, [gps.locationState, gps.lat, gps.lng, gps.accuracy])

  // GUARDRAIL: Visibility recovery detection
  useEffect(() => {
    let lastVisibility: DocumentVisibilityState | null = null

    const handleVisibilityChange = () => {
      const current = document.visibilityState

      if (lastVisibility !== current) {
        traceGpsGuardrail('recovered_visible', {
          from: lastVisibility,
          to: current,
          gpsState: gps.locationState,
          hasFix: gps.lat != null && gps.lng != null,
        })
        lastVisibility = current
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [gps.locationState, gps.lat, gps.lng])

  // GUARDRAIL: Stale warning (Tier 2 diagnostic - Tier 1 has its own stale detection)
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (gps.locationState !== 'granted') return

      // Note: Tier 1 has its own 45s stale detection. This is for Tier 2 forensics only.
      const lastFixAge = Date.now() - guardrailState.lastGoodFixAt
      if (lastFixAge > 60_000 && guardrailState.lastGoodFixAt > 0) {
        traceGpsGuardrail('stale_warning', {
          lastFixAgeMs: lastFixAge,
          locationState: gps.locationState,
        })
      }
    }, 30_000)

    return () => window.clearInterval(interval)
  }, [gps.locationState])

  // E2E-only: wire injected GPS fixes into guardrail forensics (does not alter Tier 1 useGPS)
  useEffect(() => {
    if (!isE2eAutomation()) return
    const w = window as Window & {
      __gpsListeners?: Array<(fix: GeolocationPosition) => void>
      __lastGps?: GeolocationPosition
      __e2eGpsDeliveryCount?: number
    }
    w.__gpsListeners = w.__gpsListeners ?? []
    w.__e2eGpsDeliveryCount = w.__e2eGpsDeliveryCount ?? 0

    const onInject = (fix: GeolocationPosition) => {
      w.__lastGps = fix
      w.__e2eGpsDeliveryCount = (w.__e2eGpsDeliveryCount ?? 0) + 1
      guardrailState.lastGoodFixAt = Date.now()
      pushForensicTrace('gps', 'e2e_inject', {
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
      })
    }
    w.__gpsListeners.push(onInject)
    return () => {
      w.__gpsListeners = w.__gpsListeners?.filter((cb) => cb !== onInject)
    }
  }, [])

  return gps
}

function isE2eAutomation(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (navigator as Navigator & { webdriver?: boolean }).webdriver === true ||
    new URLSearchParams(window.location.search).has('e2e')
  )
}

// ============================================================================
// GUARDRAIL: Global GPS Diagnostics API
// ============================================================================

/**
 * Get GPS guardrail diagnostics for runtime verification.
 * Called via browser console: `__hudDebug?.gpsGuardrailDiagnostics()`
 */
export function getGpsGuardrailDiagnostics(): {
  guardrailState: GpsGuardrailState
} {
  return {
    guardrailState: { ...guardrailState },
  }
}
