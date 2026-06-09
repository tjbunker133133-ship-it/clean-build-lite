/**
 * Modern Safety Zone - Unified SOS + DeadMan for Modern Mode
 * 
 * USER-FRIENDLY FLOATING SAFETY CONTROLS
 * 
 * Design Principles:
 * - SOS is FLOATING and DRAGGABLE - user can position where they want
 * - Drag vs Click detection - moving the button won't trigger SOS
 * - Position persists across sessions (user preference)
 * - DeadMan stays grounded (it's a status indicator, not interactive)
 * - Clean, calm, modern aesthetic
 * 
 * SOS Button:
 * - Floating, user-positionable
 * - Drag to reposition, tap to activate
 * - Default position: bottom-right (thumb reachable)
 * - Respects safe areas
 * - Visual feedback: different appearance when dragging
 * 
 * DeadMan:
 * - Bottom-left grounded pill (status only)
 * - Expands to amber warning when approaching limit
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useMissionSync } from '../context/MissionSyncContext'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { layerZ } from '../lib/presentationIsolation/zIndexLayers'
import { dispatchModernRescue } from '../lib/modernRescueBridge'
import { emitHaptic } from '../runtime/haptics'
import { cockpitSafeAreaInsets, cockpitViewport } from '../lib/viewport'
import { MODERN_MOBILE_LAYOUT } from './modernMode/modernMobileLayout'
import {
  magnetizeSosPosition,
  sosAnchorFromRect,
  sosPositionFromPointer,
  type SosScreenPosition,
  type SosViewport,
} from './modernSafetyZoneDrag'

function sosViewportFromCockpit(): SosViewport {
  const { vw, vh } = cockpitViewport()
  return { width: vw, height: vh }
}

interface ModernSafetyZoneProps {
  /** DeadMan timer state from parent */
  deadmanSeconds?: number
  deadmanMaxSeconds?: number
  deadmanState?: 'idle' | 'armed' | 'warning' | 'critical'
  onDeadmanPing?: () => void
  /** Fired when SOS countdown completes — parent may set emergency flags */
  onSosActivated?: () => void
}

// Storage key for SOS position preference
const SOS_POSITION_KEY = 'hud_sos_position_v1'

/** null = CSS default anchor (bottom-right); non-null = user-positioned center in px */
type SavedSosPosition = SosScreenPosition | null

// Drag detection threshold (pixels)
const DRAG_THRESHOLD = 10

// Load saved position from localStorage
function loadSavedPosition(): SavedSosPosition {
  try {
    const saved = localStorage.getItem(SOS_POSITION_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as { x?: unknown; y?: unknown }
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        const viewport = sosViewportFromCockpit()
        const insets = cockpitSafeAreaInsets()
        return magnetizeSosPosition({ x: parsed.x, y: parsed.y }, viewport, insets)
      }
    }
  } catch {
    // Ignore storage errors
  }
  return null
}

function savePosition(position: SosScreenPosition) {
  try {
    localStorage.setItem(SOS_POSITION_KEY, JSON.stringify(position))
  } catch {
    // Ignore storage errors
  }
}

