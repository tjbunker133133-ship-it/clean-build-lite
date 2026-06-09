/**
 * Long-press gesture detection for map intent system.
 * 
 * ROBUST IMPLEMENTATION:
 * - Uses window-level pointer events for maximum reliability
 * - Works around MapLibre's event interception
 * - Multiple detection strategies (timer + distance)
 * - Extensive debugging in DEV mode
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  LONG_PRESS_DURATION_MS,
  LONG_PRESS_MOVE_THRESHOLD_PX,
  type LongPressState,
  type RadialMenuPosition,
} from './types'
import { shouldBlockLongPress } from '../mapInteractionController'
import { setRadialMenuActive } from '../waypointMarkerTouchGate'

export type LongPressHandler = (position: RadialMenuPosition) => void

export type LongPressController = {
  destroy: () => void
  cancel: () => void
  isActive: () => boolean
  unlockMapInteraction: () => void
}

export type LongPressOptions = {
  durationMs?: number
  moveThresholdPx?: number
}

/**
 * Install long-press detection that works reliably with MapLibre.
 * 
 * STRATEGY:
 * 1. Use window-level pointer events (not just container)
 * 2. Track all pointers globally to avoid MapLibre interference
 * 3. Visual feedback during press (optional)
 * 4. Clear distinction between click and long-press
 */
