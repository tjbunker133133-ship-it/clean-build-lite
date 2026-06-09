/**
 * Radial Intent Menu - Modern Mode Primary UI
 * 
 * THE PRIMARY INTERACTION MODEL FOR MODERN MODE.
 * 
 * REDESIGNED: Feature-first architecture
 * - Primary ring: Tools & Info (Layers, Weather, Mission, Check-in)
 * - Secondary ring: Waypoints (Start, Camp, Water, POI, Pin, etc.)
 * - Center: Map controls
 * - Preview panels: Contextual information on hover
 * - Smart defaults: Most-used actions at accessible positions
 * 
 * UX PRINCIPLES:
 * - In Modern mode, users want INFORMATION first, waypoints second
 * - Hover reveals what will happen (preview panels)
 * - One tap executes, no confirmation
 * - Visual feedback on every interaction
 * - Apple-like refinement with spring animations
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ModePortal } from '../lib/presentationIsolation'
import type { WaypointType } from '../types'
import {
  WAYPOINT_TYPE_OPTIONS,
  type RadialMenuPosition,
} from '../lib/mapIntent/types'
import { useHudPresentation } from '../context/HudPresentationContext'
import { useAppContext } from '../context/AppContext'
import { useMissionSync } from '../context/MissionSyncContext'
import { markRadialMenuInteractionGrace } from '../lib/waypointMarkerTouchGate'
import {
  logModernGuardrailApplied,
  logModernGuardrailTransition,
} from '../lib/modernLayerGuardrails'

logModernGuardrailApplied('RadialIntentMenu')

export type RadialMenuAction =
  | { kind: 'waypoint'; type: WaypointType; label?: string }
  | { kind: 'center_map' }
  | { kind: 'zoom_in' }
  | { kind: 'zoom_out' }
  | { kind: 'layers' }
  | { kind: 'weather' }
  | { kind: 'mission' }
  | { kind: 'checkin' }
  | { kind: 'sos' }
  | { kind: 'share_location' }
  | { kind: 'clear_route' }
  | { kind: 'clear_waypoints' }
  | { kind: 'navigate_here' }
  | { kind: 'dismiss' }

type RadialMenuProps = {
  position: RadialMenuPosition
  onAction: (action: RadialMenuAction) => void
  onDismiss: () => void
  visible: boolean
  /** Hybrid/Balanced: let panel chrome receive clicks through the dimmer */
  passThroughBackdrop?: boolean
}

// Ring configuration - Features are primary, waypoints secondary, tools tertiary
const RING_CONFIG = {
  // PRIMARY: Feature tools (closer, easier to reach)
  features: { radius: 100, itemSize: 64 },
  // SECONDARY: Waypoint types (further out, for occasional use)
  waypoints: { radius: 175, itemSize: 48 },
  // TERTIARY: System tools (farthest, utility actions)
  tools: { radius: 240, itemSize: 44 },
  // CENTER: Map controls
  center: { size: 80 },
}

// Feature tools - These are the PRIMARY actions in Modern mode
const FEATURE_ITEMS = [
  { 
    id: 'layers', 
    label: 'Layers', 
    icon: '🗺️', 
    color: '#007AFF',
    description: 'Map overlays & environmental data',
    category: 'info'
  },
  { 
    id: 'weather', 
    label: 'Weather', 
    icon: '☁️', 
    color: '#5AC8FA',
    description: 'Current conditions & alerts',
    category: 'info'
  },
  { 
    id: 'mission', 
    label: 'Mission', 
    icon: '👥', 
    color: '#34C759',
    description: 'Team coordination & sharing',
    category: 'action'
  },
  { 
    id: 'checkin', 
    label: 'Check In', 
    icon: '✓', 
    color: '#FF9500',
    description: 'Share status with team',
    category: 'action'
  },
  { 
    id: 'navigate', 
    label: 'Route', 
    icon: '🧭', 
    color: '#5856D6',
    description: 'Open route planner & navigation',
    category: 'action'
  },
  { 
    id: 'share', 
    label: 'Share', 
    icon: '↗️', 
    color: '#FF2D55',
    description: 'Share this location',
    category: 'action'
  },
] as const

