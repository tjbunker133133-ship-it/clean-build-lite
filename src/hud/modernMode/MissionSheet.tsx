/**
 * Mission Sheet - Modern Mode
 * 
 * Bottom sheet for mission management and team coordination.
 * Apple Maps-style presentation with grounded, sheet-based UI.
 * 
 * Features:
 * - Mission status and progress
 * - Team member presence and status
 * - Waypoint sharing
 * - Check-in coordination
 */

import React, { useState, useCallback, useSyncExternalStore } from 'react'
import { useMissionSync } from '../../context/MissionSyncContext'
import {
  enterMission,
  exitMission,
  formatMissionDuration,
  getMissionSnapshot,
  isMissionSessionActive,
  pauseMission,
  resumeMission,
  subscribeMission,
} from '../../lib/missionController'
import {
  formatJoinCode,
  isValidJoinCodeInput,
  normalizeJoinCodeInput,
} from '../../lib/missionSync/joinCode'
import type { ConnectedPeer, MissionSyncRole } from '../../lib/missionSync/types'
import {
  logModernGuardrailApplied,
  logModernGuardrailTransition,
} from '../../lib/modernLayerGuardrails'
import { getDeviceProfile } from '../../runtime/deviceProfile'

logModernGuardrailApplied('MissionSheet')

interface MissionSheetProps {
  onClose: () => void
  variant?: 'modern' | 'balanced'
}

// Extended member interface for UI display (combines real peer data with UI fields)
interface TeamMemberDisplay {
  id: string
  name: string
  role: 'leader' | 'member'
  status: 'active' | 'paused' | 'alert' | 'offline'
  lastCheckIn: string
  batteryLevel: number
  isSelf: boolean
}

function getStatusColor(status: TeamMemberDisplay['status']): string {
  switch (status) {
    case 'active': return '#34C759'
    case 'paused': return '#FF9500'
    case 'alert': return '#FF3B30'
    case 'offline': return '#8E8E93'
  }
}

function getBatteryColor(level: number): string {
  if (level > 60) return '#34C759'
  if (level > 20) return '#FF9500'
  return '#FF3B30'
}

// Convert real peer data to display format
function peersToDisplay(peers: ConnectedPeer[], role: MissionSyncRole): TeamMemberDisplay[] {
  // Start with self
  const display: TeamMemberDisplay[] = [{
    id: 'self',
    name: 'You',
    role: role === 'member' ? 'leader' : 'member', // If we're a member, we're effectively the leader of our view
    status: 'active',
    lastCheckIn: 'Just now',
    batteryLevel: 85, // TODO: Get actual battery
    isSelf: true,
  }]
  
  // Add connected peers
  peers.forEach((peer, index) => {
    display.push({
      id: peer.peerId,
      name: peer.callsign || `Team ${index + 1}`,
      role: 'member',
      status: 'active', // TODO: Derive from peer data
      lastCheckIn: 'Just now', // TODO: Get from peer
      batteryLevel: 75, // TODO: Get from peer
      isSelf: false,
    })
  })
  
  return display
}

