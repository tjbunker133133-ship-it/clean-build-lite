/**
 * Situational Voice Support (SVS) - React Hook
 *
 * Integrates SVS with existing HUD React context.
 *
 * Watches:
 * - GPS/motion (useGPS, useTravelSpeed)
 * - Mission state (useMissionSync)
 * - Wearables (when available)
 * - Battery state
 * - Environmental conditions
 *
 * Provides:
 * - Event detection
 * - Automatic delivery
 * - Configuration UI data
 * - Diagnostic visibility
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { useGPS } from './useGPS'
import { useTravelSpeed } from './useTravelSpeed'
import type {
  SvsDeliveryResult,
  SvsDiagnostics,
  SvsEvent,
  SvsEventType,
  SvsRuntimeSnapshot,
  SvsUserConfig,
} from '../lib/svs'
import {
  detectBatteryEvent,
  detectHeartRateEvent,
  detectMissionEvent,
  detectMotionEvent,
  detectPeerEvent,
  detectSessionStart,
  detectSunsetEvent,
  detectWaypointEvent,
  detectWellnessReminders,
  emitEvent,
  getSvsDiagnostics,
  initSvs,
  loadSvsConfig,
  markUserSilenced,
  processEvent,
  resetSvs,
  saveSvsConfig,
  subscribeConfigChanges,
  subscribeDeliveries,
  subscribeSvsEvents,
  updateSvsConfig,
} from '../lib/svs'
import { logInfo, logWarn } from '../runtime/logger'

// ============================================================================
// HOOK INTERFACE
// ============================================================================

export interface SvsHookResult {
  // Configuration
  config: SvsUserConfig
  updateConfig: (patch: Partial<SvsUserConfig>) => void
  resetConfig: () => void

  // Diagnostics
  diagnostics: SvsDiagnostics | null
  runtimeSnapshot: SvsRuntimeSnapshot | null

  // Event handling
  deliveries: SvsDeliveryResult[]
  lastDelivery: SvsDeliveryResult | null

  // Manual control
  silence: () => void
  emitManual: (eventType: SvsEventType) => void
  reset: () => void
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useSvs(): SvsHookResult {
  const missionSync = useMissionSync()
  const gps = useGPS()
  const travelSpeed = useTravelSpeed(gps.lat, gps.lng, gps.status === 'locked', gps.accuracy ?? null)

  const [config, setConfig] = useState<SvsUserConfig>(() => loadSvsConfig())
  const [diagnostics, setDiagnostics] = useState<SvsDiagnostics | null>(null)
  const [deliveries, setDeliveries] = useState<SvsDeliveryResult[]>([])
  const lastDelivery = deliveries[deliveries.length - 1] ?? null

  // Refs for event detection
  const prevPeerCountRef = useRef(missionSync.peers.length)
  const lastGpsUpdateRef = useRef<number | null>(null)
  const batteryRef = useRef<number | null>(null)
  const heartRateRef = useRef<number | null>(null)

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  useEffect(() => {
    // Initialize SVS with state providers
    initSvs({
      stateProviders: {
        isMissionActive: () => missionSync.missionId !== null,
        getBatteryPercent: () => batteryRef.current,
        getRecentUserActivity: () => lastGpsUpdateRef.current,
      },
    })

    // Subscribe to config changes
    const unsubscribeConfig = subscribeConfigChanges((newConfig) => {
      setConfig(newConfig)
    })

    // Subscribe to delivery events (capped history)
    const unsubscribeDeliveries = subscribeDeliveries((result) => {
      setDeliveries((prev) => [...prev.slice(-19), result])
    })

    // Periodic diagnostics update (every 30s)
    const diagInterval = window.setInterval(() => {
      setDiagnostics(getSvsDiagnostics())
    }, 30_000)

    // Initial diagnostics
    setDiagnostics(getSvsDiagnostics())

    return () => {
      unsubscribeConfig()
      unsubscribeDeliveries()
      window.clearInterval(diagInterval)
    }
  }, [missionSync.missionId])

  // ============================================================================
  // GPS/MOTION DETECTION
  // ============================================================================

  useEffect(() => {
    if (!config.enabled) return

    // Track GPS activity for inactivity detection
    if (gps.lat !== null && gps.lng !== null) {
      lastGpsUpdateRef.current = Date.now()
    }

    // Motion detection
    const speedMph = travelSpeed.sample?.mph ?? null
    const isMoving = speedMph !== null && speedMph > 1
    const activityMinutes = missionSync.missionId !== null ? estimateActivityMinutes() : null

    const event = detectMotionEvent(speedMph, isMoving, activityMinutes)
    if (event) {
      void processEvent(event)
    }
  }, [gps.lat, gps.lng, travelSpeed.sample, config.enabled, missionSync.missionId])

  // ============================================================================
  // MISSION/LINK DETECTION
  // ============================================================================

  useEffect(() => {
    if (!config.enabled) return

    const missionActive = missionSync.missionId !== null
    const wasRestored = missionSync.lastSyncAt !== null && missionSync.lastSyncAt > Date.now() - 60_000
    const linkLost = missionSync.linkRecoveryPending && prevPeerCountRef.current > 0
    const linkRecovered =
      !missionSync.linkRecoveryPending &&
      prevPeerCountRef.current === 0 &&
      missionSync.peers.length > 0

    const event = detectMissionEvent(missionActive, wasRestored, linkLost, linkRecovered)
    if (event) {
      void processEvent(event)
    }

    // Peer changes
    const peerEvent = detectPeerEvent(missionSync.peers.length, prevPeerCountRef.current)
    if (peerEvent) {
      void processEvent(peerEvent)
    }

    prevPeerCountRef.current = missionSync.peers.length
  }, [
    missionSync.missionId,
    missionSync.linkRecoveryPending,
    missionSync.peers.length,
    missionSync.lastSyncAt,
    config.enabled,
  ])

  // ============================================================================
  // WAYPOINT DETECTION
  // ============================================================================

  useEffect(() => {
    if (!config.enabled) return
    // NO-OP GUARD: Waypoint detection requires NavigationHud integration
    // Manual waypoint events supported via emitManual('WAYPOINT_ARRIVED')
    // To enable: Integrate with navigation proximity detection
  }, [config.enabled])

  // ============================================================================
  // WELLNESS REMINDERS
  // ============================================================================

  useEffect(() => {
    if (!config.enabled) return
    if (!missionSync.missionId) return

    // Check wellness reminders every minute
    const activityMinutes = estimateActivityMinutes()
    const wellnessEvent = detectWellnessReminders(activityMinutes)
    if (wellnessEvent) {
      void processEvent(wellnessEvent)
    }

    // Session start check
    const sessionEvent = detectSessionStart()
    if (sessionEvent) {
      void processEvent(sessionEvent)
    }
  }, [config.enabled, missionSync.missionId])

  // ============================================================================
  // SUNSET/ENVIRONMENTAL (when available)
  // ============================================================================

  useEffect(() => {
    if (!config.enabled) return

    // NO-OP GUARD: Environmental detection requires weather/time service integration
    // Events supported: SUNSET_APPROACHING, HEAT_WARNING, COLD_WARNING, ELEVATION_MILESTONE
    // To enable: Wire weather API and elevation data sources to detectXxxEvent() calls
  }, [config.enabled])

  // ============================================================================
  // ACTIONS
  // ============================================================================

  const updateConfig = useCallback((patch: Partial<SvsUserConfig>) => {
    updateSvsConfig(patch)
  }, [])

  const resetConfig = useCallback(() => {
    saveSvsConfig({ ...loadSvsConfig(), enabled: true, frequency: 'balanced', mode: 'supportive' })
  }, [])

  const silence = useCallback(() => {
    markUserSilenced()
    logInfo('RUNTIME', 'User silenced SVS')
  }, [])

  const emitManual = useCallback((eventType: SvsEventType) => {
    emitEvent({
      type: eventType,
      priority: 2 as const, // Default operational
      timestamp: Date.now(),
      payload: {},
      dedupeKey: `manual-${eventType}-${Date.now()}`,
    })
  }, [])

  const reset = useCallback(() => {
    resetSvs()
    setDeliveries([])
    setDiagnostics(null)
  }, [])

  // ============================================================================
  // RENDER
  // ============================================================================

  return {
    config,
    updateConfig,
    resetConfig,
    diagnostics,
    runtimeSnapshot: null, // Would integrate with runtime snapshot system
    deliveries,
    lastDelivery,
    silence,
    emitManual,
    reset,
  }
}

// ============================================================================
// STANDALONE HOOKS
// ============================================================================

/**
 * Hook for SVS configuration only (lightweight)
 */
