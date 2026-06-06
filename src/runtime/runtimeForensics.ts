/**
 * RUNTIME FORENSICS — Real browser execution tracing
 *
 * This module provides detailed tracing for production runtime issues.
 * These traces are NOT tests — they capture real browser behavior.
 */

import { logInfo, logWarn } from './logger'

// ============================================================================
// TTS LIFECYCLE TRACING
// ============================================================================

export type TTSTraceEvent =
  | 'speak_requested'
  | 'speak_rejected_priority'
  | 'speak_rejected_empty'
  | 'utterance_created'
  | 'utterance_onstart'
  | 'utterance_onend'
  | 'utterance_onerror'
  | 'utterance_cancelled'
  | 'synth_cancel_called'
  | 'synth_cancel_needed'
  | 'synth_speak_called'
  | 'synth_speak_threw'
  | 'synth_state_before'
  | 'synth_state_after_speak'
  | 'synth_state_after_cancel'
  | 'synth_pending_true'
  | 'synth_speaking_true'
  | 'synth_speaking_never_true'
  | 'android_speak_delay'
  | 'audio_focus_lost'
  | 'mobile_gesture_blocked'
  | 'cleanup_speech'
  | 'cleanup_speech_stale'
  | 'safety_timeout_fired'
  | 'interrupt_triggered'
  | 'state_notified'
  | 'repeat_last_failed'
  | 'repeat_last_succeeded'
  | 'tts_completed'
  | 'completion_callback_invoked'
  | 'recognition_restart_during_startup'
  | 'authority_bypassed'
  | 'safe_mode_raw_speak'
  | 'safe_mode_speak_called'
  | 'safe_mode_speak_threw'
  | 'safe_mode_utterance_onstart'
  | 'safe_mode_utterance_onend'
  | 'safe_mode_utterance_onerror'

export function traceTTS(event: TTSTraceEvent, details?: Record<string, unknown>): void {
  logInfo('RUNTIME', `FORENSIC[TTS] ${event}`, details)

  // Also push to global forensic buffer for live inspection
  pushForensicTrace('tts', event, details)
}

// ============================================================================
// OVERLAY RENDER TRACING
// ============================================================================

export type OverlayTraceEvent =
  | 'overlay_enabled'
  | 'overlay_disabled'
  | 'session_created'
  | 'session_invalidated'
  | 'style_wait_started'
  | 'style_wait_resolved'
  | 'style_wait_timeout'
  | 'zoom_blocked'
  | 'zoom_blocked_details'
  | 'fetch_request_start'
  | 'fetch_request_complete'
  | 'fetch_rate_limited'
  | 'fetch_http_error'
  | 'fetch_json_parsed'
  | 'fetch_timeout'
  | 'fetch_network_error'
  | 'fetch_overpass_geojson_start'
  | 'fetch_invalid_bbox'
  | 'fetch_query_built'
  | 'fetch_endpoint_attempt'
  | 'fetch_success'
  | 'fetch_endpoint_failed'
  | 'fetch_all_endpoints_failed'
  | 'render_seed_start'
  | 'render_seed_style_not_ready'
  | 'render_seed_data_check'
  | 'render_seed_complete'
  | 'render_seed_failed'
  | 'enhance_skipped_offline'
  | 'enhance_skipped_map_not_ready'
  | 'enhance_skipped_no_layer'
  | 'enhance_fetch_start'
  | 'enhance_empty_response'
  | 'enhance_fetch_success'
  | 'enhance_source_updated'
  | 'enhance_source_not_found'
  | 'enhance_failed_silent'
  | 'resilient_zoom_blocked'
  | 'resilient_enhance_bypassed'
  | 'resilient_activated'
  | 'resilient_deactivated'
  | 'resilient_sync_activate'
  | 'resilient_sync_visible'
  | 'resilient_sync_not_visible'
  | 'resilient_sync_deactivate'
  | 'resilient_enhance_complete'
  | 'fetch_started'
  | 'fetch_resolved'
  | 'fetch_threw'
  | 'raster_apply_attempt'
  | 'raster_apply_success'
  | 'raster_apply_fail'
  | 'geojson_apply_attempt'
  | 'geojson_source_exists'
  | 'geojson_source_added'
  | 'geojson_layer_check'
  | 'geojson_layer_added'
  | 'geojson_layer_exists'
  | 'geojson_data_updated'
  | 'source_attach_verified'
  | 'layer_attach_verified'
  | 'render_event_fired'
  | 'ready_committed'
  | 'empty_committed'
  | 'error_committed'
  | 'offline_fallback_committed'
  | 'offline_fallback_attempt'
  | 'timeout_forced'
  | 'cleanup_called'
  | 'stale_result_ignored'
  | 'run_started'
  | 'idle_committed'
  | 'render_verification'
  | 'attached_but_not_rendering'
  | 'delayed_render_verification'
  | 'features_not_rendering'
  | 'render_confirmed'
  | 'syncing_committed'

