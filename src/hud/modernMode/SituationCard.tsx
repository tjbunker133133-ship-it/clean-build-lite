/**
 * Situation Card - Modern Mode
 * 
 * Floating card for situation awareness and environmental context.
 * Clean, contextual card UI inspired by Apple Maps and iOS.
 * 
 * Features:
 * - Environmental hazard awareness
 * - Weather conditions impact
 * - Terrain and elevation data
 * - Safety zone status
 * - Mission progress summary
 */

import React, { useState } from 'react'
import { useAppContext } from '../../context/AppContext'
import { useMissionSync } from '../../context/MissionSyncContext'

interface SituationCardProps {
  onClose: () => void
}

type SituationTab = 'environment' | 'safety' | 'progress'

interface EnvironmentalFactor {
  id: string
  label: string
  icon: string
  status: 'good' | 'caution' | 'warning' | 'critical'
  value: string
  description: string
}

// Simulated environmental data (replace with actual sensors/APIs)
const ENVIRONMENTAL_DATA: EnvironmentalFactor[] = [
  {
    id: 'fire',
    label: 'Fire Risk',
    icon: '🔥',
    status: 'caution',
    value: 'Moderate',
    description: 'Red Flag Warning in effect until 8 PM',
  },
  {
    id: 'air',
    label: 'Air Quality',
    icon: '💨',
    status: 'warning',
    value: 'AQI 156',
    description: 'Unhealthy for sensitive groups',
  },
  {
    id: 'weather',
    label: 'Weather',
    icon: '⛅',
    status: 'good',
    value: '72°F',
    description: 'Partly cloudy, wind SW 8 mph',
  },
  {
    id: 'visibility',
    label: 'Visibility',
    icon: '👁️',
    status: 'good',
    value: '10 mi',
    description: 'Clear conditions',
  },
  {
    id: 'elevation',
    label: 'Elevation',
    icon: '⛰️',
    status: 'good',
    value: '5,280 ft',
    description: 'Gain: +1,200 ft today',
  },
]

interface SafetyStatus {
  system: string
  icon: string
  status: 'active' | 'standby' | 'alert' | 'triggered'
  detail: string
}

const SAFETY_SYSTEMS: SafetyStatus[] = [
  { system: 'GPS', icon: '📡', status: 'active', detail: 'Strong signal • 8 satellites' },
  { system: 'DeadMan', icon: '⏱️', status: 'standby', detail: 'Armed • 4:32 remaining' },
  { system: 'Check-in', icon: '✓', status: 'active', detail: 'Last: 12 min ago' },
  { system: 'SOS', icon: '🆘', status: 'standby', detail: 'Ready to activate' },
]

function getStatusColor(status: EnvironmentalFactor['status']): string {
  switch (status) {
    case 'good': return '#34C759'
    case 'caution': return '#FF9500'
    case 'warning': return '#FF3B30'
    case 'critical': return '#FF2D55'
  }
}

function getSafetyColor(status: SafetyStatus['status']): string {
  switch (status) {
    case 'active': return '#34C759'
    case 'standby': return '#007AFF'
    case 'alert': return '#FF9500'
    case 'triggered': return '#FF3B30'
  }
}

function getSafetyBgColor(status: SafetyStatus['status']): string {
  switch (status) {
    case 'active': return 'rgba(52, 199, 89, 0.15)'
    case 'standby': return 'rgba(0, 122, 255, 0.15)'
    case 'alert': return 'rgba(255, 149, 0, 0.15)'
    case 'triggered': return 'rgba(255, 59, 48, 0.15)'
  }
}

