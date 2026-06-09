/**
 * Balanced workspace radial actions — separate from Modern interaction physics.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import type { RadialMenuAction } from '../../components/RadialIntentMenu'
import type { RadialMenuPosition } from '../../lib/mapIntent/types'
import { WaypointIntentResolver, traceWaypointIntent } from '../../lib/mapIntent/WaypointIntentResolver'
import { createWaypoint } from '../../lib/waypoints/createWaypoint'
import type { Waypoint } from '../../types'
import { hudConfirm } from '../../lib/hudConfirm'
import { requestCameraIntent } from '../../lib/operationalPerception/perceptionEngine'
import { markRadialMenuInteractionGrace, setRadialMenuActive } from '../../lib/waypointMarkerTouchGate'
import {
  findNearestTrailCandidate,
  isSnapAvailable,
  MAX_SNAP_RADIUS_M,
} from '../../lib/snapToTrail'

export type BalancedRadialActionContext = {
  map: MapLibreMap | null
  radialPosition: RadialMenuPosition
  waypoints: Waypoint[]
  activeLayer: string
  snapToTrailEnabled: boolean
  addWaypoint: (wp: Waypoint) => void
  setWaypoints: (wps: Waypoint[]) => void
  onOpenOverlay?: (id: string) => void
}

export function handleBalancedRadialAction(
  action: RadialMenuAction,
  ctx: BalancedRadialActionContext,
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
      break
    }

    case 'center_map':
      requestCameraIntent({
        kind: 'ease_to',
        center: [radialPosition.lng, radialPosition.lat],
        durationMs: 480,
      })
      break

    case 'zoom_in':
      requestCameraIntent({ kind: 'zoom_by', delta: 1, durationMs: 250 })
      break

    case 'zoom_out':
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