export function traceOverlay(event: OverlayTraceEvent, details?: Record<string, unknown>): void {
  logInfo('RUNTIME', `FORENSIC[OVERLAY] ${event}`, details)
  pushForensicTrace('overlay', event, details)
}

// ============================================================================
// VOICE RECOGNITION TRACING
// ============================================================================

export type VoiceTraceEvent =
  | 'wake_word_detected'
  | 'transcript_normalized'
  | 'command_matched'
  | 'command_unknown'
  | 'dispatch_started'
  | 'dispatch_resolved'
  | 'dispatch_threw'
  | 'dispatch_timeout'
  | 'tts_requested'
  | 'tts_completed'
  | 'recognition_restart_scheduled'
  | 'recognition_restart_cancelled'
  | 'recognition_onstart'
  | 'recognition_onend'
  | 'recognition_onerror'
  | 'recognition_paused_for_tts'
  | 'recognition_resumed_post_tts'
  | 'sr_pause_bypassed'
  | 'tts_minimal_path'
  | 'tts_minimal_started'
  | 'tts_minimal_path_command'
  | 'tts_minimal_failed'
  | 'tts_minimal_skipped'
  | 'tts_minimal_error'
  | 'disarm_triggered'
  | 'hard_off_called'
  | 'continuation_window_opened'
  | 'continuation_window_consumed'
  | 'continuation_window_expired'

export function traceVoice(event: VoiceTraceEvent, details?: Record<string, unknown>): void {
  logInfo('RUNTIME', `FORENSIC[VOICE] ${event}`, details)
  pushForensicTrace('voice', event, details)
}

// ============================================================================
// COMMAND EXECUTION TRACING
// ============================================================================

export type CommandTraceEvent =
  | 'command_received'
  | 'command_normalized'
  | 'command_match_attempt'
  | 'command_match_result'
  | 'command_id_matched'
  | 'command_alias_matched'
  | 'command_no_match'
  | 'handler_found'
  | 'handler_not_found'
  | 'handler_started'
  | 'handler_resolved'
  | 'handler_rejected'
  | 'handler_threw'
  | 'verifier_started'
  | 'verifier_resolved_ok'
  | 'verifier_resolved_fail'
  | 'verifier_threw'
  | 'verifier_timeout'
  | 'terminal_state_reached'
  | 'safety_timeout_triggered'

export function traceCommand(event: CommandTraceEvent, details?: Record<string, unknown>): void {
  logInfo('RUNTIME', `FORENSIC[COMMAND] ${event}`, details)
  pushForensicTrace('command', event, details)
}

// ============================================================================
// FORENSIC BUFFER — Live runtime inspection
// ============================================================================

interface ForensicEntry {
  ts: number
  category: 'tts' | 'overlay' | 'voice' | 'command'
  event: string
  details?: Record<string, unknown>
}

const FORENSIC_BUFFER_SIZE = 100
const forensicBuffer: ForensicEntry[] = []