export function installLongPressHandler(
  map: MapLibreMap,
  onLongPress: LongPressHandler,
  options?: LongPressOptions,
): LongPressController {
  const pressDurationMs = options?.durationMs ?? LONG_PRESS_DURATION_MS
  const moveThresholdPx = options?.moveThresholdPx ?? LONG_PRESS_MOVE_THRESHOLD_PX
  const container = map.getContainer()
  if (!container) {
    console.warn('[LongPress] No map container available')
    return {
      destroy: () => {},
      cancel: () => {},
      isActive: () => false,
      unlockMapInteraction: () => {},
    }
  }

  let state: LongPressState = { kind: 'idle' }
  let timerId: number | null = null
  let activePointerId: number | null = null
  let pressStartCoords: { x: number; y: number; lng: number; lat: number } | null = null

  // Debug logging helper
  const log = (...args: unknown[]) => {
    if (typeof window !== 'undefined' && (window as unknown as { __HUD_DEBUG_LP?: boolean }).__HUD_DEBUG_LP) {
      console.log('[LongPress]', ...args)
    }
  }

  const clearTimer = () => {
    if (timerId !== null) {
      window.clearTimeout(timerId)
      timerId = null
    }
  }

  const resetState = () => {
    state = { kind: 'idle' }
    activePointerId = null
    pressStartCoords = null
  }

  const unlockMapPan = () => {
    try { map.dragPan.enable() } catch { /* ignore */ }
    try { map.scrollZoom.enable() } catch { /* ignore */ }
    try { map.boxZoom.enable() } catch { /* ignore */ }
    try { map.dragRotate.enable() } catch { /* ignore */ }
    try { map.doubleClickZoom.enable() } catch { /* ignore */ }
    try { (map as any).touchZoomRotate?.enable() } catch { /* ignore */ }
  }

  const lockMapPan = () => {
    try { map.dragPan.disable() } catch { /* ignore */ }
    try { map.scrollZoom.disable() } catch { /* ignore */ }
    try { map.boxZoom.disable() } catch { /* ignore */ }
    try { map.dragRotate.disable() } catch { /* ignore */ }
    try { map.doubleClickZoom.disable() } catch { /* ignore */ }
    try { (map as any).touchZoomRotate?.disable() } catch { /* ignore */ }
  }

  /** Full lock including radial gate (blocks waypoint placement in MapCanvas). */
  const lockMapGestures = () => {
    setRadialMenuActive(true)
    lockMapPan()
  }

  const unlockMapGestures = () => {
    setRadialMenuActive(false)
    unlockMapPan()
  }

  const cancelLongPress = (reason: string) => {
    if (state.kind === 'idle' || state.kind === 'triggered') return
    log('Cancelled:', reason)
    clearTimer()
    resetState()
    unlockMapGestures()
  }

  /**
   * Check if a point is within the map container
   */
  const isWithinContainer = (clientX: number, clientY: number): boolean => {
    const rect = container.getBoundingClientRect()
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    )
  }

  /**
   * Convert screen coordinates to map coordinates
   */
  const getMapCoordinates = (clientX: number, clientY: number): { x: number; y: number; lng: number; lat: number } | null => {
    try {
      const rect = container.getBoundingClientRect()
      const mapX = clientX - rect.left
      const mapY = clientY - rect.top
      const lngLat = map.unproject([mapX, mapY])
      return { x: mapX, y: mapY, lng: lngLat.lng, lat: lngLat.lat }
    } catch (err) {
      console.warn('[LongPress] Failed to get map coordinates:', err)
      return null
    }
  }

  const scheduleLongPressTrigger = () => {
    clearTimer()
    timerId = window.setTimeout(() => {
      if (state.kind !== 'pressing') return
      if (!pressStartCoords) return

      const screenX = state.startX
      const screenY = state.startY

      state = {
        kind: 'triggered',
        lng: pressStartCoords.lng,
        lat: pressStartCoords.lat,
        screenX: pressStartCoords.x,
        screenY: pressStartCoords.y,
      }

      log('✓ TRIGGERED at:', pressStartCoords.lng, pressStartCoords.lat)
      lockMapGestures()

      onLongPress({
        x: screenX,
        y: screenY,
        lng: pressStartCoords.lng,
        lat: pressStartCoords.lat,
      })
    }, pressDurationMs)
  }

  const beginPointerPress = (pointerId: number, clientX: number, clientY: number): boolean => {
    if (shouldBlockLongPress()) return false
    if (activePointerId !== null) return false
    if (!isWithinContainer(clientX, clientY)) return false

    const coords = getMapCoordinates(clientX, clientY)
    if (!coords) return false

    activePointerId = pointerId
    pressStartCoords = coords
    state = {
      kind: 'pressing',
      startX: clientX,
      startY: clientY,
      startTime: performance.now(),
    }

    log('Started at:', clientX, clientY)
    // Do NOT lock pan here — MapLibre needs dragPan enabled at pointerdown for normal pan.
    scheduleLongPressTrigger()
    return true
  }

  /**
   * Capture-phase pointerdown — runs before MapLibre dragPan.
   */
  const handleContainerPointerDownCapture = (e: PointerEvent) => {
    if (e.button !== 0) return
    beginPointerPress(e.pointerId, e.clientX, e.clientY)
  }

  /**
   * Handle pointer move anywhere on window
   */
  const handlePointerMove = (e: PointerEvent) => {
    // Only track our active pointer
    if (e.pointerId !== activePointerId) return
    if (state.kind !== 'pressing') return

    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    const distance = Math.hypot(dx, dy)

    // Cancel if moved too much
    if (distance > moveThresholdPx) {
      cancelLongPress(`moved ${distance.toFixed(0)}px`)
    }
  }

  /**
   * Handle pointer up anywhere on window
   */
  const handlePointerUp = (e: PointerEvent) => {
    // Only handle our active pointer
    if (e.pointerId !== activePointerId) return

    log('Pointer up, kind:', state.kind)

    if (state.kind === 'triggered') {
      // Radial is open — release pointer tracking; keep lock until menu dismiss
      activePointerId = null
      clearTimer()
      return
    }

    // Quick tap or cancelled hold — restore normal map interaction
    cancelLongPress('pointer up')
  }

  /**
   * Handle pointer cancel
   */
  const handlePointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return
    if (state.kind === 'triggered') return
    cancelLongPress('pointer cancelled')
  }

  /**
   * Handle context menu (prevent on long-press)
   */
  const handleContextMenu = (e: MouseEvent) => {
    // Check if this is within our container and we're pressing/triggered
    if (!isWithinContainer(e.clientX, e.clientY)) return
    if (state.kind === 'idle') return

    e.preventDefault()
    e.stopPropagation()
    log('Context menu prevented')
  }

  /**
   * Handle touch start (for iOS Safari which sometimes doesn't fire pointerdown)
   */
  const handleContainerTouchStartCapture = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      cancelLongPress('multi-touch')
      return
    }
    const touch = e.touches[0]
    beginPointerPress(touch.identifier as unknown as number, touch.clientX, touch.clientY)
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (activePointerId === null) return
    if (state.kind !== 'pressing') return

    // Find our tracked touch
    const touch = Array.from(e.touches).find(t => t.identifier === activePointerId)
    if (!touch) return

    const dx = touch.clientX - state.startX
    const dy = touch.clientY - state.startY
    const distance = Math.hypot(dx, dy)

    if (distance > moveThresholdPx) {
      cancelLongPress(`touch moved ${distance.toFixed(0)}px`)
    }
  }

  const handleTouchEnd = (e: TouchEvent) => {
    // Check if our tracked touch ended
    const touchEnded = Array.from(e.changedTouches).some(t => t.identifier === activePointerId)
    if (!touchEnded) return

    if (state.kind === 'triggered') {
      activePointerId = null
      clearTimer()
      return
    }

    cancelLongPress('touch ended')
  }

  container.addEventListener('pointerdown', handleContainerPointerDownCapture, { capture: true, passive: true })
  container.addEventListener('touchstart', handleContainerTouchStartCapture, { capture: true, passive: true })

  // Window-level move/up for tracking outside container bounds
  window.addEventListener('pointermove', handlePointerMove, { passive: true })
  window.addEventListener('pointerup', handlePointerUp, { passive: true })
  window.addEventListener('pointercancel', handlePointerCancel, { passive: true })
  
  window.addEventListener('touchmove', handleTouchMove, { passive: true })
  window.addEventListener('touchend', handleTouchEnd, { passive: true })
  window.addEventListener('touchcancel', handleTouchEnd, { passive: true })
  
  // Context menu prevention on container
  container.addEventListener('contextmenu', handleContextMenu, { capture: true })

  // Prevent default touch behaviors that might interfere
  container.style.touchAction = 'pan-x pan-y pinch-zoom'

  // Expose debug toggle
  if (typeof window !== 'undefined') {
    (window as unknown as { __HUD_DEBUG_LP?: boolean }).__HUD_DEBUG_LP = true
  }

  log('Handler installed - try long-pressing the map!')
  console.log('[LongPress] Handler installed. Long-press duration:', pressDurationMs, 'ms')
  console.log('[LongPress] To debug, check window.__HUD_DEBUG_LP')

  /** Unlock map interaction when radial menu is dismissed */
  const unlockMapInteraction = () => {
    unlockMapGestures()
    if (state.kind === 'triggered') {
      resetState()
    }
  }

  return {
    destroy: () => {
      clearTimer()
      
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchEnd)
      
      container.removeEventListener('pointerdown', handleContainerPointerDownCapture, { capture: true })
      container.removeEventListener('touchstart', handleContainerTouchStartCapture, { capture: true })
      container.removeEventListener('contextmenu', handleContextMenu, { capture: true })
      
      resetState()
      unlockMapInteraction()
      
      log('Handler destroyed')
    },
    cancel: () => {
      clearTimer()
      resetState()
      unlockMapGestures()
    },
    isActive: () => {
      return state.kind === 'pressing' || state.kind === 'triggered'
    },
    unlockMapInteraction,
  }
}

// Enable debugging by default in DEV
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __HUD_DEBUG_LP?: boolean }).__HUD_DEBUG_LP = true
  console.log('[LongPress] Debug mode enabled. Set window.__HUD_DEBUG_LP = false to disable.')
}