export function ModernSafetyZone({
  deadmanSeconds = 0,
  deadmanMaxSeconds = 300,
  deadmanState = 'idle',
  onDeadmanPing,
  onSosActivated,
}: ModernSafetyZoneProps) {
  const [sosArming, setSosArming] = useState(false)
  const [sosCountdown, setSosCountdown] = useState(3)
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null)
  const { operationalReady } = useTacticalProfile()

  // Draggable SOS state
  const [sosPosition, setSosPosition] = useState<SavedSosPosition>(loadSavedPosition())
  const [isDragging, setIsDragging] = useState(false)
  const [hasDragged, setHasDragged] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const dragOffsetRef = useRef<SosScreenPosition>({ x: 0, y: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Get mission state for contextual display
  const mission = useMissionSync()
  const inMission = mission.role !== 'idle'

  useEffect(() => {
    if (sosPosition == null) return
    const viewport = sosViewportFromCockpit()
    const insets = cockpitSafeAreaInsets()
    const snapped = magnetizeSosPosition(sosPosition, viewport, insets)
    if (snapped.x !== sosPosition.x || snapped.y !== sosPosition.y) {
      setSosPosition(snapped)
      savePosition(snapped)
    }
  }, [])

  // SOS activation with countdown
  const handleSosPress = useCallback(() => {
    if (sosArming) {
      setSosArming(false)
      setSosCountdown(3)
      window.dispatchEvent(new CustomEvent('hud:sos-disarm'))
      emitHaptic('commandSuccess')
      return
    }

    setSosArming(true)
    setSosCountdown(3)
    emitHaptic('criticalAlert')
  }, [sosArming])

  // Countdown effect
  useEffect(() => {
    if (!sosArming) return

    if (sosCountdown <= 0) {
      setSosArming(false)
      setSosCountdown(3)
      onSosActivated?.()
      window.dispatchEvent(new CustomEvent('hud:sos-arm'))
      void dispatchModernRescue('SOS', { profileOperational: operationalReady }).then((result) => {
        setDispatchStatus(result.ok ? `SOS sent — ${result.message}` : result.message)
        if (import.meta.env.DEV) {
          console.log('[ModernSafetyZone] SOS dispatch', result)
        }
      })
      return
    }

    const timer = setTimeout(() => {
      setSosCountdown(c => c - 1)
    }, 1000)

    return () => clearTimeout(timer)
  }, [sosArming, sosCountdown, onSosActivated, operationalReady])

  // DeadMan progress calculation
  const deadmanProgress = deadmanMaxSeconds > 0
    ? (deadmanSeconds / deadmanMaxSeconds) * 100
    : 0

  // DeadMan color based on state
  const getDeadmanColor = () => {
    switch (deadmanState) {
      case 'critical': return '#FF3B30'
      case 'warning': return '#FF9500'
      case 'armed': return '#34C759'
      default: return 'rgba(255, 255, 255, 0.3)'
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG HANDLERS - Pointer events for unified mouse/touch
  // ═══════════════════════════════════════════════════════════════════════════

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    buttonRef.current?.setPointerCapture(e.pointerId)

    const rect = buttonRef.current?.getBoundingClientRect()
    const anchor = rect ? sosAnchorFromRect(rect) : { x: e.clientX, y: e.clientY }
    dragOffsetRef.current = { x: e.clientX - anchor.x, y: e.clientY - anchor.y }
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    setIsDragging(false)
    setHasDragged(false)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return

    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    const distance = Math.hypot(dx, dy)

    if (distance > DRAG_THRESHOLD && !hasDragged) {
      setIsDragging(true)
      setHasDragged(true)
    }

    if (isDragging || distance > DRAG_THRESHOLD) {
      const viewport = sosViewportFromCockpit()
      const insets = cockpitSafeAreaInsets()
      const next = sosPositionFromPointer(
        e.clientX,
        e.clientY,
        dragOffsetRef.current,
        viewport,
        insets,
      )
      setSosPosition(next)
    }
  }, [isDragging, hasDragged])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    buttonRef.current?.releasePointerCapture(e.pointerId)
    
    const wasDragging = hasDragged
    
    // Reset drag state
    dragStartRef.current = null
    setIsDragging(false)
    setHasDragged(false)

    // Save position if we dragged
    if (wasDragging && sosPosition) {
      const viewport = sosViewportFromCockpit()
      const insets = cockpitSafeAreaInsets()
      const snapped = magnetizeSosPosition(sosPosition, viewport, insets)
      setSosPosition(snapped)
      savePosition(snapped)
    } else {
      // It was a click/tap - trigger SOS
      handleSosPress()
    }
  }, [hasDragged, sosPosition, handleSosPress])

  // ═══════════════════════════════════════════════════════════════════════════
  // SOS ACTIVATION OVERLAY (Full-screen countdown)
  // ═══════════════════════════════════════════════════════════════════════════
  if (sosArming) {
    return (
      <div
        className="sos-escalation-overlay"
        role="alertdialog"
        aria-modal="true"
        aria-label="Emergency SOS countdown"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.88)',
          backdropFilter: 'blur(24px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.2)',
          zIndex: layerZ('CRITICAL_ALERT'),
          pointerEvents: 'auto',
          touchAction: 'manipulation',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
          padding: '24px',
        }}
      >
        {/* Countdown circle */}
        <div
          style={{
            width: 180,
            height: 180,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #FF3B30 0%, #FF6B6B 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 72,
            fontWeight: 700,
            color: 'white',
            fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
            animation: 'sosPulse 1s ease-in-out infinite',
            boxShadow: '0 0 60px rgba(255, 59, 48, 0.5)',
          }}
        >
          {sosCountdown}
        </div>

        {/* SOS Text */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: '#FF3B30',
              fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
              letterSpacing: '-0.02em',
              marginBottom: 8,
            }}
          >
            EMERGENCY SOS
          </div>
          <div
            style={{
              fontSize: 15,
              color: 'rgba(255, 255, 255, 0.7)',
              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
            }}
          >
            Hold button to cancel
          </div>
        </div>

        {/* Cancel button */}
        <button
          onClick={handleSosPress}
          style={{
            padding: '16px 40px',
            borderRadius: 14,
            border: '2px solid rgba(255, 255, 255, 0.3)',
            background: 'transparent',
            color: 'white',
            fontSize: 17,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
            letterSpacing: '-0.01em',
            transition: 'all 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
          }}
        >
          Cancel SOS
        </button>

        {dispatchStatus && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', maxWidth: 280, textAlign: 'center' }}>
            {dispatchStatus}
          </div>
        )}

        <style>{`
          @keyframes sosPulse {
            0%, 100% { transform: scale(1); box-shadow: 0 0 60px rgba(255, 59, 48, 0.5); }
            50% { transform: scale(1.05); box-shadow: 0 0 80px rgba(255, 59, 48, 0.7); }
          }
        `}</style>
      </div>
    )
  }

  // Calculate SOS button style based on position
  const sosUsesDefaultAnchor = sosPosition == null
  const sosButtonStyle: React.CSSProperties = sosUsesDefaultAnchor
    ? {
        position: 'fixed',
        right: MODERN_MOBILE_LAYOUT.sosDefaultRight,
        bottom: MODERN_MOBILE_LAYOUT.sosDefaultBottom,
      }
    : {
        position: 'fixed',
        left: sosPosition.x,
        top: sosPosition.y,
        transform: 'translate(-50%, -50%)',
      }

  // ═══════════════════════════════════════════════════════════════════════════
  // NORMAL STATE: Floating SOS + Grounded DeadMan
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════════
          LEFT: DeadMan Status Pill (Grounded)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div
        className="modern-safety-zone"
        data-modern-safety-zone="true"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          padding: `12px 16px ${MODERN_MOBILE_LAYOUT.deadManBottom}`,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          zIndex: 1000,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 20,
            minHeight: MODERN_MOBILE_LAYOUT.touchMin,
            cursor: deadmanState !== 'idle' ? 'pointer' : 'default',
            background: deadmanState === 'critical' 
              ? 'rgba(255, 59, 48, 0.2)' 
              : deadmanState === 'warning'
                ? 'rgba(255, 149, 0, 0.2)'
                : 'rgba(28, 28, 30, 0.85)',
            backdropFilter: 'blur(20px) saturate(1.2)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
            border: `1px solid ${deadmanState === 'critical' 
              ? 'rgba(255, 59, 48, 0.5)' 
              : deadmanState === 'warning'
                ? 'rgba(255, 149, 0, 0.4)'
                : 'rgba(255, 255, 255, 0.1)'}`,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            transition: 'all 300ms ease',
          }}
          onClick={deadmanState !== 'idle' ? onDeadmanPing : undefined}
          role={deadmanState !== 'idle' ? 'button' : undefined}
          aria-label={deadmanState !== 'idle' ? 'Reset dead man timer' : 'Dead man watch status'}
        >
          {/* DeadMan icon/status dot */}
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: getDeadmanColor(),
              transition: 'background 0.3s ease',
              animation: deadmanState === 'critical' 
                ? 'deadmanPulse 0.5s ease-in-out infinite'
                : deadmanState === 'warning'
                  ? 'deadmanPulse 1s ease-in-out infinite'
                  : 'none',
            }}
          />

          {/* Progress bar */}
          <div
            style={{
              width: deadmanState === 'critical' ? 80 : 60,
              height: 4,
              borderRadius: 2,
              background: 'rgba(255, 255, 255, 0.15)',
              overflow: 'hidden',
              transition: 'width 300ms ease',
            }}
          >
            <div
              style={{
                width: `${100 - deadmanProgress}%`,
                height: '100%',
                background: getDeadmanColor(),
                transition: 'width 1s linear, background 0.3s ease',
              }}
            />
          </div>

          {/* Status text */}
          <span
            style={{
              fontSize: 12,
              fontWeight: deadmanState === 'critical' ? 700 : 500,
              color: deadmanState === 'critical' 
                ? '#FF3B30'
                : deadmanState === 'warning'
                  ? '#FF9500'
                  : deadmanState === 'armed'
                    ? '#34C759'
                    : 'rgba(255, 255, 255, 0.6)',
              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
              letterSpacing: '-0.01em',
              minWidth: 50,
              transition: 'all 0.3s ease',
            }}
          >
            {deadmanState === 'idle' && 'Watch'}
            {deadmanState === 'armed' && 'Armed'}
            {deadmanState === 'warning' && 'Check'}
            {deadmanState === 'critical' && 'Alert!'}
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          CENTER: Mission status (if active)
         ═══════════════════════════════════════════════════════════════════════ */}
      {inMission && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: MODERN_MOBILE_LAYOUT.sosDefaultBottom,
            transform: 'translateX(-50%)',
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 16,
            background: 'rgba(0, 122, 255, 0.15)',
            border: '1px solid rgba(0, 122, 255, 0.3)',
            backdropFilter: 'blur(10px)',
            zIndex: 1000,
          }}
        >
          <span style={{ fontSize: 11, color: 'rgba(0, 122, 255, 0.9)', fontWeight: 500 }}>
            ● {mission.peers.length > 0 ? `${mission.peers.length + 1} team` : 'Solo'}
          </span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          FLOATING: SOS Button (Draggable)
         ═══════════════════════════════════════════════════════════════════════ */}
      <button
        ref={buttonRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          ...sosButtonStyle,
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: 64,
          height: 64,
          borderRadius: '50%',
          border: `2px solid ${isDragging 
            ? 'rgba(0, 122, 255, 0.8)' 
            : 'rgba(255, 59, 48, 0.5)'}`,
          background: isDragging
            ? 'rgba(0, 122, 255, 0.95)'
            : 'rgba(28, 28, 30, 0.9)',
          backdropFilter: 'blur(20px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
          boxShadow: isDragging
            ? '0 8px 32px rgba(0, 122, 255, 0.4)'
            : '0 4px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 59, 48, 0.1)',
          cursor: isDragging ? 'grabbing' : 'grab',
          transition: isDragging 
            ? 'none' 
            : 'all 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          zIndex: layerZ('CRITICAL_ALERT'),
          touchAction: 'none', // Prevent scroll while dragging
          userSelect: 'none',
          scale: isDragging ? '1.1' : '1',
        }}
        onMouseEnter={(e) => {
          if (!isDragging) {
            e.currentTarget.style.transform = sosUsesDefaultAnchor
              ? 'scale(1.08)'
              : 'translate(-50%, -50%) scale(1.08)'
            e.currentTarget.style.borderColor = 'rgba(255, 59, 48, 0.8)'
            e.currentTarget.style.boxShadow = '0 6px 24px rgba(255, 59, 48, 0.25), 0 0 0 1px rgba(255, 59, 48, 0.2)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isDragging) {
            e.currentTarget.style.transform = sosUsesDefaultAnchor
              ? 'scale(1)'
              : 'translate(-50%, -50%) scale(1)'
            e.currentTarget.style.borderColor = 'rgba(255, 59, 48, 0.5)'
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 59, 48, 0.1)'
          }
        }}
        aria-label="Drag to move, tap to activate Emergency SOS"
        title="Drag to move, tap for SOS"
      >
        {/* SOS Icon - changes when dragging */}
        <span
          style={{
            fontSize: 26,
            lineHeight: 1,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
            transition: 'all 150ms ease',
            opacity: isDragging ? 0.7 : 1,
          }}
        >
          {isDragging ? '✋' : '🆘'}
        </span>

        {/* SOS Label */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: isDragging ? 'white' : '#FF3B30',
            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
            letterSpacing: '-0.02em',
            marginTop: 2,
            transition: 'color 150ms ease',
          }}
        >
          {isDragging ? 'Move' : 'SOS'}
        </span>
      </button>

      {/* Hint for first-time users - shows briefly when position is default */}
      {sosUsesDefaultAnchor && (
        <div
          style={{
            position: 'fixed',
            right: `max(80px, calc(16px + env(safe-area-inset-right) + 64px))`,
            bottom: `calc(36px + max(16px, env(safe-area-inset-bottom)))`,
            zIndex: 999,
            padding: '6px 12px',
            borderRadius: 8,
            background: 'rgba(28, 28, 30, 0.8)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            fontSize: 12,
            color: 'rgba(255, 255, 255, 0.7)',
            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
            animation: 'hintFade 4s ease forwards',
            pointerEvents: 'none',
          }}
        >
          Drag to move
          <style>{`
            @keyframes hintFade {
              0%, 80% { opacity: 1; }
              100% { opacity: 0; }
            }
          `}</style>
        </div>
      )}

      <style>{`
        @keyframes deadmanPulse {
          0%, 100% { 
            transform: scale(1);
            opacity: 1;
          }
          50% { 
            transform: scale(1.3);
            opacity: 0.7;
          }
        }
      `}</style>
    </>
  )
}

export default ModernSafetyZone