function pushForensicTrace(
  category: ForensicEntry['category'],
  event: string,
  details?: Record<string, unknown>,
): void {
  forensicBuffer.push({
    ts: Date.now(),
    category,
    event,
    details,
  })
  while (forensicBuffer.length > FORENSIC_BUFFER_SIZE) {
    forensicBuffer.shift()
  }
}

export function getForensicBuffer(): ForensicEntry[] {
  return [...forensicBuffer]
}

export function getForensicTracesByCategory(category: ForensicEntry['category']): ForensicEntry[] {
  return forensicBuffer.filter((e) => e.category === category)
}

export function clearForensicBuffer(): void {
  forensicBuffer.length = 0
}

// ============================================================================
// BROWSER API STATE INSPECTION
// ============================================================================

export function inspectSpeechSynthesis(): {
  supported: boolean
  speaking: boolean
  pending: boolean
  paused: boolean
  voices: number
} {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return { supported: false, speaking: false, pending: false, paused: false, voices: 0 }
  }

  const synth = window.speechSynthesis
  return {
    supported: true,
    speaking: synth.speaking,
    pending: synth.pending,
    paused: synth.paused,
    voices: synth.getVoices().length,
  }
}

export function inspectMapOverlayState(
  mapArg: import('maplibre-gl').Map | null | undefined,
  overlayId: string,
): {
  mapExists: boolean
  styleReady: boolean
  sourceExists: boolean
  layerExists: boolean
  sourceLoaded?: boolean
} {
  // FIELD DIAGNOSTIC: Auto-get map from global if not provided
  const map = mapArg ?? (typeof window !== 'undefined'
    ? (window as unknown as { __hudMap?: import('maplibre-gl').Map }).__hudMap
    : undefined)

  if (!map) {
    return { mapExists: false, styleReady: false, sourceExists: false, layerExists: false }
  }

  const sourceId = `hud-env-src-${overlayId}`
  const layerId = `hud-env-lyr-${overlayId}`

  try {
    const style = map.getStyle()
    const source = map.getSource(sourceId)
    const layer = map.getLayer(layerId)

    // Check if source has loaded data
    let sourceLoaded = false
    if (source && 'loaded' in source) {
      sourceLoaded = (source as { loaded?: () => boolean }).loaded?.() ?? false
    }

    return {
      mapExists: true,
      styleReady: style != null,
      sourceExists: source != null,
      layerExists: layer != null,
      sourceLoaded,
    }
  } catch (err) {
    return {
      mapExists: true,
      styleReady: false,
      sourceExists: false,
      layerExists: false,
      sourceLoaded: false,
    }
  }
}

// ============================================================================
// EXPOSURE TO GLOBAL FOR LIVE DEBUGGING
// ============================================================================

function initializeForensicsApi() {
  if (typeof window === 'undefined') {
    console.log('[FORENSICS] Window not available, deferring initialization')
    return false
  }

  const w = window as unknown as {
    __hudForensics?: {
      getBuffer: typeof getForensicBuffer
      getTracesByCategory: typeof getForensicTracesByCategory
      clearBuffer: typeof clearForensicBuffer
      inspectSpeechSynthesis: typeof inspectSpeechSynthesis
      inspectMapOverlayState: typeof inspectMapOverlayState
    }
  }
  w.__hudForensics = {
    getBuffer: getForensicBuffer,
    getTracesByCategory: getForensicTracesByCategory,
    clearBuffer: clearForensicBuffer,
    inspectSpeechSynthesis,
    inspectMapOverlayState,
  }
  console.log('[FORENSICS] __hudForensics initialized')
  return true
}

// Attempt immediate initialization
const forensicsInitialized = initializeForensicsApi()

// If window wasn't available (SSR/build), retry on DOMContentLoaded
if (!forensicsInitialized && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[FORENSICS] DOMContentLoaded fired, retrying initialization')
    initializeForensicsApi()
  })
}

// Also ensure initialization on window load (React hydration complete)
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    if (!(window as unknown as { __hudForensics?: unknown }).__hudForensics) {
      console.log('[FORENSICS] Window load fired, __hudForensics missing, forcing initialization')
      initializeForensicsApi()
    }
  })
}