// Waypoint types - SECONDARY actions
const WAYPOINT_ITEMS = [
  { type: 'pin' as WaypointType, label: 'Pin', icon: '📍', color: '#ef4444' },
  { type: 'water' as WaypointType, label: 'Water', icon: '💧', color: '#38bdf8' },
  { type: 'camp' as WaypointType, label: 'Camp', icon: '⛺', color: '#34d399' },
  { type: 'start' as WaypointType, label: 'Start', icon: '🚩', color: '#22c55e' },
  { type: 'rest' as WaypointType, label: 'Rest', icon: '☕', color: '#fbbf24' },
  { type: 'poi' as WaypointType, label: 'POI', icon: '🔍', color: '#a78bfa' },
  { type: 'finish' as WaypointType, label: 'Finish', icon: '🏁', color: '#f472b6' },
]

// System/Tools - TERTIARY actions (outer ring)
const TOOL_ITEMS = [
  { id: 'clear_waypoints', label: 'Clear All', icon: '🗑️', color: '#FF3B30', description: 'Remove all waypoints from map' },
  { id: 'clear_route', label: 'Clear Route', icon: '✕', color: '#FF9500', description: 'Clear active navigation route' },
] as const

export function RadialIntentMenu({ position, onAction, onDismiss, visible, passThroughBackdrop = false }: RadialMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const actionCommittedRef = useRef(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  const [pressStartTime, setPressStartTime] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const { mode } = useHudPresentation()
  const isModernMode = mode === 'immersive'
  
  // Context for preview content
  const { state: appState } = useAppContext()
  const mission = useMissionSync()

  // Calculate which item is under the pointer based on position
  const getItemAtPosition = useCallback((clientX: number, clientY: number): string | null => {
    const dx = clientX - position.x
    const dy = clientY - position.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    const angle = Math.atan2(dy, dx) // -PI to PI
    
    // Debug logging for tool ring detection
    const toolsRadius = RING_CONFIG.tools.radius
    const toolsSize = RING_CONFIG.tools.itemSize
    const toolsMin = toolsRadius - toolsSize/2
    const toolsMax = toolsRadius + toolsSize/2
    
    // Normalize angle to 0-2PI starting from top (-PI/2)
    let normalizedAngle = angle + Math.PI / 2
    if (normalizedAngle < 0) normalizedAngle += 2 * Math.PI
    
    // Check center area first (center map button)
    if (distance < RING_CONFIG.center.size / 2 + 10) {
      return 'center'
    }
    
    // Check zoom buttons (above and below center)
    // CRITICAL FIX: Hit detection Y positions must match rendered button CENTERS
    // Zoom in button is rendered at top: position.y - center.size/2 - 32 (32px tall, so center is at -16 from edge)
    const zoomInY = position.y - RING_CONFIG.center.size / 2 - 32 + 16 // Button center
    // Zoom out button is rendered at top: position.y + center.size/2 + 0 (32px tall, so center is at +16 from edge)
    const zoomOutY = position.y + RING_CONFIG.center.size / 2 + 0 + 16 // Button center
    if (Math.abs(clientX - position.x) < 20 && Math.abs(clientY - zoomInY) < 20) {
      return 'zoom_in'
    }
    if (Math.abs(clientX - position.x) < 20 && Math.abs(clientY - zoomOutY) < 20) {
      return 'zoom_out'
    }
    
    // Check feature ring (inner)
    const featureRadius = RING_CONFIG.features.radius
    const featureSize = RING_CONFIG.features.itemSize
    if (distance >= featureRadius - featureSize/2 && distance <= featureRadius + featureSize/2) {
      // Determine which feature item based on angle
      const featureAngleSize = (2 * Math.PI) / FEATURE_ITEMS.length
      const featureIndex = Math.floor((normalizedAngle + featureAngleSize / 2) / featureAngleSize) % FEATURE_ITEMS.length
      return FEATURE_ITEMS[featureIndex]?.id || null
    }
    
    // Check waypoint ring (middle)
    // CRITICAL FIX: Apply same angle offset as rendering to ensure hit detection matches visual position
    // Rendering uses: -Math.PI / 2 + Math.PI / FEATURE_ITEMS.length offset
    const waypointRadius = RING_CONFIG.waypoints.radius
    const waypointSize = RING_CONFIG.waypoints.itemSize
    if (distance >= waypointRadius - waypointSize/2 && distance <= waypointRadius + waypointSize/2) {
      const waypointAngleSize = (2 * Math.PI) / WAYPOINT_ITEMS.length
      // Apply the same offset used in rendering (stagger waypoints between features)
      const waypointAngleOffset = Math.PI / FEATURE_ITEMS.length
      const adjustedAngle = (normalizedAngle - waypointAngleOffset + 2 * Math.PI) % (2 * Math.PI)
      const waypointIndex = Math.floor((adjustedAngle + waypointAngleSize / 2) / waypointAngleSize) % WAYPOINT_ITEMS.length
      return `wp-${WAYPOINT_ITEMS[waypointIndex]?.type}` || null
    }
    
    // Check tools ring (outermost)
    if (distance >= toolsMin && distance <= toolsMax) {
      const toolsAngleSize = (2 * Math.PI) / TOOL_ITEMS.length
      const toolsIndex = Math.floor((normalizedAngle + toolsAngleSize / 2) / toolsAngleSize) % TOOL_ITEMS.length
      return `tool-${TOOL_ITEMS[toolsIndex]?.id}` || null
    }
    
    return null
  }, [position])

  // Handle click outside to dismiss
  useEffect(() => {
    if (!visible) return

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (containerRef.current && !containerRef.current.contains(target)) {
        handleDismiss()
      }
    }

    const timer = window.setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside)
    }, 100)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [visible])

  // Define handlers first (before effects that use them)
  const handleDismiss = useCallback(() => {
    setIsClosing(true)
    setTimeout(() => {
      setIsClosing(false)
      setSelectedId(null)
      setIsDragging(false)
      onDismiss()
    }, 200)
  }, [onDismiss])

  const handleAction = useCallback((action: RadialMenuAction) => {
    if (actionCommittedRef.current) return
    actionCommittedRef.current = true
    logModernGuardrailTransition('radial-action', { kind: action.kind })
    onAction(action)
    handleDismiss()
  }, [onAction, handleDismiss])

  // Handle escape key
  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismiss()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible, handleDismiss])

  // Global pointer tracking for drag-to-select pattern
  useEffect(() => {
    if (!visible) {
      setIsDragging(false)
      actionCommittedRef.current = false
      return
    }

    let currentSelection: string | null = null

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault()
      try {
        containerRef.current?.setPointerCapture(e.pointerId)
      } catch {
        // ignore — capture optional on some browsers
      }
    }

    const handlePointerMove = (e: PointerEvent) => {
      setIsDragging(true)
      currentSelection = getItemAtPosition(e.clientX, e.clientY)
      setSelectedId(currentSelection)
    }

    const handlePointerUp = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (actionCommittedRef.current) return
      markRadialMenuInteractionGrace()

      // Use the most recent selection from move handler
      const selection = currentSelection || getItemAtPosition(e.clientX, e.clientY)
      
      // If we have a selection, trigger it
      if (selection) {
        // Direct action dispatch based on selection
        if (selection === 'center') {
          handleAction({ kind: 'center_map' })
        } else if (selection === 'zoom_in') {
          handleAction({ kind: 'zoom_in' })
        } else if (selection === 'zoom_out') {
          handleAction({ kind: 'zoom_out' })
        } else if (selection === 'layers') {
          handleAction({ kind: 'layers' })
        } else if (selection === 'weather') {
          handleAction({ kind: 'weather' })
        } else if (selection === 'mission') {
          handleAction({ kind: 'mission' })
        } else if (selection === 'checkin') {
          handleAction({ kind: 'checkin' })
        } else if (selection === 'navigate') {
          handleAction({ kind: 'navigate_here' })
        } else if (selection === 'share') {
          handleAction({ kind: 'share_location' })
        } else if (selection.startsWith('wp-')) {
          const wpType = selection.replace('wp-', '') as WaypointType
          const wp = WAYPOINT_ITEMS.find(w => w.type === wpType)
          if (wp) {
            handleAction({ kind: 'waypoint', type: wpType, label: wp.label })
          }
        } else if (selection.startsWith('tool-')) {
          const toolId = selection.replace('tool-', '')
          if (toolId === 'clear_waypoints') {
            handleAction({ kind: 'clear_waypoints' })
          } else if (toolId === 'clear_route') {
            handleAction({ kind: 'clear_route' })
          }
        }
      } else {
        // Center-release guardrail: release near orb without ring hit → center map
        const dx = e.clientX - position.x
        const dy = e.clientY - position.y
        const releaseDistance = Math.sqrt(dx * dx + dy * dy)
        const centerRadius = RING_CONFIG.center.size / 2 + 14
        if (releaseDistance < centerRadius) {
          logModernGuardrailTransition('radial-release', {
            action: 'center_map',
            distance: Math.round(releaseDistance),
          })
          handleAction({ kind: 'center_map' })
        } else {
          logModernGuardrailTransition('radial-release', { action: 'dismiss' })
          actionCommittedRef.current = true
          handleDismiss()
        }
      }
    }

    // Attach immediately — long-press may release on the same frame the menu opens
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { capture: true })

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp, { capture: true })
    }
  }, [visible, getItemAtPosition, handleAction, handleDismiss, position.x, position.y])

  // Calculate positions around circle
  const calculatePositions = (count: number, radius: number, offsetAngle: number = -Math.PI / 2) => {
    return Array.from({ length: count }, (_, i) => {
      const angle = offsetAngle + (i / count) * 2 * Math.PI
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        angle,
      }
    })
  }

  const featurePositions = useMemo(() => 
    calculatePositions(FEATURE_ITEMS.length, RING_CONFIG.features.radius, -Math.PI / 2),
  [])

  const waypointPositions = useMemo(() => 
    calculatePositions(WAYPOINT_ITEMS.length, RING_CONFIG.waypoints.radius, -Math.PI / 2 + Math.PI / FEATURE_ITEMS.length),
  [])

  // Get preview content for selected item
  const getPreviewContent = (id: string): { title: string; content: string; meta?: string } | null => {
    switch (id) {
      case 'layers':
        return {
          title: 'Map Layers',
          content: 'Fire activity, terrain relief, forest cover, public lands, and weather overlays',
          meta: `${appState.activeLayer} base map`
        }
      case 'weather':
        return {
          title: 'Weather',
          content: 'Current conditions, hourly forecast, and active alerts for your location',
          meta: '72°F · Partly cloudy'
        }
      case 'mission':
        return {
          title: 'Mission',
          content: mission.role !== 'idle' 
            ? 'View team status, share waypoints, and coordinate with your group'
            : 'Start or join a mission to coordinate with your team',
          meta: mission.role !== 'idle' ? `${mission.peers.length + 1} members active` : 'No active mission'
        }
      case 'checkin':
        return {
          title: 'Check In',
          content: 'Share your status with the team - OK, delayed, or need help',
          meta: 'Last check-in: Never'
        }
      case 'navigate':
        return {
          title: 'Navigate Here',
          content: 'Start turn-by-turn navigation to this location',
          meta: 'Est. time will be calculated'
        }
      case 'share':
        return {
          title: 'Share Location',
          content: 'Send this location to anyone via message or link',
          meta: 'Creates shareable link'
        }
      default:
        if (id.startsWith('wp-')) {
          const wpType = id.replace('wp-', '')
          const wp = WAYPOINT_ITEMS.find(w => w.type === wpType)
          if (wp) {
            return {
              title: `Drop ${wp.label}`,
              content: `Add a ${wp.label.toLowerCase()} waypoint at this location`,
              meta: `${appState.waypoints.length} waypoints on map`
            }
          }
        }
        return null
    }
  }

  const selectedPreview = selectedId ? getPreviewContent(selectedId) : null

  if (!visible) return null

  const menuContent = (
    <div
      ref={containerRef}
      data-testid="radial-menu"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
        animation: isClosing ? 'radialExit 200ms ease forwards' : 'radialEnter 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
        pointerEvents: passThroughBackdrop ? 'none' : 'auto',
      }}
    >
      {/* Dimmer overlay - FIXED positioning, lower z-index so buttons are above it */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'radial-gradient(circle at center, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.5) 100%)',
          backdropFilter: 'blur(12px) saturate(0.8)',
          WebkitBackdropFilter: 'blur(12px) saturate(0.8)',
          pointerEvents: passThroughBackdrop ? 'none' : 'auto',
          zIndex: 15000,
        }}
        onPointerDown={passThroughBackdrop ? undefined : (e) => {
          e.preventDefault()
          e.stopPropagation()
          markRadialMenuInteractionGrace()
        }}
        onClick={passThroughBackdrop ? undefined : (e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      />

      {/* Center pulse - subtle ambient glow */}
      <div
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'rgba(0, 200, 255, 0.6)',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 0 2px rgba(0, 200, 255, 0.2), 0 0 20px rgba(0, 200, 255, 0.4)',
          pointerEvents: 'none',
          animation: 'centerPulse 3s ease-in-out infinite',
          zIndex: 19999,
        }}
      />

      {/* ═══════════════════════════════════════════════════════════════════════
          PREVIEW PANEL - Contextual info card (Modern glass aesthetic)
         ═══════════════════════════════════════════════════════════════════════ */}
      {selectedPreview && (
        <div
          style={{
            position: 'fixed',
            left: position.x - 130,
            top: position.y - RING_CONFIG.waypoints.radius - 110,
            width: 260,
            padding: '14px 18px',
            borderRadius: 14,
            background: 'radial-gradient(circle at 30% 20%, rgba(55, 55, 60, 0.98), rgba(32, 32, 36, 0.98))',
            backdropFilter: 'blur(24px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255,255,255,0.03)',
            pointerEvents: 'none',
            animation: 'previewEnter 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            zIndex: 19999,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.95)',
              letterSpacing: '-0.01em',
              marginBottom: 5,
            }}
          >
            {selectedPreview.title}
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'rgba(255, 255, 255, 0.6)',
              lineHeight: 1.4,
              marginBottom: selectedPreview.meta ? 6 : 0,
            }}
          >
            {selectedPreview.content}
          </div>
          {selectedPreview.meta && (
            <div
              style={{
                fontSize: 11,
                color: 'rgba(0, 200, 255, 0.85)',
                fontWeight: 500,
                letterSpacing: '0.01em',
              }}
            >
              {selectedPreview.meta}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PRIMARY RING: Feature Tools (closer to center)
         ═══════════════════════════════════════════════════════════════════════ */}
      {FEATURE_ITEMS.map((item, index) => {
        const pos = featurePositions[index]
        const isSelected = selectedId === item.id
        const buttonLeft = position.x + pos.x - RING_CONFIG.features.itemSize / 2
        const buttonTop = position.y + pos.y - RING_CONFIG.features.itemSize / 2
        
        return (
          <button
            key={item.id}
            type="button"
            data-item-id={item.id}
            data-testid={`radial-${item.id}`}
            style={{
              position: 'fixed',
              left: buttonLeft,
              top: buttonTop,
              width: RING_CONFIG.features.itemSize,
              height: RING_CONFIG.features.itemSize,
              borderRadius: '50%',
              border: `1px solid ${isSelected ? item.color : 'rgba(255, 255, 255, 0.08)'}`,
              background: isSelected 
                ? `radial-gradient(circle at 30% 30%, ${item.color}30, ${item.color}15)`
                : 'radial-gradient(circle at 30% 30%, rgba(60, 60, 65, 0.95), rgba(35, 35, 40, 0.98))',
              color: isSelected ? item.color : 'rgba(255, 255, 255, 0.95)',
              fontSize: 12,
              fontWeight: isSelected ? 600 : 500,
              letterSpacing: '-0.01em',
              cursor: 'pointer',
              pointerEvents: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              boxShadow: isSelected
                ? `0 0 30px ${item.color}50, 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.15)`
                : '0 4px 20px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
              transition: 'all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              backdropFilter: 'blur(24px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
              transform: isSelected ? 'scale(1.12)' : 'scale(1)',
              animation: isClosing 
                ? 'none' 
                : `orbItemEnter 400ms cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 40}ms backwards`,
              opacity: isClosing ? 0 : 1,
              zIndex: 20000,
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              outline: 'none',
            }}
          >
            {/* Soft glow behind icon when selected */}
            {isSelected && (
              <div style={{
                position: 'absolute',
                inset: '20%',
                borderRadius: '50%',
                background: `${item.color}20`,
                filter: 'blur(20px)',
                pointerEvents: 'none',
              }} />
            )}
            <span style={{ 
              fontSize: 26, 
              lineHeight: 1, 
              filter: isSelected ? `drop-shadow(0 0 8px ${item.color}80)` : 'none',
              transition: 'filter 200ms ease',
            }}>
              {item.icon}
            </span>
            <span style={{ fontSize: 11, fontWeight: 500 }}>{item.label}</span>
          </button>
        )
      })}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECONDARY RING: Waypoint Types (further out)
         ═══════════════════════════════════════════════════════════════════════ */}
      {WAYPOINT_ITEMS.map((item, index) => {
        const pos = waypointPositions[index]
        const id = `wp-${item.type}`
        const isSelected = selectedId === id
        const buttonLeft = position.x + pos.x - RING_CONFIG.waypoints.itemSize / 2
        const buttonTop = position.y + pos.y - RING_CONFIG.waypoints.itemSize / 2
        
        return (
          <button
            key={item.type}
            type="button"
            data-item-id={item.type}
            style={{
              position: 'fixed',
              left: buttonLeft,
              top: buttonTop,
              width: RING_CONFIG.waypoints.itemSize,
              height: RING_CONFIG.waypoints.itemSize,
              borderRadius: '50%',
              border: `1px solid ${isSelected ? item.color : 'rgba(255, 255, 255, 0.06)'}`,
              background: isSelected 
                ? `radial-gradient(circle at 30% 30%, ${item.color}25, ${item.color}10)`
                : 'radial-gradient(circle at 30% 30%, rgba(55, 55, 60, 0.9), rgba(32, 32, 36, 0.95))',
              color: isSelected ? item.color : 'rgba(255, 255, 255, 0.85)',
              fontSize: 10,
              fontWeight: isSelected ? 600 : 500,
              letterSpacing: '-0.01em',
              cursor: 'pointer',
              pointerEvents: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              boxShadow: isSelected
                ? `0 0 20px ${item.color}40, 0 6px 24px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.1)`
                : '0 3px 16px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.06)',
              transition: 'all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              backdropFilter: 'blur(20px) saturate(1.2)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
              transform: isSelected ? 'scale(1.1)' : 'scale(1)',
              animation: isClosing 
                ? 'none' 
                : `orbItemEnter 400ms cubic-bezier(0.34, 1.56, 0.64, 1) ${200 + index * 35}ms backwards`,
              opacity: isClosing ? 0 : 1,
              zIndex: 20000,
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              outline: 'none',
            }}
          >
            {isSelected && (
              <div style={{
                position: 'absolute',
                inset: '25%',
                borderRadius: '50%',
                background: `${item.color}18`,
                filter: 'blur(16px)',
                pointerEvents: 'none',
              }} />
            )}
            <span style={{ 
              fontSize: 18, 
              lineHeight: 1, 
              filter: isSelected ? `drop-shadow(0 0 6px ${item.color}60)` : 'none',
            }}>
              {item.icon}
            </span>
            <span style={{ fontSize: 10, fontWeight: 500 }}>{item.label}</span>
          </button>
        )
      })}

      {/* ═══════════════════════════════════════════════════════════════════════
          TERTIARY RING: System Tools (outermost - utility actions)
         ═══════════════════════════════════════════════════════════════════════ */}
      {TOOL_ITEMS.map((item, index) => {
        // Calculate positions for tools ring
        const toolsAngle = -Math.PI / 2 + (index / TOOL_ITEMS.length) * 2 * Math.PI
        const toolX = Math.cos(toolsAngle) * RING_CONFIG.tools.radius
        const toolY = Math.sin(toolsAngle) * RING_CONFIG.tools.radius
        const id = `tool-${item.id}`
        const isSelected = selectedId === id
        const buttonLeft = position.x + toolX - RING_CONFIG.tools.itemSize / 2
        const buttonTop = position.y + toolY - RING_CONFIG.tools.itemSize / 2
        
        return (
          <button
            key={item.id}
            type="button"
            data-item-id={item.id}
            data-testid={item.id === 'clear_route' ? 'clear-route' : 'clear-all'}
            style={{
              position: 'fixed',
              left: buttonLeft,
              top: buttonTop,
              width: RING_CONFIG.tools.itemSize,
              height: RING_CONFIG.tools.itemSize,
              borderRadius: '50%',
              border: `1px solid ${isSelected ? item.color : 'rgba(255, 255, 255, 0.05)'}`,
              background: isSelected 
                ? `radial-gradient(circle at 30% 30%, ${item.color}30, ${item.color}15)`
                : 'radial-gradient(circle at 30% 30%, rgba(50, 50, 55, 0.85), rgba(28, 28, 32, 0.9))',
              color: isSelected ? item.color : 'rgba(255, 255, 255, 0.75)',
              fontSize: 9,
              fontWeight: isSelected ? 600 : 500,
              letterSpacing: '-0.01em',
              cursor: 'pointer',
              pointerEvents: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              boxShadow: isSelected
                ? `0 0 15px ${item.color}40, 0 4px 12px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.08)`
                : '0 2px 10px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
              transition: 'all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              backdropFilter: 'blur(16px) saturate(1.1)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.1)',
              transform: isSelected ? 'scale(1.15)' : 'scale(1)',
              animation: isClosing 
                ? 'none' 
                : `orbItemEnter 400ms cubic-bezier(0.34, 1.56, 0.64, 1) ${400 + index * 50}ms backwards`,
              opacity: isClosing ? 0 : 1,
              zIndex: 20000,
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              outline: 'none',
            }}
          >
            {isSelected && (
              <div style={{
                position: 'absolute',
                inset: '25%',
                borderRadius: '50%',
                background: `${item.color}15`,
                filter: 'blur(12px)',
                pointerEvents: 'none',
              }} />
            )}
            <span style={{ 
              fontSize: 16, 
              lineHeight: 1, 
              filter: isSelected ? `drop-shadow(0 0 4px ${item.color}50)` : 'none',
            }}>
              {item.icon}
            </span>
            <span style={{ fontSize: 8, fontWeight: 500, letterSpacing: '0.02em' }}>{item.label}</span>
          </button>
        )
      })}

      {/* ═══════════════════════════════════════════════════════════════════════
          THE ORB: Center Command Node - Modern floating glass aesthetic
         ═══════════════════════════════════════════════════════════════════════ */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          handleAction({ kind: 'center_map' })
        }}
        style={{
          position: 'fixed',
          left: position.x - RING_CONFIG.center.size / 2,
          top: position.y - RING_CONFIG.center.size / 2,
          width: RING_CONFIG.center.size,
          height: RING_CONFIG.center.size,
          borderRadius: '50%',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          background: 'radial-gradient(circle at 35% 35%, rgba(70, 70, 75, 0.95), rgba(38, 38, 42, 0.98))',
          boxShadow: '0 0 40px rgba(0, 122, 255, 0.15), 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.12)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          animation: isClosing ? 'none' : 'orbEnter 500ms cubic-bezier(0.34, 1.56, 0.64, 1) 300ms backwards',
          opacity: isClosing ? 0 : 1,
          zIndex: 20000,
          cursor: 'pointer',
          pointerEvents: 'auto',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          transition: 'all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.08)'
          e.currentTarget.style.boxShadow = '0 0 50px rgba(0, 122, 255, 0.25), 0 12px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.15)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = '0 0 40px rgba(0, 122, 255, 0.15), 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.12)'
        }}
      >
        <span style={{ fontSize: 26, filter: 'drop-shadow(0 0 4px rgba(0,122,255,0.5))' }}>⌖</span>
        <span style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.8)' }}>Center</span>
      </button>

      {/* Zoom controls - floating satellites */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          handleAction({ kind: 'zoom_in' })
        }}
        style={{
          position: 'fixed',
          left: position.x - 16,
          top: position.y - RING_CONFIG.center.size / 2 - 32,
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'radial-gradient(circle at 35% 35%, rgba(65, 65, 70, 0.95), rgba(35, 35, 38, 0.98))',
          color: 'rgba(255, 255, 255, 0.95)',
          fontSize: 20,
          fontWeight: 300,
          cursor: 'pointer',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
          transition: 'all 180ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          animation: isClosing ? 'none' : 'orbItemEnter 400ms cubic-bezier(0.34, 1.56, 0.64, 1) 500ms backwards',
          opacity: isClosing ? 0 : 1,
          zIndex: 20000,
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.15)'
          e.currentTarget.style.background = 'radial-gradient(circle at 35% 35%, rgba(80, 80, 85, 0.95), rgba(45, 45, 48, 0.98))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.background = 'radial-gradient(circle at 35% 35%, rgba(65, 65, 70, 0.95), rgba(35, 35, 38, 0.98))'
        }}
      >
        +
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          handleAction({ kind: 'zoom_out' })
        }}
        style={{
          position: 'fixed',
          left: position.x - 16,
          top: position.y + RING_CONFIG.center.size / 2 + 0,
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'radial-gradient(circle at 35% 35%, rgba(65, 65, 70, 0.95), rgba(35, 35, 38, 0.98))',
          color: 'rgba(255, 255, 255, 0.95)',
          fontSize: 20,
          fontWeight: 300,
          cursor: 'pointer',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
          transition: 'all 180ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          zIndex: 20000,
          touchAction: 'manipulation',
          animation: isClosing ? 'none' : 'orbItemEnter 400ms cubic-bezier(0.34, 1.56, 0.64, 1) 550ms backwards',
          opacity: isClosing ? 0 : 1,
          WebkitTapHighlightColor: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.15)'
          e.currentTarget.style.background = 'radial-gradient(circle at 35% 35%, rgba(80, 80, 85, 0.95), rgba(45, 45, 48, 0.98))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.background = 'radial-gradient(circle at 35% 35%, rgba(65, 65, 70, 0.95), rgba(35, 35, 38, 0.98))'
        }}
      >
        −
      </button>

      {/* ═══════════════════════════════════════════════════════════════════════
          HELP TEXT
         ═══════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'fixed',
          left: position.x - 100, // Center approximately (200px wide)
          top: position.y + RING_CONFIG.waypoints.radius + 80,
          width: 200,
          textAlign: 'center',
          pointerEvents: 'none',
          animation: isClosing ? 'none' : 'fadeIn 400ms ease 600ms backwards',
          opacity: isClosing ? 0 : 1,
          zIndex: 19999,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.8)',
            marginBottom: 4,
          }}
        >
          Tap to select · Tap outside to dismiss
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'rgba(255, 255, 255, 0.5)',
          }}
        >
          Tools closer to center · Waypoints on outer ring
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          ANIMATIONS
         ═══════════════════════════════════════════════════════════════════════ */}
      <style>{`
        @keyframes radialEnter {
          from { 
            opacity: 0;
            backdrop-filter: blur(0px);
          }
          to { 
            opacity: 1;
            backdrop-filter: blur(12px);
          }
        }
        
        @keyframes radialExit {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        
        @keyframes orbItemEnter {
          from {
            opacity: 0;
            transform: scale(0.5) translateY(30px);
            filter: blur(4px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
            filter: blur(0px);
          }
        }
        
        @keyframes orbEnter {
          from {
            opacity: 0;
            transform: scale(0.6);
            box-shadow: 0 0 0 rgba(0, 122, 255, 0);
          }
          to {
            opacity: 1;
            transform: scale(1);
            box-shadow: 0 0 40px rgba(0, 122, 255, 0.15), 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.12);
          }
        }
        
        @keyframes previewEnter {
          from {
            opacity: 0;
            transform: translateY(15px) scale(0.96);
            filter: blur(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0px);
          }
        }
        
        @keyframes centerPulse {
          0%, 100% { 
            box-shadow: 0 0 0 3px rgba(0, 200, 255, 0.25), 0 0 25px rgba(0, 200, 255, 0.4);
            transform: translate(-50%, -50%) scale(1);
          }
          50% { 
            box-shadow: 0 0 0 5px rgba(0, 200, 255, 0.15), 0 0 35px rgba(0, 200, 255, 0.5);
            transform: translate(-50%, -50%) scale(1.05);
          }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )

  return (
    <ModePortal portalId="radial-intent-menu">
      {menuContent}
    </ModePortal>
  )
}
