/**
 * Modern Preflight Wizard
 * 
 * Apple/Tesla-inspired onboarding and system check.
 * Replaces the legacy tactical PreflightPanel in Modern Mode.
 * 
 * Design principles:
 * - Clean cards with soft depth
 * - System fonts, neutral palette
 * - Large touch targets
 * - Step-by-step flow with progress
 * - No tactical chrome or neon
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ModePortal } from '../../lib/presentationIsolation'

/** Above TacticalSetupBanner (10050) and PermissionPromptOverlay (100002). */
const PREFLIGHT_WIZARD_Z = 100003
import { useGPS, requestLocation } from '../../hooks/useGPS'
import {
  getPermissionSnapshot,
  requestMicrophonePermission,
  requestNotificationPermission,
  requestOrientationPermission,
} from '../../lib/devicePermissions'
import { updateGestureActive } from '../../runtime/runtimeSnapshot'

const WIZARD_COMPLETED_KEY = 'wizardCompleted'

interface PreflightWizardProps {
  onClose: () => void
}

type CheckStatus = 'pending' | 'checking' | 'pass' | 'warn' | 'fail'

interface SystemCheck {
  id: string
  label: string
  description: string
  status: CheckStatus
  icon: string
  required: boolean
}

const MODERN_BG = 'rgba(28, 28, 30, 0.98)'
const MODERN_SURFACE = 'rgba(44, 44, 46, 0.95)'
const MODERN_BORDER = 'rgba(255, 255, 255, 0.1)'
const ACCENT_BLUE = '#007AFF'
const ACCENT_GREEN = '#34C759'
const ACCENT_ORANGE = '#FF9500'
const ACCENT_RED = '#FF3B30'

function persistWizardCompleted(): void {
  try {
    localStorage.setItem(WIZARD_COMPLETED_KEY, 'true')
  } catch {
    /* private mode / quota */
  }
}

function resolveCheckStatus(
  checkId: string,
  snapshot: Awaited<ReturnType<typeof getPermissionSnapshot>>,
  hasGpsFix: boolean,
): CheckStatus {
  switch (checkId) {
    case 'gps':
      if (hasGpsFix || snapshot.geolocation === 'granted') return 'pass'
      if (snapshot.geolocation === 'denied') return 'fail'
      return 'pending'
    case 'compass': {
      const orientReq = typeof (DeviceOrientationEvent as any)?.requestPermission === 'function'
      if (!orientReq) return snapshot.geolocation === 'granted' ? 'pass' : 'pending'
      return snapshot.geolocation === 'granted' ? 'pass' : 'pending'
    }
    case 'microphone':
      if (snapshot.microphone === 'granted') return 'pass'
      if (snapshot.microphone === 'denied') return 'fail'
      return 'pending'
    case 'notifications':
      if (snapshot.notifications === 'granted') return 'pass'
      if (snapshot.notifications === 'denied') return 'fail'
      return 'pending'
    case 'offline':
      return typeof navigator !== 'undefined' && 'caches' in window ? 'pass' : 'pending'
    default:
      return 'pending'
  }
}

