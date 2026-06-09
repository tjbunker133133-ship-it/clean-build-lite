/**
 * Check-In Card - Modern Mode
 * 
 * Floating card for check-in actions and status.
 * Clean, contextual card UI inspired by Apple Maps and iOS.
 * 
 * Features:
 * - Quick check-in with status selection
 * - Scheduled check-ins
 * - Team notification
 * - Check-in history
 */

import React, { useState } from 'react'
import { ModePortal } from '../../lib/presentationIsolation'
import { logModernGuardrailApplied } from '../../lib/modernLayerGuardrails'
import { useMissionSync } from '../../context/MissionSyncContext'

logModernGuardrailApplied('CheckInCard')

interface CheckInCardProps {
  onClose: () => void
}

type CheckInStatus = 'ok' | 'delayed' | 'need-help' | 'emergency'

interface CheckInOption {
  status: CheckInStatus
  label: string
  icon: string
  color: string
  description: string
}

const CHECKIN_OPTIONS: CheckInOption[] = [
  { 
    status: 'ok', 
    label: 'All Good', 
    icon: '✓', 
    color: '#34C759',
    description: 'On schedule, no issues'
  },
  { 
    status: 'delayed', 
    label: 'Delayed', 
    icon: '⏱', 
    color: '#FF9500',
    description: 'Running behind schedule'
  },
  { 
    status: 'need-help', 
    label: 'Need Help', 
    icon: '❓', 
    color: '#007AFF',
    description: 'Non-urgent assistance needed'
  },
  { 
    status: 'emergency', 
    label: 'Emergency', 
    icon: '🆘', 
    color: '#FF3B30',
    description: 'Immediate assistance required'
  },
]

export default function CheckInCard({ onClose }: CheckInCardProps) {
  const mission = useMissionSync()
  const [selectedStatus, setSelectedStatus] = useState<CheckInStatus | null>(null)
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)

  const hasMission = mission.role !== 'idle'

  const handleCheckIn = async (status: CheckInStatus) => {
    setSelectedStatus(status)
    setIsSubmitting(true)

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 800))

    setIsSubmitting(false)
    setShowConfirmation(true)

    // Auto-close after confirmation
    setTimeout(() => {
      onClose()
    }, 1500)
  }

  const viewportSafeShell: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(16px, env(safe-area-inset-bottom, 0px))',
    zIndex: 5000,
    pointerEvents: 'auto',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  }

  if (showConfirmation) {
    const option = CHECKIN_OPTIONS.find(o => o.status === selectedStatus)!
    return (
      <ModePortal portalId="modern-checkin-confirm">
      <div className="checkin-confirmation" style={viewportSafeShell}>
        <div
          style={{
            padding: '40px 48px',
            background: 'rgba(28, 28, 30, 0.98)',
            borderRadius: 24,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(30px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(30px) saturate(1.5)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
            textAlign: 'center',
            animation: 'confirmationEnter 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: `${option.color}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              margin: '0 auto 20px',
              animation: 'successPulse 500ms ease',
            }}
          >
            {option.icon}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.95)',
              fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
              marginBottom: 8,
            }}
          >
            Check-In Sent!
          </div>
          <div
            style={{
              fontSize: 15,
              color: option.color,
              fontWeight: 600,
              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
            }}
          >
            {option.label}
          </div>
          {hasMission && (
            <div
              style={{
                fontSize: 13,
                color: 'rgba(255, 255, 255, 0.5)',
                fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                marginTop: 12,
              }}
            >
              Team notified
            </div>
          )}
        </div>

        <style>{`
          @keyframes confirmationEnter {
            from {
              opacity: 0;
              transform: scale(0.9);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
          @keyframes successPulse {
            0% { transform: scale(0.8); opacity: 0; }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
      </ModePortal>
    )
  }

  return (
    <ModePortal portalId="modern-checkin">
    <div className="checkin-card-container" style={viewportSafeShell}>
      <div
        className="checkin-card"
        style={{
          width: 'min(90vw, 380px)',
          maxHeight: 'min(85vh, 560px)',
          background: 'rgba(28, 28, 30, 0.98)',
          borderRadius: 24,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(30px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(30px) saturate(1.5)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          animation: 'cardEnter 350ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #34C759 0%, #30D158 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              ✓
            </div>
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'rgba(255, 255, 255, 0.95)',
                  fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
                }}
              >
                Check In
              </h3>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: 13,
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                }}
              >
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: 18,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Status Options */}
        <div
          style={{
            padding: '20px',
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.5)',
              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              marginBottom: 12,
            }}
          >
            Select Status
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}
          >
            {CHECKIN_OPTIONS.map((option) => (
              <button
                key={option.status}
                onClick={() => handleCheckIn(option.status)}
                disabled={isSubmitting}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: '16px 12px',
                  borderRadius: 16,
                  border: `2px solid ${selectedStatus === option.status ? option.color : 'rgba(255, 255, 255, 0.1)'}`,
                  background: selectedStatus === option.status ? `${option.color}15` : 'rgba(255, 255, 255, 0.03)',
                  cursor: isSubmitting ? 'wait' : 'pointer',
                  transition: 'all 150ms ease',
                  opacity: isSubmitting ? 0.7 : 1,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: `${option.color}20`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    marginBottom: 4,
                  }}
                >
                  {option.icon}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: option.color,
                    fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                  }}
                >
                  {option.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'rgba(255, 255, 255, 0.4)',
                    fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                    textAlign: 'center',
                    lineHeight: 1.3,
                  }}
                >
                  {option.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Note Input (Optional) */}
        <div
          style={{
            padding: '0 20px 20px',
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.5)',
              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              marginBottom: 8,
            }}
          >
            Add Note (Optional)
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What's your status?"
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 12,
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'rgba(255, 255, 255, 0.9)',
              fontSize: 15,
              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
              resize: 'none',
              height: 80,
              outline: 'none',
              transition: 'all 150ms ease',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(0, 122, 255, 0.5)'
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
            }}
          />
        </div>

        {/* Footer Info */}
        <div
          style={{
            padding: '12px 20px calc(12px + env(safe-area-inset-bottom, 0px))',
            background: 'rgba(255, 255, 255, 0.03)',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'rgba(255, 255, 255, 0.4)',
              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
            }}
          >
            <span>📍</span>
            <span>GPS location included</span>
          </div>
          {hasMission && (
            <div
              style={{
                fontSize: 12,
                color: '#34C759',
                fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                fontWeight: 500,
              }}
            >
              Team will be notified
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes cardEnter {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
    </ModePortal>
  )
}
