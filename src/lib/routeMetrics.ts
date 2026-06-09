import type { Waypoint } from '../types'
import { formatDistanceMeters, haversineMeters } from './haversine'
import { osgGetMeasureUnits } from './operationalStateGraph'

export type RouteLeg = {
  from: { lat: number; lng: number; label?: string }
  to: { lat: number; lng: number; label?: string }
  distance: number
}

export type RouteMetrics = {
  legs: RouteLeg[]
  totalDistance: number
  estimatedDuration: number | null
}

const WALK_MPS = 1.4

export function buildRouteMetrics(waypoints: Waypoint[]): RouteMetrics {
  const active = waypoints.filter((w) => w.status !== 'archived')
  if (active.length < 2) {
    return { legs: [], totalDistance: 0, estimatedDuration: null }
  }

  const legs: RouteLeg[] = []
  let totalMeters = 0
  for (let i = 1; i < active.length; i++) {
    const from = active[i - 1]
    const to = active[i]
    const distance = haversineMeters(from.lat, from.lng, to.lat, to.lng)
    totalMeters += distance
    legs.push({
      from: { lat: from.lat, lng: from.lng, label: from.label },
      to: { lat: to.lat, lng: to.lng, label: to.label },
      distance,
    })
  }

  return {
    legs,
    totalDistance: totalMeters,
    estimatedDuration: Math.round(totalMeters / WALK_MPS),
  }
}

export function formatRouteDistance(meters: number, units?: 'imperial' | 'metric'): string {
  const resolved = units ?? osgGetMeasureUnits()
  return formatDistanceMeters(meters, resolved)
}

export function formatRouteDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes} min`
}
