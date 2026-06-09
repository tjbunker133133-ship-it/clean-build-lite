/**
 * Map Intent System - Phase 1 Safe Extension
 * 
 * Provides radial menu and long-press gesture handling for map-first UX.
 * All functionality is ADDITIVE - existing click/tap/drag remains unchanged.
 */

import type { WaypointType } from '../../types'

export type RadialMenuPosition = {
  x: number
  y: number
  lng: number
  lat: number
}

export type RadialMenuItem = {
  id: string
  label: string
  icon?: string
  color?: string
  action: () => void
}

export type WaypointTypeOption = {
  type: WaypointType
  label: string
  icon: string
  color: string
}

export type RadialSystemOption = {
  id: string
  label: string
  icon: string
  color: string
  category: 'system' | 'safety'
}

// Primary ring: Waypoints
export const WAYPOINT_TYPE_OPTIONS: WaypointTypeOption[] = [
  { type: 'start', label: 'Start', icon: '🚩', color: '#22c55e' },
  { type: 'camp', label: 'Camp', icon: '⛺', color: '#34d399' },
  { type: 'water', label: 'Water', icon: '💧', color: '#38bdf8' },
  { type: 'rest', label: 'Rest', icon: '☕', color: '#fbbf24' },
  { type: 'poi', label: 'POI', icon: '🔍', color: '#a78bfa' },
  { type: 'pin', label: 'Pin', icon: '📍', color: '#ef4444' },
  { type: 'finish', label: 'Finish', icon: '🏁', color: '#f472b6' },
]

// Secondary ring: System access (Modern mode)
export const SYSTEM_TYPE_OPTIONS: RadialSystemOption[] = [
  { id: 'layers', label: 'Layers', icon: '🗺️', color: '#007AFF', category: 'system' },
  { id: 'weather', label: 'Weather', icon: '☁️', color: '#5AC8FA', category: 'system' },
  { id: 'mission', label: 'Mission', icon: '👥', color: '#34C759', category: 'system' },
  { id: 'checkin', label: 'Check-In', icon: '✓', color: '#FF9500', category: 'system' },
]

// Safety ring: Emergency access (Modern mode)
export const SAFETY_TYPE_OPTIONS: RadialSystemOption[] = [
  { id: 'sos', label: 'SOS', icon: '🆘', color: '#FF3B30', category: 'safety' },
  { id: 'beacon', label: 'Beacon', icon: '📡', color: '#FF9500', category: 'safety' },
]

export type LongPressState =
  | { kind: 'idle' }
  | { kind: 'pressing'; startX: number; startY: number; startTime: number }
  | { kind: 'triggered'; lng: number; lat: number; screenX: number; screenY: number }
  | { kind: 'cancelled' }

// Long press timing - 600ms feels responsive but prevents accidental triggers
export const LONG_PRESS_DURATION_MS = 600
export const LONG_PRESS_MOVE_THRESHOLD_PX = 25
