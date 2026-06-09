/**
 * Modern interaction physics — authoritative gesture semantics for immersive mode.
 *
 * Does NOT import Balanced or Classic interaction modules.
 * Consumes: raw map events, OSG snapshots, presentation context.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import type { RadialMenuAction } from '../../components/RadialIntentMenu'
import type { RadialMenuPosition } from '../../lib/mapIntent/types'
import { WaypointIntentResolver, traceWaypointIntent } from '../../lib/mapIntent/WaypointIntentResolver'
import { createWaypoint } from '../../lib/waypoints/createWaypoint'
import type { Waypoint } from '../../types'
import { hudConfirm } from '../../lib/hudConfirm'
import { requestCameraIntent } from '../../lib/operationalPerception/perceptionEngine'
import { osgRecordMapSurfacePulse } from '../../lib/operationalStateGraph'
import { markRadialMenuInteractionGrace, setRadialMenuActive } from '../../lib/waypointMarkerTouchGate'
import {
  findNearestTrailCandidate,
  isSnapAvailable,
  MAX_SNAP_RADIUS_M,
} from '../../lib/snapToTrail'
import type { MapTapEvent } from '../../lib/mapInteractionRegistry'
import {
  logModernGuardrailApplied,
  logModernGuardrailTransition,
} from '../../lib/modernLayerGuardrails'

logModernGuardrailApplied('ModernInteractionController')

/** Modern field-scan hold — faster than workspace long-press (600ms). */
export const MODERN_FIELD_SCAN_HOLD_MS = 420

export type ModernFieldScanPhase = 'armed' | 'engaged' | 'dormant'

export type ModernInteractionState = {
  fieldScanPhase: ModernFieldScanPhase
  radialActive: boolean
}

export type ModernRadialActionContext = {
  map: MapLibreMap | null
  radialPosition: RadialMenuPosition
  waypoints: Waypoint[]
  activeLayer: string
  snapToTrailEnabled: boolean
  addWaypoint: (wp: Waypoint) => void
  setWaypoints: (wps: Waypoint[]) => void
  onOpenOverlay?: (id: string) => void
}

export function createInitialModernInteractionState(): ModernInteractionState {
  return { fieldScanPhase: 'armed', radialActive: false }
}

export function onModernIdleMapTap(event: MapTapEvent): void {
  if (event.waypointPlaced) return
  osgRecordMapSurfacePulse(event.lat, event.lng)
}

export function onModernLongPressEngaged(
  state: ModernInteractionState,
): ModernInteractionState {
  return { ...state, fieldScanPhase: 'engaged', radialActive: true }
}

export function onModernRadialDismissed(
  state: ModernInteractionState,
): ModernInteractionState {
  return { ...state, fieldScanPhase: 'armed', radialActive: false }
}

export function onModernOverlayOpened(
  state: ModernInteractionState,
): ModernInteractionState {
  return { ...state, fieldScanPhase: 'dormant', radialActive: false }
}

export function onModernOverlayClosed(
  state: ModernInteractionState,
): ModernInteractionState {
  return { ...state, fieldScanPhase: 'armed', radialActive: false }
}

/** GPS center-once when operator has not taken viewport control. */
export function modernCenterOnGpsOnce(
  map: MapLibreMap | null,
  gps: { lat: number | null; lng: number | null },
  userHasTakenControl: boolean,
  alreadyCentered: { current: boolean },
): void {
  if (alreadyCentered.current || userHasTakenControl) return
  if (gps.lat == null || gps.lng == null) return
  requestCameraIntent({
    kind: 'ease_to',
    center: [gps.lng, gps.lat],
    zoom: 14,
    durationMs: 480,
  })
  alreadyCentered.current = true
}