export function useSvsConfig(): {
  config: SvsUserConfig
  updateConfig: (patch: Partial<SvsUserConfig>) => void
  applyPreset: (preset: 'tactical' | 'expedition' | 'wellness' | 'silent') => void
} {
  const [config, setConfig] = useState(() => loadSvsConfig())

  useEffect(() => {
    const unsubscribe = subscribeConfigChanges((newConfig) => {
      setConfig(newConfig)
    })
    return unsubscribe
  }, [])

  const updateConfig = useCallback((patch: Partial<SvsUserConfig>) => {
    updateSvsConfig(patch)
  }, [])

  const applyPreset = useCallback(
    (preset: 'tactical' | 'expedition' | 'wellness' | 'silent') => {
      const presets: Record<string, Partial<SvsUserConfig>> = {
        tactical: { mode: 'tactical', frequency: 'minimal' },
        expedition: { mode: 'supportive', frequency: 'balanced', missionOnly: true },
        wellness: { mode: 'wellness', frequency: 'active' },
        silent: { enabled: false, mode: 'silent' },
      }
      updateSvsConfig(presets[preset]!)
    },
    [],
  )

  return { config, updateConfig, applyPreset }
}

/**
 * Hook for SVS diagnostics (for debug panels)
 */
export function useSvsDiagnostics(): SvsDiagnostics | null {
  const [diagnostics, setDiagnostics] = useState<SvsDiagnostics | null>(null)

  useEffect(() => {
    // Initial load
    setDiagnostics(getSvsDiagnostics())

    // Update every 10 seconds
    const interval = window.setInterval(() => {
      setDiagnostics(getSvsDiagnostics())
    }, 10_000)

    return () => window.clearInterval(interval)
  }, [])

  return diagnostics
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function estimateActivityMinutes(): number | null {
  // NO-OP GUARD: Session timer not integrated
  // Returns null to prevent wellness prompts from firing with bad data
  // To enable: Integrate with actual session start tracking
  return null
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export {
  SVS_CONFIG_DEFAULT,
  SVS_PRESETS,
  SVS_PRIORITY,
  type SvsEventType,
  type SvsFrequency,
  type SvsMode,
  type SvsPriority,
  type SvsUserConfig,
} from '../lib/svs'