export default function MissionSheet({ onClose, variant = 'modern' }: MissionSheetProps) {
  const mission = useMissionSync()
  const missionSession = useSyncExternalStore(subscribeMission, getMissionSnapshot, getMissionSnapshot)
  const [activeTab, setActiveTab] = useState<'overview' | 'team' | 'waypoints'>('overview')
  const [showShareCode, setShowShareCode] = useState(false)
  const [joinMode, setJoinMode] = useState(false)
  const [missionName, setMissionName] = useState(missionSession.missionName || 'Field mission')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [pasteBundle, setPasteBundle] = useState('')
  const [starting, setStarting] = useState(false)
  const [missionFeedback, setMissionFeedback] = useState<string | null>(null)

  const hasControllerMission = isMissionSessionActive()
  const hasTeamMesh = mission.role !== 'idle'
  const hasMission = hasControllerMission || hasTeamMesh
  const isSolo = missionSession.kind === 'solo' && hasControllerMission
  const isPaused = missionSession.status === 'paused'
  const isMember = mission.role === 'member'
  const isHost = mission.isMissionHost
  const waypointCount = missionSession.waypoints.length
  const routeLabel = missionSession.mapSession?.routeName ?? 'Unbound route'
  const durationLabel = formatMissionDuration()
  const connectivityLabel = missionSession.environment.online ? 'Online' : 'Offline'

  const handleStartMission = useCallback(async () => {
    if (starting) return
    const name = missionName.trim()
    if (!name) {
      setMissionFeedback('Enter a mission name before starting')
      logModernGuardrailTransition('mission-start-failed', { reason: 'empty_name' })
      return
    }
    setMissionFeedback(null)
    logModernGuardrailTransition('mission-start-attempt', { kind: mission.supported ? 'team' : 'solo' })
    if (!mission.supported) {
      enterMission({ missionName: name, kind: 'solo' })
      setShowShareCode(false)
      logModernGuardrailTransition('mission-start-success', { kind: 'solo' })
      return
    }
    setStarting(true)
    try {
      await mission.startMission(name)
      setShowShareCode(true)
      logModernGuardrailTransition('mission-start-success', { kind: 'team' })
    } catch {
      setMissionFeedback('Could not start mission — try again')
      logModernGuardrailTransition('mission-start-failed', { reason: 'start_error' })
    } finally {
      setStarting(false)
    }
  }, [mission, missionName, starting])

  const handleJoinMission = useCallback(async () => {
    if (starting) return
    const bundle = pasteBundle.trim()
    const code = normalizeJoinCodeInput(joinCodeInput)
    if (!bundle && !isValidJoinCodeInput(code)) {
      setMissionFeedback('Enter a join code or paste an invite link')
      logModernGuardrailTransition('mission-join-failed', { reason: 'empty_input' })
      return
    }
    setMissionFeedback(null)
    logModernGuardrailTransition('mission-join-attempt', { hasBundle: Boolean(bundle) })
    setStarting(true)
    try {
      if (bundle) {
        await mission.startJoinMission(bundle)
        logModernGuardrailTransition('mission-join-success', { method: 'bundle' })
        return
      }
      if (isValidJoinCodeInput(code)) {
        await mission.discoverMissionOnLan(code)
        logModernGuardrailTransition('mission-join-success', { method: 'code' })
      }
    } catch {
      setMissionFeedback('Could not join mission — check code and try again')
      logModernGuardrailTransition('mission-join-failed', { reason: 'join_error' })
    } finally {
      setStarting(false)
    }
  }, [joinCodeInput, mission, pasteBundle, starting])

  const handleEndMission = useCallback(() => {
    if (hasTeamMesh) mission.endMission()
    exitMission('sheet_end')
  }, [hasTeamMesh, mission])

  const handleShareInvite = useCallback(async () => {
    await mission.createJoinOffer()
    setShowShareCode(true)
  }, [mission])

  const handleSendLocation = useCallback(() => {
    mission.sendTeamCheckIn('Location shared from mission sheet')
    mission.pushSnapshotNow()
  }, [mission])

  const team = hasTeamMesh
    ? peersToDisplay(mission.peers, mission.role)
    : isSolo
      ? [{
          id: 'self',
          name: 'You',
          role: 'leader' as const,
          status: isPaused ? 'paused' as const : 'active' as const,
          lastCheckIn: 'Solo session',
          batteryLevel: 85,
          isSelf: true,
        }]
      : []

  const isBalanced = variant === 'balanced'
  const isMobile = getDeviceProfile().interactionMode === 'mobile'

  return (
    <div
      className={`mission-sheet-container ${isBalanced ? 'balanced-mission-sheet' : 'modern-spatial-sheet'}`}
      data-sheet-layer={variant}
      style={{
        position: isBalanced ? 'absolute' : 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        top: isBalanced ? 0 : undefined,
        zIndex: isBalanced ? 1 : 5000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        pointerEvents: isBalanced ? 'auto' : 'none',
        padding: isBalanced
          ? `0 ${isMobile ? 0 : 16}px calc(${isMobile ? 8 : 20}px + env(safe-area-inset-bottom))`
          : '0 16px calc(20px + env(safe-area-inset-bottom))',
        background: isBalanced ? 'rgba(0,0,0,0.42)' : 'transparent',
      }}
      onClick={isBalanced ? onClose : undefined}
    >
      <div
        className="mission-sheet"
        onClick={isBalanced ? (e) => e.stopPropagation() : undefined}
        style={{
          width: '100%',
          maxWidth: isBalanced && isMobile ? '100%' : 500,
          maxHeight: isBalanced ? (isMobile ? 'min(92vh, 720px)' : 'min(80vh, 640px)') : undefined,
          overflowY: isBalanced ? 'auto' : undefined,
          background: 'rgba(28, 28, 30, 0.98)',
          borderRadius: isBalanced
            ? `${isMobile ? 20 : 24}px ${isMobile ? 20 : 24}px 0 0`
            : '24px 24px 32px 32px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(30px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(30px) saturate(1.5)',
          boxShadow: '0 -8px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.05)',
          pointerEvents: 'auto',
          overflow: 'hidden',
          animation: 'sheetEnter 350ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}
      >
        {/* Handle bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px 0 8px',
          }}
        >
          <div
            style={{
              width: 40,
              height: 5,
              borderRadius: 3,
              background: 'rgba(255, 255, 255, 0.25)',
            }}
          />
        </div>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: 'rgba(255, 255, 255, 0.95)',
                fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
                letterSpacing: '-0.02em',
              }}
            >
              Mission
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                color: 'rgba(255, 255, 255, 0.5)',
                fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
              }}
            >
              {hasMission
                ? isSolo
                  ? 'Solo field session active'
                  : 'Active team coordination'
                : 'Start or join a mission'}
            </p>
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

        {hasMission ? (
          <>
            {/* Tabs */}
            <div
              style={{
                display: 'flex',
                padding: '12px 20px',
                gap: 8,
              }}
            >
              {(['overview', 'team', 'waypoints'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 10,
                    border: 'none',
                    background: activeTab === tab
                      ? 'rgba(0, 122, 255, 0.9)'
                      : 'rgba(255, 255, 255, 0.08)',
                    color: activeTab === tab ? 'white' : 'rgba(255, 255, 255, 0.7)',
                    fontSize: 14,
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

            {/* Tab Content */}
            <div
              style={{
                padding: '0 20px 24px',
                maxHeight: '60vh',
                overflowY: 'auto',
              }}
            >
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Mission Status Card */}
                  <div
                    style={{
                      padding: '20px',
                      background: 'linear-gradient(135deg, rgba(0, 122, 255, 0.15) 0%, rgba(0, 122, 255, 0.05) 100%)',
                      borderRadius: 16,
                      border: '1px solid rgba(0, 122, 255, 0.2)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 12,
                          background: 'rgba(0, 122, 255, 0.9)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 22,
                        }}
                      >
                        👥
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 17,
                            fontWeight: 600,
                            color: 'rgba(255, 255, 255, 0.95)',
                            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                          }}
                        >
                          {missionSession.missionName || 'Active Mission'}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: 'rgba(0, 122, 255, 0.9)',
                            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                          }}
                        >
                          {isSolo
                            ? `Solo · ${durationLabel} · ${connectivityLabel}`
                            : isMember
                              ? 'Connected as member'
                              : `${mission.peers.length} team member${mission.peers.length !== 1 ? 's' : ''}`}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
                          Route: {routeLabel} · {waypointCount} waypoint{waypointCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div
                      style={{
                        display: 'flex',
                        gap: 16,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          padding: '12px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: 10,
                          textAlign: 'center',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 24,
                            fontWeight: 700,
                            color: 'white',
                            fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
                          }}
                        >
                          {team.length}
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
                          Members
                        </div>
                      </div>
                      <div
                        style={{
                          flex: 1,
                          padding: '12px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: 10,
                          textAlign: 'center',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 24,
                            fontWeight: 700,
                            color: 'white',
                            fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
                          }}
                        >
                          {waypointCount}
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
                          Waypoints
                        </div>
                      </div>
                      <div
                        style={{
                          flex: 1,
                          padding: '12px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: 10,
                          textAlign: 'center',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 24,
                            fontWeight: 700,
                            color: '#34C759',
                            fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
                          }}
                        >
                          {team.filter(m => m.status === 'active').length}
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
                          Active
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'rgba(255, 255, 255, 0.6)',
                        fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                        marginBottom: 12,
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      Quick Actions
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <button
                        onClick={() => void handleShareInvite()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '14px 16px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: 12,
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          cursor: 'pointer',
                          transition: 'all 150ms ease',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 24 }}>🔗</span>
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: 'rgba(255, 255, 255, 0.9)',
                              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            }}
                          >
                            {isMember ? 'Share Mission Code' : 'Invite Others'}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'rgba(255, 255, 255, 0.5)',
                              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            }}
                          >
                            {isMember ? 'Connected to mission' : 'Share join link'}
                          </div>
                        </div>
                        <span style={{ fontSize: 20, color: 'rgba(255, 255, 255, 0.5)' }}>›</span>
                      </button>

                      {hasControllerMission ? (
                        <>
                          <button
                            type="button"
                            onClick={() => (isPaused ? resumeMission() : pauseMission())}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: '14px 16px',
                              background: 'rgba(255, 149, 0, 0.08)',
                              borderRadius: 12,
                              border: '1px solid rgba(255, 149, 0, 0.25)',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span style={{ fontSize: 24 }}>{isPaused ? '▶' : '⏸'}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                                {isPaused ? 'Resume mission' : 'Pause mission'}
                              </div>
                              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                                Preserves route and waypoint bindings
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={handleEndMission}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: '14px 16px',
                              background: 'rgba(255, 59, 48, 0.08)',
                              borderRadius: 12,
                              border: '1px solid rgba(255, 59, 48, 0.25)',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span style={{ fontSize: 24 }}>⏹</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                                End mission
                              </div>
                              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                                Clear session and persist final snapshot
                              </div>
                            </div>
                          </button>
                        </>
                      ) : null}

                      <button
                        onClick={handleSendLocation}
                        disabled={!hasTeamMesh}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '14px 16px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: 12,
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          cursor: hasMission ? 'pointer' : 'not-allowed',
                          opacity: hasMission ? 1 : 0.5,
                          transition: 'all 150ms ease',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 24 }}>📍</span>
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: 'rgba(255, 255, 255, 0.9)',
                              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            }}
                          >
                            Send Location
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'rgba(255, 255, 255, 0.5)',
                              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            }}
                          >
                            Share current GPS with team
                          </div>
                        </div>
                        <span style={{ fontSize: 20, color: 'rgba(255, 255, 255, 0.5)' }}>›</span>
                      </button>
                    </div>
                  </div>

                  {(showShareCode || isHost) && mission.joinCode ? (
                    <div
                      style={{
                        padding: '16px',
                        borderRadius: 12,
                        background: 'rgba(0, 122, 255, 0.08)',
                        border: '1px solid rgba(0, 122, 255, 0.2)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: 'rgba(255, 255, 255, 0.5)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          marginBottom: 8,
                        }}
                      >
                        Mission join code
                      </div>
                      <div
                        style={{
                          fontSize: 28,
                          fontWeight: 700,
                          letterSpacing: 3,
                          color: '#5eead4',
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        {formatJoinCode(mission.joinCode)}
                      </div>
                      <p
                        style={{
                          margin: '8px 0 0',
                          fontSize: 13,
                          color: 'rgba(255, 255, 255, 0.55)',
                          lineHeight: 1.4,
                        }}
                      >
                        Share this code with teammates on the same Wi‑Fi hotspot.
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Team Tab */}
              {activeTab === 'team' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {team.length === 0 ? (
                    <div style={{ padding: '24px 12px', textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
                      Waiting for teammates to connect…
                    </div>
                  ) : null}
                  {team.map((member) => (
                    <div
                      key={member.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '14px 16px',
                        background: member.isSelf ? 'rgba(0, 122, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                        borderRadius: 12,
                        border: member.isSelf ? '1px solid rgba(0, 122, 255, 0.15)' : 'none',
                      }}
                    >
                      {/* Avatar */}
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          background: member.role === 'leader'
                            ? 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)'
                            : 'rgba(255, 255, 255, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                          fontWeight: 600,
                          color: 'white',
                          fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                          position: 'relative',
                        }}
                      >
                        {member.name.charAt(0)}
                        {/* Status indicator */}
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            background: getStatusColor(member.status),
                            border: '2px solid rgba(28, 28, 30, 0.98)',
                          }}
                        />
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 16,
                              fontWeight: 600,
                              color: 'rgba(255, 255, 255, 0.95)',
                              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            }}
                          >
                            {member.name}
                          </span>
                          {member.role === 'leader' && (
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: 'rgba(0, 122, 255, 0.3)',
                                fontSize: 10,
                                fontWeight: 700,
                                color: '#007AFF',
                                textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                              }}
                            >
                              LEAD
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'rgba(255, 255, 255, 0.5)',
                            fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            marginTop: 2,
                          }}
                        >
                          {member.lastCheckIn} • {member.isSelf ? 'Your position' : 'Nearby'}
                        </div>
                      </div>

                      {/* Battery */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            color: getBatteryColor(member.batteryLevel),
                            fontWeight: 600,
                          }}
                        >
                          {member.batteryLevel}%
                        </span>
                        <span style={{ fontSize: 12 }}>🔋</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Waypoints Tab */}
              {activeTab === 'waypoints' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {missionSession.waypoints.length === 0 ? (
                    <div
                      style={{
                        padding: '40px 20px',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📍</div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          color: 'rgba(255, 255, 255, 0.7)',
                          fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                          marginBottom: 8,
                        }}
                      >
                        No waypoints yet
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
                  ) : (
                    missionSession.waypoints.map((waypoint, index) => (
                      <div
                        key={waypoint.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '14px 16px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          borderRadius: 12,
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: index === 0 ? '#22c55e' : index === missionSession.waypoints.length - 1 ? '#f472b6' : '#3b82f6',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 14,
                            fontWeight: 700,
                            color: 'white',
                          }}
                        >
                          {index + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: 'rgba(255, 255, 255, 0.9)',
                              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            }}
                          >
                            {waypoint.label || `${waypoint.type} ${index + 1}`}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'rgba(255, 255, 255, 0.5)',
                              fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                            }}
                          >
                            {waypoint.type.charAt(0).toUpperCase() + waypoint.type.slice(1)} •
                            {waypoint.lat.toFixed(4)}, {waypoint.lng.toFixed(4)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          /* No Mission - Start Screen */
          <div style={{ padding: '0 20px 32px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: joinMode ? '24px 12px' : '40px 20px',
                textAlign: 'center',
              }}
            >
              {!joinMode ? (
                <>
                  <div
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, rgba(0, 122, 255, 0.2) 0%, rgba(88, 86, 214, 0.2) 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 40,
                      marginBottom: 20,
                    }}
                  >
                    👥
                  </div>
                  <h3
                    style={{
                      margin: '0 0 8px',
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'rgba(255, 255, 255, 0.95)',
                      fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
                    }}
                  >
                    Start a Mission
                  </h3>
                  <p
                    style={{
                      margin: '0 0 20px',
                      fontSize: 15,
                      color: 'rgba(255, 255, 255, 0.5)',
                      fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                      lineHeight: 1.4,
                    }}
                  >
                    Coordinate with your team, share waypoints, and stay connected in the field.
                  </p>

                  <input
                    value={missionName}
                    onChange={(e) => {
                      setMissionName(e.target.value)
                      if (missionFeedback) setMissionFeedback(null)
                    }}
                    placeholder="Mission name"
                    style={{
                      width: '100%',
                      marginBottom: 12,
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: 'rgba(255, 255, 255, 0.9)',
                      fontSize: 16,
                      fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                    }}
                  />

                  {missionFeedback ? (
                    <div
                      role="alert"
                      style={{
                        width: '100%',
                        marginBottom: 12,
                        padding: '10px 14px',
                        borderRadius: 12,
                        background: 'rgba(255, 59, 48, 0.12)',
                        border: '1px solid rgba(255, 59, 48, 0.35)',
                        color: '#ff8a80',
                        fontSize: 13,
                        fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                      }}
                    >
                      {missionFeedback}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    disabled={starting}
                    onClick={() => void handleStartMission()}
                    style={{
                      width: '100%',
                      padding: '16px 24px',
                      borderRadius: 14,
                      border: 'none',
                      background: 'rgba(0, 122, 255, 0.9)',
                      color: 'white',
                      fontSize: 17,
                      fontWeight: 600,
                      fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                      marginBottom: 12,
                    }}
                  >
                    {starting ? 'Starting…' : mission.supported ? 'Start Team Mission' : 'Start Solo Field Session'}
                  </button>

                  {!mission.supported ? (
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }}>
                      Team link needs WebRTC. Solo session works offline with waypoints and route.
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setJoinMode(true)}
                    style={{
                      width: '100%',
                      padding: '16px 24px',
                      borderRadius: 14,
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      background: 'transparent',
                      color: 'rgba(255, 255, 255, 0.8)',
                      fontSize: 17,
                      fontWeight: 600,
                      fontFamily: '-apple-system, SF Pro Text, system-ui, sans-serif',
                      cursor: 'pointer',
                    }}
                  >
                    Join Existing Mission
                  </button>
                </>
              ) : (
                <div style={{ width: '100%', textAlign: 'left' }}>
                  <button
                    type="button"
                    onClick={() => setJoinMode(false)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'rgba(255,255,255,0.6)',
                      fontSize: 14,
                      marginBottom: 12,
                      cursor: 'pointer',
                    }}
                  >
                    ← Back
                  </button>
                  <h3 style={{ margin: '0 0 8px', fontSize: 18, color: 'rgba(255,255,255,0.95)' }}>
                    Join Mission
                  </h3>
                  <p style={{ margin: '0 0 16px', fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
                    Enter the host code or paste a join bundle from your teammate.
                  </p>
                  <input
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    placeholder="Code e.g. ABC-123"
                    style={{
                      width: '100%',
                      marginBottom: 10,
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: '#5eead4',
                      fontSize: 20,
                      fontWeight: 700,
                      letterSpacing: 2,
                      textAlign: 'center',
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  />
                  {joinCodeInput && isValidJoinCodeInput(joinCodeInput) ? (
                    <p style={{ margin: '0 0 10px', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                      Code: {formatJoinCode(normalizeJoinCodeInput(joinCodeInput))}
                    </p>
                  ) : null}
                  <textarea
                    value={pasteBundle}
                    onChange={(e) => setPasteBundle(e.target.value)}
                    placeholder="Or paste join bundle…"
                    rows={3}
                    style={{
                      width: '100%',
                      marginBottom: 12,
                      padding: 10,
                      borderRadius: 12,
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: 'rgba(255,255,255,0.85)',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 11,
                    }}
                  />
                  <button
                    type="button"
                    disabled={
                      starting ||
                      (!pasteBundle.trim() && !isValidJoinCodeInput(joinCodeInput))
                    }
                    onClick={() => void handleJoinMission()}
                    style={{
                      width: '100%',
                      padding: '14px 20px',
                      borderRadius: 12,
                      border: 'none',
                      background: 'rgba(0, 122, 255, 0.9)',
                      color: 'white',
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: 'pointer',
                      opacity: starting ? 0.7 : 1,
                    }}
                  >
                    {starting || mission.joinCodeSearching ? 'Connecting…' : 'Join Mission'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes sheetEnter {
          from {
            opacity: 0;
            transform: translateY(100%);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