export default function SituationCard({ onClose }: SituationCardProps) {
  const { state } = useAppContext()
  const mission = useMissionSync()
  const [activeTab, setActiveTab] = useState<SituationTab>('environment')

  const hasMission = mission.role !== 'idle'
  const waypoints = state.waypoints

  // Calculate mission progress stats
  const totalDistance = waypoints.length > 1 ? '8.4 mi' : '0 mi'
  const estimatedTime = waypoints.length > 1 ? '4h 32m' : '--'
  const completed = 2 // Mock: number of completed waypoints

  return (
    <div
      className="situation-card-container"
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 5000,
        pointerEvents: 'auto',
      }}
    >
      <div
        className="situation-card"
        style={{
          width: '90vw',
          maxWidth: 420,
          background: 'rgba(28, 28, 30, 0.98)',
          borderRadius: 24,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(30px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(30px) saturate(1.5)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          animation: 'cardEnter 350ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
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
            background: 'linear-gradient(135deg, rgba(0, 122, 255, 0.08) 0%, transparent 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
              }}
            >
              🎯
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
                Situation
              </h3>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: 13,
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                }}
              >
                Environmental awareness
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

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            padding: '12px 20px',
            gap: 8,
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          {(['environment', 'safety', 'progress'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 10,
                border: 'none',
                background: activeTab === tab
                  ? 'rgba(0, 122, 255, 0.9)'
                  : 'rgba(255, 255, 255, 0.06)',
                color: activeTab === tab ? 'white' : 'rgba(255, 255, 255, 0.6)',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          style={{
            padding: '20px',
            maxHeight: '50vh',
            overflowY: 'auto',
          }}
        >
          {/* Environment Tab */}
          {activeTab === 'environment' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ENVIRONMENTAL_DATA.map((factor) => {
                const color = getStatusColor(factor.status)
                return (
                  <div
                    key={factor.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '14px 16px',
                      background: `${color}08`,
                      borderRadius: 14,
                      border: `1px solid ${color}20`,
                    }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        background: `${color}15`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 24,
                        flexShrink: 0,
                      }}
                    >
                      {factor.icon}
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
                            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                          }}
                        >
                          {factor.label}
                        </span>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: color,
                            color: 'white',
                            fontSize: 11,
                            fontWeight: 700,
                            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            textTransform: 'uppercase',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {factor.status}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: color,
                          fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
                          marginBottom: 2,
                        }}
                      >
                        {factor.value}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: 'rgba(255, 255, 255, 0.5)',
                          fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                        }}
                      >
                        {factor.description}
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Footer note */}
              <div
                style={{
                  marginTop: 8,
                  padding: '12px 16px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: 10,
                  fontSize: 12,
                  color: 'rgba(255, 255, 255, 0.4)',
                  fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                  textAlign: 'center',
                }}
              >
                Data updated 5 minutes ago • Tap to refresh
              </div>
            </div>
          )}

          {/* Safety Tab */}
          {activeTab === 'safety' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SAFETY_SYSTEMS.map((system) => {
                const color = getSafetyColor(system.status)
                const bgColor = getSafetyBgColor(system.status)
                return (
                  <div
                    key={system.system}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 16px',
                      background: bgColor,
                      borderRadius: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: `${color}25`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                        flexShrink: 0,
                      }}
                    >
                      {system.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: 'rgba(255, 255, 255, 0.9)',
                            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                          }}
                        >
                          {system.system}
                        </span>
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: color,
                            color: 'white',
                            fontSize: 10,
                            fontWeight: 600,
                            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            textTransform: 'uppercase',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {system.status}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: color,
                          fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                          marginTop: 2,
                        }}
                      >
                        {system.detail}
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Emergency note */}
              <div
                style={{
                  marginTop: 8,
                  padding: '16px',
                  background: 'rgba(255, 59, 48, 0.08)',
                  borderRadius: 12,
                  border: '1px solid rgba(255, 59, 48, 0.15)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 16 }}>🆘</span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#FF3B30',
                      fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                    }}
                  >
                    Emergency SOS
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                    lineHeight: 1.4,
                  }}
                >
                  Long-press the SOS button in the bottom-right corner to activate emergency services.
                </div>
              </div>
            </div>
          )}

          {/* Progress Tab */}
          {activeTab === 'progress' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Progress stats */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 12,
                }}
              >
                {[
                  { label: 'Distance', value: totalDistance, icon: '📏' },
                  { label: 'Est. Time', value: estimatedTime, icon: '⏱️' },
                  { label: 'Waypoints', value: `${completed}/${waypoints.length}`, icon: '📍' },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    style={{
                      padding: '16px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      borderRadius: 14,
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 28, marginBottom: 8 }}>{stat.icon}</div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: 'white',
                        fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
                        marginBottom: 4,
                      }}
                    >
                      {stat.value}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'rgba(255, 255, 255, 0.5)',
                        fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Progress bar */}
              {waypoints.length > 0 && (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'rgba(255, 255, 255, 0.6)',
                        fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                      }}
                    >
                      Mission Progress
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#34C759',
                        fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                      }}
                    >
                      {Math.round((completed / waypoints.length) * 100)}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: 'rgba(255, 255, 255, 0.1)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${(completed / waypoints.length) * 100}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: 'linear-gradient(90deg, #34C759 0%, #30D158 100%)',
                        transition: 'width 500ms ease',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Next waypoint preview */}
              {waypoints.length > 0 && (
                <div
                  style={{
                    padding: '16px',
                    background: 'rgba(0, 122, 255, 0.08)',
                    borderRadius: 14,
                    border: '1px solid rgba(0, 122, 255, 0.15)',
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
                    Next Waypoint
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: '#007AFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        fontWeight: 700,
                        color: 'white',
                      }}
                    >
                      {completed + 1}
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          color: 'rgba(255, 255, 255, 0.9)',
                          fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                        }}
                      >
                        {waypoints[completed]?.label || `Waypoint ${completed + 1}`}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: 'rgba(0, 122, 255, 0.9)',
                          fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                        }}
                      >
                        2.3 miles ahead • Est. 45 min
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {waypoints.length === 0 && (
                <div
                  style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>🗺️</div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: 'rgba(255, 255, 255, 0.7)',
                      fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                      marginBottom: 8,
                    }}
                  >
                    No active mission
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      color: 'rgba(255, 255, 255, 0.4)',
                      fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                    }}
                  >
                    Long-press the map to drop waypoints
                  </div>
                </div>
              )}
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
  )
}
