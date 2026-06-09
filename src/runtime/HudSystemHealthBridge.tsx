import { useEffect, useMemo, useRef } from 'react'
import { useAppContext } from '../context/AppContext'
import { useCockpitOptional } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import { useOverlayContext } from '../context/OverlayContext'
import { useTrailRoute } from '../context/TrailRouteContext'
import { ENVIRONMENTAL_OVERLAY_CATALOG } from '../lib/environmentalOverlays/catalog'
import { envLayerId } from '../lib/environmentalOverlays/mapOverlayRuntime'
import {
  __probeStyleForTrailLayersForTests,
  MIN_SNAP_ZOOM,
  OVERLAY_SNAP_LAYER_IDS,
} from '../lib/snapToTrail'
import { getDeviceProfile } from './deviceProfile'
import { recomputeHudSystemHealth, reportRouteLayerObservation } from './hudSystemHealth'
import { useDeviceHeading } from '../hooks/useDeviceHeading'
// SVS + WAL Integration - edge-triggered with dedupe guards
import { useSvs } from '../hooks/useSvs'
import { createWalRuntime, getWalPresetConfig, loadWalUserMode } from '../lib/wearables/wal'
import { traceVoice } from './runtimeForensics'

/**
 * Single integration point — derives health from existing hooks/contexts.
 * No UI, no duplicate sensor listeners, no polling.
 */
// Voice trigger dedupe guards - 15s minimum between any voice-related trigger
const VOICE_TRIGGER_COOLDOWN_MS = 15000
let lastSvsTriggerAt = 0
let lastWalTriggerAt = 0

// ============================================================================
// SVS vs WAL ARBITRATION TYPES (local to this component)
// ============================================================================

type VoiceCandidate =
  | { type: 'svs'; payload: { promptId?: string; text?: string; delivered?: boolean } }
  | { type: 'wal'; payload: { affirmations: string[]; suggestions: string[]; readiness: string[] } }
  | null

// Fingerprint-based dedupe (30s per identical output)
let lastVoiceFingerprint = ''
let lastVoiceTimestamp = 0
const VOICE_FINGERPRINT_COOLDOWN_MS = 30000

function arbitrateSVSvsWAL(svsCandidate: VoiceCandidate, walCandidate: VoiceCandidate): VoiceCandidate {
  // Priority: SVS wins ties (safety/operational over affirmation)
  if (svsCandidate && walCandidate) return svsCandidate
  if (svsCandidate) return svsCandidate
  if (walCandidate) return walCandidate
  return null
}

function createFingerprint(candidate: VoiceCandidate): string {
  if (!candidate) return 'none'
  if (candidate.type === 'svs') {
    return `svs:${candidate.payload.promptId ?? 'unknown'}:${(candidate.payload.text ?? '').slice(0, 30)}`
  }
  // WAL - hash affirmations + suggestions content
  const content = [...candidate.payload.affirmations, ...candidate.payload.suggestions].join('|').slice(0, 50)
  return `wal:${content}`
}

