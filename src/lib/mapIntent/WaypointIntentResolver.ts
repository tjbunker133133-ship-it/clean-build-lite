/**
 * WaypointIntentResolver - Phase 2 Intent Unification
 *
 * Normalizes all waypoint creation paths through a single intent model:
 * Voice → Intent → createWaypoint()
 * Radial → Intent → createWaypoint()
 * Panel → Intent → createWaypoint()
 *
 * SAFETY: This is a normalization layer only. Does NOT modify:
 * - GPS acquisition logic
 * - Voice recognition core
 * - Map rendering
 * - Tier 1 safety systems
 */

export type WaypointIntentSource = 'voice' | 'radial' | 'panel'

export type WaypointIntent = {
  type: string
  source: WaypointIntentSource
  lat: number
  lng: number
  label?: string
  confidence?: number
  raw?: unknown
}

export class WaypointIntentResolver {
  static fromVoice(
    input: { type: string; confidence?: number },
    gps: { lat: number; lng: number },
  ): WaypointIntent {
    return {
      type: input.type,
      source: 'voice',
      lat: gps.lat,
      lng: gps.lng,
      confidence: input?.confidence ?? 1,
      raw: input,
    }
  }

  static fromRadial(
    input: { type: string; label?: string },
    mapPoint: { lat: number; lng: number },
  ): WaypointIntent {
    return {
      type: input.type,
      source: 'radial',
      lat: mapPoint.lat,
      lng: mapPoint.lng,
      label: input.label,
      raw: input,
    }
  }

  static fromPanel(
    type: string,
    gps: { lat: number; lng: number },
  ): WaypointIntent {
    return {
      type,
      source: 'panel',
      lat: gps.lat,
      lng: gps.lng,
    }
  }
}

/** Dev-only trace for intent debugging */
export function traceWaypointIntent(intent: WaypointIntent): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[WAYPOINT_INTENT]', intent)
  }
}