export function handleModernRadialAction(
  action: RadialMenuAction,
  ctx: ModernRadialActionContext,
): void {
  markRadialMenuInteractionGrace()
  const { radialPosition, map, waypoints, onOpenOverlay, setWaypoints, addWaypoint } = ctx

  switch (action.kind) {
    case 'waypoint': {
      const type = action.type
      let finalLat = radialPosition.lat
      let finalLng = radialPosition.lng
      let snapApplied = false
      let snapDistanceMeters: number | undefined

      if (
        map &&
        ctx.snapToTrailEnabled &&
        ctx.activeLayer === 'outdoor' &&
        isSnapAvailable(map)
      ) {
        const cand = findNearestTrailCandidate(map, {
          lat: radialPosition.lat,
          lng: radialPosition.lng,
          radiusMeters: MAX_SNAP_RADIUS_M,
        })
        if (cand) {
          finalLat = cand.snappedLat
          finalLng = cand.snappedLng
          snapApplied = true
          snapDistanceMeters = cand.distanceMeters
        }
      }

      const nextIdx = waypoints.length + 1
      const autoBase =
        type === 'default'
          ? 'WP'
          : type === 'finish'
            ? 'FINISH'
            : type === 'start'
              ? 'START'
              : type === 'rest'
                ? 'REST'
                : type.toUpperCase()
      const label = action.label || `${autoBase}-${nextIdx}`

      const intent = WaypointIntentResolver.fromRadial({ type, label }, { lat: finalLat, lng: finalLng })
      traceWaypointIntent(intent)
      let waypoint = createWaypoint(intent)
      if (!waypoint) break

      if (snapApplied) {
        waypoint = {
          ...waypoint,
          rawLat: radialPosition.lat,
          rawLng: radialPosition.lng,
          source: 'snapped',
          snapDistanceMeters,
        }
      }
      addWaypoint(waypoint)
      logModernGuardrailTransition('waypoint-add', {
        type: waypoint.type,
        snapApplied,
      })
      break
    }

    case 'center_map':
      logModernGuardrailTransition('radial-release', { action: 'center_map' })
      requestCameraIntent({
        kind: 'ease_to',
        center: [radialPosition.lng, radialPosition.lat],
        durationMs: 480,
      })
      break

    case 'zoom_in':
      logModernGuardrailTransition('radial-release', { action: 'zoom_in' })
      requestCameraIntent({ kind: 'zoom_by', delta: 1, durationMs: 250 })
      break

    case 'zoom_out':
      logModernGuardrailTransition('radial-release', { action: 'zoom_out' })
      requestCameraIntent({ kind: 'zoom_by', delta: -1, durationMs: 250 })
      break

    case 'layers':
      onOpenOverlay?.('layers')
      break

    case 'weather':
      onOpenOverlay?.('weather')
      break

    case 'mission':
      onOpenOverlay?.('mission')
      break

    case 'checkin':
      onOpenOverlay?.('checkin')
      break

    case 'navigate_here':
      onOpenOverlay?.('route')
      requestCameraIntent({
        kind: 'ease_to',
        center: [radialPosition.lng, radialPosition.lat],
        durationMs: 480,
      })
      break

    case 'share_location': {
      const shareText = `Location: ${radialPosition.lat.toFixed(5)}, ${radialPosition.lng.toFixed(5)}`
      if (navigator.share) {
        void navigator.share({ title: 'Shared Location', text: shareText }).catch(() => {})
      } else if (navigator.clipboard) {
        void navigator.clipboard.writeText(shareText)
      }
      break
    }

    case 'clear_waypoints':
      if (waypoints.length > 0) {
        void hudConfirm({
          title: 'Clear all waypoints?',
          message: `Remove all ${waypoints.length} waypoints from the map?`,
          confirmLabel: 'Clear all',
          destructive: true,
        }).then((ok) => {
          if (ok) setWaypoints([])
        })
      }
      break

    case 'clear_route':
      if (waypoints.length > 0) {
        void hudConfirm({
          title: 'Clear route?',
          message: `Remove all ${waypoints.length} waypoints from this route?`,
          confirmLabel: 'Clear route',
          destructive: true,
        }).then((ok) => {
          if (ok) setWaypoints([])
        })
      }
      break

    case 'dismiss':
    default:
      break
  }

  setRadialMenuActive(false)
}

export function modernFieldScanIdleLabel(phase: ModernFieldScanPhase): string {
  switch (phase) {
    case 'armed':
      return `Field scan armed · hold ${MODERN_FIELD_SCAN_HOLD_MS}ms`
    case 'engaged':
      return 'Field scan active'
    case 'dormant':
      return 'Field tools open'
  }
}
