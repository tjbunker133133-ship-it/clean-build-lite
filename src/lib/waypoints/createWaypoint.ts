/**
 * Unified Waypoint Creation - Phase 2 Intent Sink
 *
 * Single entry point for all waypoint creation paths.
 * Normalizes intent into a Waypoint object for addition to store.
 *
 * SAFETY: This is a pure transformation function. Does NOT:
 * - Modify GPS logic
 * - Access React Context directly
 * - Create side effects
 */

import type { Waypoint, WaypointType } from '../../types'
import type { WaypointIntent } from '../mapIntent/WaypointIntentResolver'

/**
 * Validates and transforms a WaypointIntent into a Waypoint object.
 * Returns null if intent is invalid (caller should handle gracefully).
 */
export function createWaypoint(intent: WaypointIntent): Waypoint | null {
  // Validate coordinates
  if (!Number.isFinite(intent.lat) || !Number.isFinite(intent.lng)) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[createWaypoint] Invalid coordinates:', intent)
    }
    return null
  }

  // Validate type
  const validTypes: WaypointType[] = [
    'default',
    'start',
    'camp',
    'water',
    'rest',
    'poi',
    'pin',
    'finish',
  ]
  const type = validTypes.includes(intent.type as WaypointType)
    ? (intent.type as WaypointType)
    : 'default'

  // Generate label if not provided
  const label =
    intent.label || `${type.toUpperCase()}-${Date.now().toString(36).slice(-4)}`

  const waypoint: Waypoint = {
    id: generateWaypointId(intent.source),
    type,
    lat: intent.lat,
    lng: intent.lng,
    label,
    createdAt: Date.now(),
    // Preserve intent metadata for debugging/telemetry
    source: intent.source === 'radial' ? 'manual' : 'manual',
  }

  return waypoint
}

/** Generate unique waypoint ID with source prefix for debugging */
function generateWaypointId(source: string): string {
  const prefix = source.slice(0, 3) // voi, rad, pan
  const rand = Math.random().toString(36).slice(2, 7)
  const time = Date.now().toString(36).slice(-4)
  return `wp_${prefix}_${time}_${rand}`
}

/**
 * Helper to check if an intent is valid before creating.
 * Useful for UI guard clauses.
 */
export function isValidWaypointIntent(intent: unknown): intent is WaypointIntent {
  if (!intent || typeof intent !== 'object') return false
  const i = intent as Partial<WaypointIntent>
  return (
    typeof i.type === 'string' &&
    typeof i.lat === 'number' &&
    Number.isFinite(i.lat) &&
    typeof i.lng === 'number' &&
    Number.isFinite(i.lng) &&
    (i.source === 'voice' || i.source === 'radial' || i.source === 'panel')
  )
}