export default function HudSystemHealthBridge() {
  // ============================================================================
  // EXISTING HOOKS (unchanged)
  // ============================================================================
  const { heading, status } = useDeviceHeading()
  const { state } = useAppContext()
  const { waypoints, snapToTrailEnabled, trailSnapAssistCapable } = state
  const trailRoute = useTrailRoute()
  const { map } = useMapContext()
  const { toggles, status: overlayStatus } = useOverlayContext()
  const cockpit = useCockpitOptional()
  const panels = cockpit?.panels ?? {}
  const profile = getDeviceProfile()

  // ============================================================================
  // SVS INTEGRATION - Mount hook (silently runs its own detection)
  // ============================================================================
  const svs = useSvs()

  // Track SVS deliveries for edge-trigger detection
  const prevSvsDeliveryRef = useRef<string | null>(null)

  // SVS candidate ref - populated by detection effect, consumed by arbitration
  const svsCandidateRef = useRef<VoiceCandidate>(null)

  // ============================================================================
  // WAL INTEGRATION - Local runtime instance (interpreter only, no sensors)
  // ============================================================================
  const walModeRef = useRef(loadWalUserMode())
  const walRuntimeRef = useRef(createWalRuntime())
  const walPresetRef = useRef(getWalPresetConfig(walModeRef.current))

  // Initialize WAL runtime once
  useEffect(() => {
    walRuntimeRef.current.setUserMode(walModeRef.current)
  }, [])

  // Track WAL interpretation for edge-trigger detection
  const prevWalInterpretationRef = useRef<string>('')

  // WAL candidate ref - populated by detection effect, consumed by arbitration
  const walCandidateRef = useRef<VoiceCandidate>(null)

  const visibleWaypointCount = useMemo(
    () => waypoints.filter((w) => w.status !== 'archived').length,
    [waypoints],
  )

  const trailLegTrailModeCount = useMemo(
    () => trailRoute.legs.filter((leg) => leg.mode === 'trail').length,
    [trailRoute.legs],
  )

  const overlayLayers = useMemo(() => {
    return ENVIRONMENTAL_OVERLAY_CATALOG.map((def) => {
      const layerId = envLayerId(def.id)
      let layerOnMap = false
      try {
        layerOnMap = Boolean(map?.getLayer(layerId))
      } catch {
        layerOnMap = false
      }
      const st = overlayStatus[def.id]
      return {
        id: def.id,
        toggle: toggles[def.id],
        loading: st?.loading ?? false,
        error: st?.error ?? null,
        layerOnMap,
        stale: st?.stale ?? false,
      }
    })
  }, [map, toggles, overlayStatus])

  const mapSignals = useMemo(() => {
    if (!map) {
      return {
        mapPresent: false,
        mapZoom: null as number | null,
        styleHasVectorTrails: false,
        overlaySnapLayersActive: false,
      }
    }
    let mapZoom: number | null = null
    try {
      mapZoom = map.getZoom()
    } catch {
      mapZoom = null
    }
    let styleHasVectorTrails = false
    try {
      const probe = __probeStyleForTrailLayersForTests(map)
      styleHasVectorTrails =
        probe.matchedTransportationSourceLayers > 0 || probe.matchedTrailIdLayers > 0
    } catch {
      styleHasVectorTrails = false
    }
    let overlaySnapLayersActive = false
    for (const id of OVERLAY_SNAP_LAYER_IDS) {
      try {
        if (map.getLayer(id)) {
          overlaySnapLayersActive = true
          break
        }
      } catch {
        /* ignore */
      }
    }
    return { mapPresent: true, mapZoom, styleHasVectorTrails, overlaySnapLayersActive }
  }, [map])

  useEffect(() => {
    reportRouteLayerObservation({ waypointCount: visibleWaypointCount })
  }, [visibleWaypointCount])

  // ============================================================================
  // SVS EDGE-TRIGGER DETECTION (populates candidate for arbitration)
  // ============================================================================
  useEffect(() => {
    // Edge detection: New delivery appeared
    const currentDelivery = svs.lastDelivery
    if (!currentDelivery) {
      svsCandidateRef.current = null
      return
    }

    const deliveryKey = `${currentDelivery.promptId}-${currentDelivery.timestamp}`
    if (prevSvsDeliveryRef.current === deliveryKey) {
      // No change - candidate already set or null
      return
    }

    prevSvsDeliveryRef.current = deliveryKey

    // Set candidate for arbitration (even if delivered=false, for trace logging)
    svsCandidateRef.current = {
      type: 'svs',
      payload: {
        promptId: currentDelivery.promptId,
        text: currentDelivery.text,
        delivered: currentDelivery.delivered,
      },
    }
  }, [svs.lastDelivery])

  // ============================================================================
  // WAL EDGE-TRIGGER DETECTION (populates candidate for arbitration)
  // ============================================================================
  useEffect(() => {
    const interpretation = walRuntimeRef.current.getInterpretation()
    if (!interpretation) {
      walCandidateRef.current = null
      return
    }

    // Create signature of interpretation state
    const interpretationKey = JSON.stringify({
      affirmations: interpretation.affirmations,
      suggestions: interpretation.suggestions,
      readiness: interpretation.readiness.map((r) => r.id),
    })

    if (prevWalInterpretationRef.current === interpretationKey) {
      // No change
      return
    }

    prevWalInterpretationRef.current = interpretationKey

    // Only trigger if there's actual content (not empty)
    const hasContent =
      interpretation.affirmations.length > 0 ||
      interpretation.suggestions.length > 0 ||
      interpretation.readiness.length > 0

    if (!hasContent) {
      walCandidateRef.current = null
      return
    }

    // Set candidate for arbitration
    walCandidateRef.current = {
      type: 'wal',
      payload: {
        affirmations: interpretation.affirmations,
        suggestions: interpretation.suggestions,
        readiness: interpretation.readiness.map((r) => r.id),
      },
    }
  }, [
    // Trigger on discrete state changes only
    heading,
    status,
    trailSnapAssistCapable,
    snapToTrailEnabled,
    trailRoute.legs.length,
    visibleWaypointCount,
  ])

  // ============================================================================
  // SVS vs WAL ARBITRATION - SINGLE OUTPUT GUARANTEE
  // ============================================================================
  useEffect(() => {
    const svsCandidate = svsCandidateRef.current
    const walCandidate = walCandidateRef.current

    // Arbitration: Choose ONE candidate (SVS wins ties)
    const chosen = arbitrateSVSvsWAL(svsCandidate, walCandidate)

    // Clear candidates (consumed)
    svsCandidateRef.current = null
    walCandidateRef.current = null

    // Nothing to process
    if (!chosen) return

    // Fingerprint dedupe: 30s cooldown per identical output
    const now = Date.now()
    const fp = createFingerprint(chosen)

    if (fp === lastVoiceFingerprint && now - lastVoiceTimestamp < VOICE_FINGERPRINT_COOLDOWN_MS) {
      traceVoice('svs_wal_dedup_blocked', {
        fingerprint: fp,
        source: chosen.type,
        reason: 'identical_content_cooldown',
        cooldownMs: VOICE_FINGERPRINT_COOLDOWN_MS,
        lastOutput: lastVoiceTimestamp,
      })
      return
    }

    // Update dedupe state
    lastVoiceFingerprint = fp
    lastVoiceTimestamp = now

    // Process the chosen candidate
    if (chosen.type === 'svs') {
      // Update legacy cooldown for backward compatibility
      lastSvsTriggerAt = now

      // Log to forensics (SVS already spoke via its own TTS, we observe)
      traceVoice('svs_triggered_from_health_bridge', {
        delivered: chosen.payload.delivered,
        promptId: chosen.payload.promptId,
        text: chosen.payload.text?.slice(0, 50),
      })

      // SVS handled voice through voiceAudioArbitration - no action needed here
    } else if (chosen.type === 'wal') {
      // Update legacy cooldown for backward compatibility
      lastWalTriggerAt = now

      // Log to forensics
      traceVoice('wal_triggered_from_health_bridge', {
        affirmationsCount: chosen.payload.affirmations.length,
        suggestionsCount: chosen.payload.suggestions.length,
        readinessCount: chosen.payload.readiness.length,
        affirmations: chosen.payload.affirmations.slice(0, 3),
      })

      // WAL affirmations are NON-USER-FACING by design (observation only)
      // To enable: Route through SVS arbitration or call speakMinimal() directly
      // Blocked by: fingerprint dedupe guard above prevents duplicate voice output
      traceVoice('wal_affirmations_dropped_non_user_facing', {
        reason: 'observation_only_by_design',
        affirmations: chosen.payload.affirmations,
        note: 'Route through SVS or call speakMinimal() to enable',
      })
    }
  }, [
    // React to both candidate sources
    svs.lastDelivery,
    heading,
    status,
    trailSnapAssistCapable,
    snapToTrailEnabled,
    trailRoute.legs.length,
    visibleWaypointCount,
  ])

  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const panelLayoutSig = useMemo(() => {
    return Object.entries(panels)
      .filter(([, p]) => p?.docked)
      .map(([id, p]) => `${id}:${p!.x}:${p!.y}:${p!.w}:${p!.h}`)
      .sort()
      .join('|')
  }, [panels])

  useEffect(() => {
    const base = {
      heading,
      compassStatus: status,
      snapToggleCapable: trailSnapAssistCapable,
      snapToggleEnabled: snapToTrailEnabled,
      trailLegCount: trailRoute.legs.length,
      trailLegTrailModeCount,
      overlayLayers,
      vw: profile.width,
      vh: profile.height,
      isMobile: profile.interactionMode === 'mobile',
      mapZoom: mapSignals.mapZoom,
      minSnapZoom: MIN_SNAP_ZOOM,
      styleHasVectorTrails: mapSignals.styleHasVectorTrails,
      overlaySnapLayersActive: mapSignals.overlaySnapLayersActive,
      mapPresent: mapSignals.mapPresent,
    }
    recomputeHudSystemHealth({ ...base, panels: panelsRef.current })
    const timer = window.setTimeout(() => {
      recomputeHudSystemHealth({ ...base, panels: panelsRef.current })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [
    heading,
    status,
    trailSnapAssistCapable,
    snapToTrailEnabled,
    trailRoute.legs.length,
    trailLegTrailModeCount,
    overlayLayers,
    panelLayoutSig,
    profile.width,
    profile.height,
    profile.interactionMode,
    mapSignals,
  ])

  return null
}
