/**
 * Communications Recovery Overlay (CRO) - React Hook
 *
 * Integrates CRO with HUD React context.
 *
 * Watches:
 * - Network state
 * - Mission sync state
 * - GPS position
 * - User's overlay settings
 *
 * Provides:
 * - Signal state detection
 * - Recovery direction calculation
 * - Tower/recovery point management
 * - SVS integration for voice prompts
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { useGPS } from './useGPS'
import type {
  CroConfig,
  CroSignalState,
  CroState,
  RecoveryDirection,
} from '../lib/cro'
import {
  analyzeRecoveryDirections,
  CRO_CONFIG_DEFAULT,
  detectSignalState,
  getCachedTowers,
  getRecoveryPoints,
  loadCroData,
  recordRecoveryPoint,
} from '../lib/cro'
import { logInfo, logWarn } from '../runtime/logger'

// ============================================================================
// HOOK INTERFACE
// ============================================================================

export interface CroHookResult {
  // State
  signalState: CroSignalState
  directions: RecoveryDirection[]
  isVisible: boolean

  // Configuration
  config: CroConfig
  updateConfig: (patch: Partial<CroConfig>) => void

  // Actions
  dismiss: () => void
  recordSuccess: () => void
  refresh: () => void

  // Debug
  stats: {
    towerCount: number
    recoveryPointCount: number
  }
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useCro(): CroHookResult {
  const gps = useGPS()
  const missionSync = useMissionSync()

  const [config, setConfig] = useState<CroConfig>(() => {
    // Load from localStorage if available
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('hud_cro_config')
        if (raw) {
          const parsed = JSON.parse(raw)
          return { ...CRO_CONFIG_DEFAULT, ...parsed }
        }
      } catch {
        // Fall through to default
      }
    }
    return CRO_CONFIG_DEFAULT
  })

  const [signalState, setSignalState] = useState<CroSignalState>('unknown')
  const [directions, setDirections] = useState<RecoveryDirection[]>([])
  const [manuallyDismissed, setManuallyDismissed] = useState(false)
  const lastAnalysisRef = useRef<number>(0)
  const analysisThrottleRef = useRef<number | null>(null)

  // Memoized cached data
  const towers = useMemo(() => getCachedTowers(), [signalState])
  const recoveryPoints = useMemo(() => getRecoveryPoints(), [signalState])

  // ============================================================================
  // SIGNAL STATE DETECTION
  // ============================================================================

  useEffect(() => {
    const state = detectSignalState(
      typeof navigator !== 'undefined' ? navigator.onLine : true,
      missionSync.peers.length,
      missionSync.lastSyncAt,
    )
    setSignalState(state)

    // Auto-clear manual dismiss on reconnect
    if (state === 'connected' && config.autoDismissOnReconnect && manuallyDismissed) {
      setTimeout(() => setManuallyDismissed(false), config.dismissDelayMs)
    }
  }, [
    missionSync.peers.length,
    missionSync.lastSyncAt,
    config.autoDismissOnReconnect,
    config.dismissDelayMs,
    manuallyDismissed,
  ])

  // ============================================================================
  // RECOVERY DIRECTION ANALYSIS
  // ============================================================================

  const analyzeDirections = useCallback(() => {
    if (signalState === 'connected') {
      setDirections([])
      return
    }

    if (!gps.lat || !gps.lng) {
      setDirections([])
      return
    }

    // Throttle analysis to once per 5 seconds
    const now = Date.now()
    if (now - lastAnalysisRef.current < 5000) {
      return
    }
    lastAnalysisRef.current = now

    const croState: CroState = {
      signalState,
      lastConnectedAt: missionSync.lastSyncAt,
      lastKnownLocation: gps.lat && gps.lng ? { lat: gps.lat, lng: gps.lng } : null,
      degradationDurationMs: missionSync.lastSyncAt ? Date.now() - missionSync.lastSyncAt : 0,
    }

    const dirs = analyzeRecoveryDirections(
      { lat: gps.lat, lng: gps.lng },
      gps.elevation ?? null,
      croState,
      towers,
      recoveryPoints,
      undefined, // Use default weights
      config.maxDirections,
    )

    // Filter by minimum confidence
    const filtered = dirs.filter((d) => {
      if (config.minConfidence === 'high') return d.confidence === 'high'
      if (config.minConfidence === 'medium') return d.confidence === 'high' || d.confidence === 'medium'
      return true // 'low' shows all
    })

    setDirections(filtered)

    logInfo('CRO', 'Analysis complete', {
      directions: filtered.length,
      signalState,
    })
  }, [
    gps.lat,
    gps.lng,
    gps.elevation,
    signalState,
    missionSync.lastSyncAt,
    towers,
    recoveryPoints,
    config.maxDirections,
    config.minConfidence,
  ])

  // Trigger analysis when signal degrades
  useEffect(() => {
    if (signalState === 'weak' || signalState === 'none') {
      // Clear any pending throttle
      if (analysisThrottleRef.current) {
        window.clearTimeout(analysisThrottleRef.current)
      }
      // Analyze immediately
      analyzeDirections()
    } else {
      setDirections([])
    }
  }, [signalState, analyzeDirections])

  // Periodic re-analysis (every 30s when degraded)
  useEffect(() => {
    if (signalState !== 'weak' && signalState !== 'none') return

    const interval = window.setInterval(() => {
      analyzeDirections()
    }, 30000)

    return () => window.clearInterval(interval)
  }, [signalState, analyzeDirections])

  // ============================================================================
  // ACTIONS
  // ============================================================================

  const updateConfig = useCallback((patch: Partial<CroConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...patch }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('hud_cro_config', JSON.stringify(updated))
      }
      return updated
    })
  }, [])

  const dismiss = useCallback(() => {
    setManuallyDismissed(true)
    setDirections([])
    logInfo('CRO', 'Manually dismissed')
  }, [])

  const recordSuccess = useCallback(() => {
    if (!gps.lat || !gps.lng) {
      logWarn('CRO', 'Cannot record success - no GPS fix')
      return
    }

    recordRecoveryPoint({
      lat: gps.lat,
      lng: gps.lng,
      elevationMeters: gps.elevation ?? 0,
      networkType: 'cellular',
      quality: signalState === 'connected' ? 'good' : 'marginal',
    })

    logInfo('CRO', 'Recorded recovery point', { lat: gps.lat, lng: gps.lng })
  }, [gps.lat, gps.lng, gps.elevation, signalState])

  const refresh = useCallback(() => {
    lastAnalysisRef.current = 0
    analyzeDirections()
  }, [analyzeDirections])

  // ============================================================================
  // VISIBILITY LOGIC
  // ============================================================================

  const isVisible = useMemo(() => {
    if (!config.enabled) return false
    if (manuallyDismissed) return false
    if (!config.showWhenSignal.includes(signalState)) return false
    return directions.length > 0
  }, [config.enabled, config.showWhenSignal, manuallyDismissed, signalState, directions.length])

  // ============================================================================
  // RENDER
  // ============================================================================

  return {
    signalState,
    directions,
    isVisible,
    config,
    updateConfig,
    dismiss,
    recordSuccess,
    refresh,
    stats: {
      towerCount: towers.length,
      recoveryPointCount: recoveryPoints.length,
    },
  }
}
