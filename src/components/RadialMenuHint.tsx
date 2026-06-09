/**
 * Radial Menu Hint - Modern Mode Primary Discovery
 *
 * Critical discovery affordance for Modern mode.
 * In Modern mode, this is the PRIMARY interaction hint and must be
 * prominent enough for users to discover the radial menu system.
 *
 * SAFETY:
 * - Always shows in Modern mode on first visit (primary UI backbone)
 * - Persists until user performs a long-press
 * - Auto-dismisses on interaction
 * - No blocking of map interaction (pointer-events: none on wrapper)
 */

import { useEffect, useState, useCallback } from 'react'

const HINT_DISMISSED_KEY = 'hud_radial_hint_dismissed_balanced_v1'

interface RadialMenuHintProps {
  /** Force hide hint (e.g., when radial menu is already open) */
  hidden?: boolean
  /** Balanced workspace discovery hint — mounted only from BalancedInteractionHost */
  balancedMode?: boolean
}

export function RadialMenuHint({ hidden = false, balancedMode = false }: RadialMenuHintProps) {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [pulsePhase, setPulsePhase] = useState(0)

  // Check if hint was previously dismissed
  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(HINT_DISMISSED_KEY)
      if (dismissed === 'true') {
        setDismissed(true)
      }
    } catch {
      // Ignore storage errors
    }
  }, [])

  // Show hint after map loads (with delay for smooth entry)
  useEffect(() => {
    if (dismissed) return
    if (hidden) return

    // Show hint after map settles
    const showTimer = setTimeout(() => {
      setVisible(true)
    }, 2000)

    return () => {
      clearTimeout(showTimer)
    }
  }, [dismissed, hidden])

  // Pulse animation for attention
  useEffect(() => {
    if (!visible) return
    
    const interval = setInterval(() => {
      setPulsePhase(p => (p + 1) % 3)
    }, 800)
    
    return () => clearInterval(interval)
  }, [visible])

  const handleDismiss = useCallback(() => {
    if (dismissed) return
    setDismissed(true)
    setVisible(false)
    try {
      localStorage.setItem(HINT_DISMISSED_KEY, 'true')
    } catch {
      // Ignore storage errors
    }
  }, [dismissed])

  // Dismiss on any pointer interaction anywhere
  useEffect(() => {
    if (!visible) return

    const handleInteraction = (e: PointerEvent) => {
      // Don't dismiss if clicking on the hint itself
      const target = e.target as HTMLElement
      if (target.closest('.radial-hint-container')) return
      
      handleDismiss()
    }

    // Delay to avoid capturing the initial load interaction
    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handleInteraction)
    }, 500)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', handleInteraction)
    }
  }, [visible, handleDismiss])

  // Listen for radial menu open event to dismiss hint
  useEffect(() => {
    if (!visible) return

    const handleRadialOpen = () => {
      handleDismiss()
    }

    window.addEventListener('hud-radial-open', handleRadialOpen)
    return () => {
      window.removeEventListener('hud-radial-open', handleRadialOpen)
    }
  }, [visible, handleDismiss])

  if (!balancedMode || !visible || hidden || dismissed) return null

  // Balanced workspace discovery hint
  return (
    <div 
      className="radial-hint-container"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          padding: false ? '24px 32px' : '16px 20px',
          borderRadius: false ? 20 : 12,
          background: false 
            ? 'rgba(28, 28, 30, 0.85)' 
            : 'rgba(8, 14, 18, 0.85)',
          border: false
            ? '1px solid rgba(255, 255, 255, 0.15)'
            : '1px solid rgba(125, 255, 138, 0.25)',
          backdropFilter: 'blur(20px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
          boxShadow: false 
            ? '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.05)' 
            : '0 4px 20px rgba(0,0,0,0.5)',
          pointerEvents: 'auto',
          animation: 'hintEnter 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          maxWidth: false ? 320 : 280,
        }}
      >
        {/* Animated touch icon */}
        <div
          style={{
            position: 'relative',
            width: false ? 64 : 48,
            height: false ? 64 : 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Pulsing rings */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: false
                ? '3px solid rgba(0, 122, 255, 0.4)'
                : '2px solid rgba(125, 255, 138, 0.4)',
              animation: pulsePhase === 0 ? 'pulseRing 800ms ease-out' : 'none',
              transform: 'scale(1)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: false
                ? '3px solid rgba(0, 122, 255, 0.3)'
                : '2px solid rgba(125, 255, 138, 0.3)',
              animation: pulsePhase === 1 ? 'pulseRing 800ms ease-out' : 'none',
              transform: 'scale(1.3)',
            }}
          />
          
          {/* Center dot */}
          <div
            style={{
              width: false ? 20 : 16,
              height: false ? 20 : 16,
              borderRadius: '50%',
              background: false
                ? 'rgba(0, 122, 255, 0.95)'
                : 'rgba(125, 255, 138, 0.9)',
              boxShadow: false
                ? '0 0 0 4px rgba(0, 122, 255, 0.3)'
                : '0 0 0 3px rgba(125, 255, 138, 0.3)',
              animation: 'pulseCenter 1.5s ease-in-out infinite',
            }}
          />
        </div>

        {/* Text content */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: false ? 18 : 14,
              fontWeight: 600,
              color: false 
                ? 'rgba(255, 255, 255, 0.95)' 
                : 'rgba(199, 206, 198, 0.95)',
              fontFamily: false
                ? '-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, sans-serif'
                : 'var(--font-ui, system-ui)',
              letterSpacing: false ? '-0.02em' : '0.02em',
              marginBottom: 8,
              lineHeight: 1.3,
            }}
          >
            {false ? 'Long-press the map' : 'Long-press map for quick actions'}
          </div>
          <div
            style={{
              fontSize: false ? 14 : 12,
              fontWeight: 400,
              color: false 
                ? 'rgba(255, 255, 255, 0.6)' 
                : 'rgba(199, 206, 198, 0.7)',
              fontFamily: false
                ? '-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif'
                : 'var(--font-ui, system-ui)',
              letterSpacing: false ? '-0.01em' : '0.01em',
              lineHeight: 1.4,
            }}
          >
            {false 
              ? 'Drop waypoints, access tools, and navigate — all from the map' 
              : 'Drop waypoints and access tools quickly'}
          </div>
        </div>

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          style={{
            padding: false ? '10px 20px' : '8px 16px',
            borderRadius: false ? 12 : 6,
            border: false 
              ? '1px solid rgba(255, 255, 255, 0.2)' 
              : '1px solid rgba(125, 255, 138, 0.3)',
            background: 'transparent',
            color: false 
              ? 'rgba(255, 255, 255, 0.8)' 
              : 'rgba(199, 206, 198, 0.8)',
            fontSize: false ? 13 : 11,
            fontWeight: 500,
            fontFamily: false
              ? '-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif'
              : 'var(--font-ui, system-ui)',
            cursor: 'pointer',
            transition: 'all 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = false 
              ? 'rgba(255, 255, 255, 0.1)' 
              : 'rgba(125, 255, 138, 0.1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          Got it
        </button>
      </div>

      <style>{`
        @keyframes hintEnter {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        
        @keyframes pulseCenter {
          0%, 100% { 
            transform: scale(1);
            opacity: 1;
          }
          50% { 
            transform: scale(0.85);
            opacity: 0.7;
          }
        }
        
        @keyframes pulseRing {
          from {
            transform: scale(1);
            opacity: 0.6;
          }
          to {
            transform: scale(1.5);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  )
}

export default RadialMenuHint