export function PreflightWizard({ onClose }: PreflightWizardProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [checks, setChecks] = useState<SystemCheck[]>([
    {
      id: 'gps',
      label: 'Location Services',
      description: 'Access to your position for navigation and safety',
      status: 'pending',
      icon: '📍',
      required: true,
    },
    {
      id: 'compass',
      label: 'Motion & Compass',
      description: 'Device orientation for heading and bearing',
      status: 'pending',
      icon: '🧭',
      required: false,
    },
    {
      id: 'microphone',
      label: 'Voice Commands',
      description: 'Hands-free control during activity',
      status: 'pending',
      icon: '🎤',
      required: false,
    },
    {
      id: 'notifications',
      label: 'Safety Alerts',
      description: 'Critical alerts even when app is backgrounded',
      status: 'pending',
      icon: '🔔',
      required: false,
    },
    {
      id: 'offline',
      label: 'Offline Maps',
      description: 'Cached map data for areas without signal',
      status: 'pending',
      icon: '🗺️',
      required: false,
    },
  ])

  const [isReady, setIsReady] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [permissionBusy, setPermissionBusy] = useState(false)
  const hadGpsFixRef = useRef(false)

  const gps = useGPS()
  const gpsRef = useRef(gps)
  gpsRef.current = gps
  const handleClose = useCallback(() => {
    persistWizardCompleted()
    onClose()
  }, [onClose])

  // Run permission checks — mount, after Allow taps, and when GPS first locks.
  const runChecks = useCallback(async () => {
    setIsChecking(true)
    try {
      const snapshot = await getPermissionSnapshot()
      const hasGpsFix = gpsRef.current.lat != null && gpsRef.current.lng != null
      setChecks((prev) =>
        prev.map((check) => ({
          ...check,
          status: resolveCheckStatus(check.id, snapshot, hasGpsFix),
        })),
      )
    } finally {
      setIsChecking(false)
    }
  }, [])

  useEffect(() => {
    void runChecks()
  }, [runChecks])

  useEffect(() => {
    const hasFix = gps.lat != null && gps.lng != null
    if (hasFix && !hadGpsFixRef.current) {
      hadGpsFixRef.current = true
      void runChecks()
      return
    }
    if (!hasFix) hadGpsFixRef.current = false
  }, [gps.lat, gps.lng, runChecks])

  // Check if all required checks pass
  useEffect(() => {
    const allRequiredPass = checks
      .filter(c => c.required)
      .every(c => c.status === 'pass')
    setIsReady(allRequiredPass)
  }, [checks])

  const handleRequestPermission = useCallback(
    async (checkId: string) => {
      if (permissionBusy) return
      setPermissionBusy(true)
      updateGestureActive(true)
      setChecks((prev) =>
        prev.map((c) => (c.id === checkId ? { ...c, status: 'checking' } : c)),
      )

      try {
        switch (checkId) {
          case 'gps':
            await requestLocation()
            break
          case 'compass':
            await requestOrientationPermission()
            break
          case 'microphone':
            await requestMicrophonePermission()
            break
          case 'notifications':
            await requestNotificationPermission()
            break
        }
        await runChecks()
      } catch {
        setChecks((prev) =>
          prev.map((c) => (c.id === checkId ? { ...c, status: 'fail' } : c)),
        )
      } finally {
        setPermissionBusy(false)
        updateGestureActive(false)
      }
    },
    [permissionBusy, runChecks],
  )

  const getStatusColor = (status: CheckStatus) => {
    switch (status) {
      case 'pass': return ACCENT_GREEN
      case 'warn': return ACCENT_ORANGE
      case 'fail': return ACCENT_RED
      case 'checking': return ACCENT_BLUE
      default: return 'rgba(255, 255, 255, 0.3)'
    }
  }

  const getStatusIcon = (status: CheckStatus) => {
    switch (status) {
      case 'pass': return '✓'
      case 'warn': return '!'
      case 'fail': return '✕'
      case 'checking': return '◐'
      default: return '○'
    }
  }

  const totalSteps = 3
  const progress = ((currentStep + 1) / totalSteps) * 100

  const wizardContent = (
    <div
      data-testid="modern-preflight-wizard"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(20px) saturate(0.8)',
        WebkitBackdropFilter: 'blur(20px) saturate(0.8)',
        zIndex: PREFLIGHT_WIZARD_Z,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
        animation: 'wizardEnter 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        pointerEvents: 'auto',
        touchAction: 'manipulation',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '85vh',
          background: MODERN_BG,
          borderRadius: 20,
          border: `1px solid ${MODERN_BORDER}`,
          boxShadow: '0 25px 80px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.05)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 24px 16px',
            borderBottom: `1px solid ${MODERN_BORDER}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 700,
                color: 'rgba(255, 255, 255, 0.95)',
                letterSpacing: '-0.02em',
              }}
            >
              {currentStep === 0 && 'System Setup'}
              {currentStep === 1 && 'Permissions'}
              {currentStep === 2 && 'Ready to Go'}
            </h2>
            <button
              type="button"
              onClick={handleClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.7)',
                fontSize: 18,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 200ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
              }}
            >
              ×
            </button>
          </div>

          {/* Progress bar */}
          <div
            style={{
              height: 4,
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                background: `linear-gradient(90deg, ${ACCENT_BLUE}, ${ACCENT_GREEN})`,
                borderRadius: 2,
                transition: 'width 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
              }}
            />
          </div>
          
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 8,
              fontSize: 12,
              color: 'rgba(255, 255, 255, 0.5)',
            }}
          >
            <span>Step {currentStep + 1} of {totalSteps}</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px 24px',
          }}
        >
          {currentStep === 0 && (
            <div style={{ animation: 'fadeIn 300ms ease' }}>
              <div
                style={{
                  background: `linear-gradient(135deg, ${ACCENT_BLUE}20, ${ACCENT_GREEN}10)`,
                  borderRadius: 16,
                  padding: 24,
                  marginBottom: 20,
                  border: `1px solid ${ACCENT_BLUE}30`,
                }}
              >
                <div style={{ fontSize: 48, marginBottom: 12 }}>🏔️</div>
                <h3
                  style={{
                    margin: '0 0 8px',
                    fontSize: 20,
                    fontWeight: 600,
                    color: 'rgba(255, 255, 255, 0.95)',
                  }}
                >
                  Welcome to Signal One
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: 15,
                    color: 'rgba(255, 255, 255, 0.7)',
                    lineHeight: 1.5,
                  }}
                >
                  Your modern outdoor safety operating system. Let's get you set up for your next adventure.
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: 12,
                }}
              >
                {[
                  { icon: '📍', title: 'Location Tracking', desc: 'Real-time position and navigation' },
                  { icon: '👥', title: 'Team Coordination', desc: 'Share location with your group' },
                  { icon: '🆘', title: 'Emergency Features', desc: 'SOS and deadman safety systems' },
                  { icon: '🗺️', title: 'Offline Maps', desc: 'Works without cell signal' },
                ].map((feature, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      padding: 16,
                      background: MODERN_SURFACE,
                      borderRadius: 12,
                      border: `1px solid ${MODERN_BORDER}`,
                    }}
                  >
                    <span style={{ fontSize: 28 }}>{feature.icon}</span>
                    <div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: 'rgba(255, 255, 255, 0.9)',
                          marginBottom: 2,
                        }}
                      >
                        {feature.title}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: 'rgba(255, 255, 255, 0.5)',
                        }}
                      >
                        {feature.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div style={{ animation: 'fadeIn 300ms ease' }}>
              <p
                style={{
                  margin: '0 0 20px',
                  fontSize: 15,
                  color: 'rgba(255, 255, 255, 0.7)',
                  lineHeight: 1.5,
                }}
              >
                Signal One needs a few permissions to keep you safe and connected in the outdoors.
              </p>

              <div style={{ display: 'grid', gap: 12 }}>
                {checks.map((check) => (
                  <div
                    key={check.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      padding: 16,
                      background: MODERN_SURFACE,
                      borderRadius: 12,
                      border: `1px solid ${check.status === 'pass' ? ACCENT_GREEN + '40' : MODERN_BORDER}`,
                      transition: 'all 200ms ease',
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: getStatusColor(check.status) + '20',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 22,
                        flexShrink: 0,
                      }}
                    >
                      {check.status === 'pass' ? check.icon : getStatusIcon(check.status)}
                    </div>
                    
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: 'rgba(255, 255, 255, 0.9)',
                          }}
                        >
                          {check.label}
                        </span>
                        {check.required && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              background: ACCENT_ORANGE + '30',
                              color: ACCENT_ORANGE,
                              borderRadius: 4,
                              fontWeight: 600,
                            }}
                          >
                            Required
                          </span>
                        )}
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          color: 'rgba(255, 255, 255, 0.5)',
                        }}
                      >
                        {check.description}
                      </p>
                    </div>

                    {check.status !== 'pass' && (
                      <button
                        type="button"
                        onClick={() => void handleRequestPermission(check.id)}
                        disabled={check.status === 'checking' || permissionBusy}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 8,
                          border: 'none',
                          background: check.status === 'checking' 
                            ? 'rgba(255, 255, 255, 0.1)' 
                            : ACCENT_BLUE,
                          color: 'white',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: check.status === 'checking' ? 'default' : 'pointer',
                          opacity: check.status === 'checking' ? 0.6 : 1,
                          transition: 'all 200ms ease',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {check.status === 'checking' ? '...' : 'Allow'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                animation: 'fadeIn 300ms ease',
              }}
            >
              <div
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${ACCENT_GREEN}30, ${ACCENT_GREEN}10)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 24px',
                  fontSize: 48,
                  border: `2px solid ${ACCENT_GREEN}`,
                  boxShadow: `0 0 40px ${ACCENT_GREEN}40`,
                }}
              >
                ✓
              </div>
              
              <h3
                style={{
                  margin: '0 0 8px',
                  fontSize: 24,
                  fontWeight: 700,
                  color: 'rgba(255, 255, 255, 0.95)',
                }}
              >
                You're All Set!
              </h3>
              
              <p
                style={{
                  margin: '0 0 32px',
                  fontSize: 15,
                  color: 'rgba(255, 255, 255, 0.7)',
                  lineHeight: 1.6,
                  maxWidth: 320,
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
              >
                {isReady
                  ? 'All required permissions are granted. You can now use all features of Signal One.'
                  : 'Basic functionality is available. Grant additional permissions for full features.'}
              </p>

              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  maxWidth: 280,
                  margin: '0 auto',
                }}
              >
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    padding: '16px 24px',
                    borderRadius: 12,
                    border: 'none',
                    background: ACCENT_GREEN,
                    color: 'white',
                    fontSize: 17,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 200ms ease',
                  }}
                >
                  Get Started
                </button>
                
                {!isReady && (
                  <button
                    onClick={() => setCurrentStep(1)}
                    style={{
                      padding: '12px 24px',
                      borderRadius: 12,
                      border: 'none',
                      background: 'transparent',
                      color: 'rgba(255, 255, 255, 0.6)',
                      fontSize: 15,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Go Back to Permissions
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        {currentStep < 2 && (
          <div
            style={{
              padding: '16px 24px 24px',
              borderTop: `1px solid ${MODERN_BORDER}`,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <button
              type="button"
              onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
              disabled={currentStep === 0}
              style={{
                padding: '12px 20px',
                borderRadius: 10,
                border: 'none',
                background: 'transparent',
                color: currentStep === 0 ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.7)',
                fontSize: 15,
                fontWeight: 600,
                cursor: currentStep === 0 ? 'default' : 'pointer',
              }}
            >
              Back
            </button>
            
            <button
              type="button"
              onClick={() => setCurrentStep(Math.min(totalSteps - 1, currentStep + 1))}
              style={{
                padding: '12px 24px',
                borderRadius: 10,
                border: 'none',
                background: ACCENT_BLUE,
                color: 'white',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 200ms ease',
              }}
            >
              {currentStep === 1 ? 'Finish' : 'Continue'}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes wizardEnter {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )

  return (
    <ModePortal portalId="modern-preflight-wizard" owner="global">
      {wizardContent}
    </ModePortal>
  )
}

export default PreflightWizard
