import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAppContext } from './AppContext'
import { useGPS } from '../hooks/useGPS'
import { useTravelSpeed } from '../hooks/useTravelSpeed'
import {
  installFieldWakeLockRecovery,
  setFieldWakeLockActive,
  subscribeFieldWakeLock,
} from '../runtime/fieldWakeLock'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { decodeMissionPacket, packetFitsCompactQr } from '../lib/missionSync/codec'
import {
  MissionSyncCoordinator,
  createMissionIds,
} from '../lib/missionSync/coordinator'
import {
  mergeMissionWaypoints,
  peerSnapshotStateFrom,
  reconcilePeerSnapshotRemovals,
  type PeerSnapshotState,
} from '../lib/missionSync/merge'
import { WAYPOINT_REMOVED_EVENT } from '../lib/missionSync/waypointSyncEvents'
import { filterTeammatePresence } from '../lib/missionSync/presence'
import {
  applyMissionCorridorHint,
  buildMissionCorridorHint,
  shouldApplyCorridorHint,
} from '../lib/missionSync/corridorHint'
import { getCorridorOfflineSummary } from '../lib/corridorPrefetch'
import { loadMissionSession, loadOrCreateDeviceId, saveMissionSession } from '../lib/missionSync/persist'
import { sanitizeWaypointsForSync } from '../lib/missionSync/sanitize'
import {
  BURST_MIN_INTERVAL_MS,
  CHECKIN_MIN_INTERVAL_MS,
  buildBurst,
  buildCheckIn,
  filterRecentBursts,
  filterFreshCheckIns,
} from '../lib/missionSync/comms'
import { playTeamCommsChirp } from '../lib/missionSync/teamCommsChirp'
import { buildStabilizedTeamPresence } from '../lib/missionSync/presencePublish'
import {
  speakInboundTeamMessage,
  speakMissionCommsPhrase,
} from '../lib/missionSync/missionVoiceMessage'
import {
  createIdleMissionCommsFlow,
  matchInboundHearConfirm,
  reduceMissionCommsFlow,
  type MissionCommsFlowState,
} from '../lib/missionSync/missionCommsVoiceFlow'
import { setMissionCommsVoiceHandler } from '../lib/missionSync/missionCommsVoiceBridge'
import {
  loadMissionCommsPrefs,
  saveMissionCommsPrefs,
  type MissionCommsPrefs,
} from '../lib/missionSync/missionCommsPrefs'
import { emitHaptic } from '../runtime/haptics'
import {
  burstTargetsLocalDevice,
  formatBurstLine,
  formatBurstTargetLabel,
  resolveMissionPeerByCallsign,
  type TeamBurstTarget,
} from '../lib/missionSync/teamComms'
import {
  playVoiceClip,
  voiceClipTargetsLocalDevice,
} from '../lib/missionSync/teamVoiceClip'
import type {
  ConnectedPeer,
  MissionAnswerPacket,
  MissionBurst,
  MissionVoiceClip,
  MissionCheckIn,
  MissionOfferPacket,
  MissionCorridorHint,
  MissionSnapshot,
  MissionSyncConnectionPhase,
  MissionSyncRole,
  TeamPresence,
} from '../lib/missionSync/types'
import { getBluetoothMeshCapability } from '../lib/missionSync/bluetooth'
import {
  joinCodeFromToken,
  joinCodesMatch,
  formatJoinCode,
  isValidJoinCodeInput,
  normalizeJoinCodeInput,
} from '../lib/missionSync/joinCode'
import {
  isJoinCodeSignalingAvailable,
  joinCodeSignalingHint,
  publishJoinCodeAnswerWithRetry,
} from '../lib/missionSync/missionJoinSignaling'
import { MissionJoinCodeChannel } from '../lib/missionSync/missionJoinCodeChannel'
import {
  getNativeLinkPlatform,
  nativeAdvertisePayload,
  nativeDiscoverMission,
  nativeSendNearbyPayload,
  nativeSendPayloadToHost,
  nativeStopAdvertise,
  nativeStopDiscovery,
  onNativePayload,
  wireNativePayloadBridge,
  type NativeLinkPlatform,
} from '../lib/missionSync/nativeLink'
import {
  type MissionSignalingTransport,
  shouldPreferTransport,
  transportLabel,
} from '../lib/missionSync/missionLinkTransport'
import { isObserverOffer, answerLinkRole } from '../lib/missionSync/linkRole'
import {
  isObserverSignalingAvailable,
  publishObserverSignal,
  ObserverMonitorChannel,
} from '../lib/missionSync/observerSignaling'
import {
  buildWatchMeInviteText,
  buildWatchMeUrl,
} from '../lib/missionSync/monitorInviteUrl'
import { SyncWireDedupe } from '../lib/missionSync/wireDedupe'
import type { SyncWireMessage } from '../lib/missionSync/types'
import { isMissionTurnConfigured, MISSION_TURN_SETUP_HINT } from '../lib/missionSync/turnConfig'
import { copyMissionBundle, shareMissionBundle } from '../lib/missionSync/shareBundle'
import { isMissionSyncSupported } from '../lib/missionSync/webrtc'
import {
  evaluateRelayLinkState,
  isRelayFresh,
  LINK_RECOVERY_TIMEOUT_MS,
  resolveLinkRecoveryTimeout,
  resolvePeerDisconnectRecovery,
  type RelayLinkState,
} from '../lib/missionSync/relayRecovery'
import {
  evaluateMissionRestore,
  missionRestoreGuidance,
} from '../lib/missionSync/missionRestoreContract'
import { recordMissionOperationalEvent } from '../lib/missionSync/operationalTelemetry'
import { isFieldSessionBackgrounded } from '../runtime/fieldLifecycle'
import {
  computeFilteredTeamComms,
  computeMissionRelayFlags,
  computeMissionQrFitFlags,
  computeMonitorLive,
  computeMonitoredPresence,
  computeObserverCount,
  computeTeamCommsReady,
} from '../lib/missionSync/missionSyncDerived'
import { captureMonitorJoinFromLocation } from '../lib/missionSync/pendingMonitorJoin'
import MonitorJoinBootstrap from '../hud/MonitorJoinBootstrap'

if (typeof window !== 'undefined') {
  captureMonitorJoinFromLocation(window.location.search)
}

export type MissionSyncNotice = {
  level: 'info' | 'success' | 'warn'
  message: string
  at: number
}

export type MissionMeshCorridorStatus = 'idle' | 'team-hint' | 'prefetching' | 'ready'

export type MissionMonitorTransport = 'idle' | 'direct' | 'relay' | 'both'

export type MissionSyncContextValue = {
  supported: boolean
  role: MissionSyncRole
  phase: MissionSyncConnectionPhase
  missionId: string | null
  missionName: string
  deviceId: string
  callsign: string
  peers: ConnectedPeer[]
  teamPresence: TeamPresence[]
  autoApply: boolean
  setAutoApply: (v: boolean) => void
  lastSyncAt: number | null
  lastNotice: MissionSyncNotice | null
  pendingOfferEncoded: string | null
  pendingAnswerEncoded: string | null
  pendingOfferFitsQr: boolean
  pendingAnswerFitsQr: boolean
  bluetoothNote: string
  joinCode: string | null
  nativeLink: NativeLinkPlatform
  /** Wi‑Fi mission code works in browser when Supabase signaling is configured. */
  joinCodeSignalingAvailable: boolean
  /** Active bundle-exchange path (Wi‑Fi LAN vs Nearby vs manual). */
  signalingTransport: MissionSignalingTransport
  signalingLabel: string
  teamCorridorStatus: MissionMeshCorridorStatus
  reconnectMesh: () => Promise<void>
  teamCheckIns: MissionCheckIn[]
  teamBursts: MissionBurst[]
  /** True when mesh or monitor relay can carry team text (works offline on LAN). */
  teamCommsReady: boolean
  /** True while mesh dropped and system is attempting mesh or relay recovery. */
  linkRecoveryPending: boolean
  /** Internet relay health when local mesh peers are absent. */
  relayLinkState: RelayLinkState
  /** Latest inbound burst for HUD toast (directed messages prioritized). */
  lastInboundTeamBurst: MissionBurst | null
  dismissTeamCommsAlert: () => void
  /** Set when user taps a teammate on the map (opens quick message sheet). */
  activeCommsTarget: { deviceId: string; callsign: string } | null
  openCommsForTeammate: (deviceId: string, callsign: string) => void
  clearActiveCommsTarget: () => void
  sendTeamCheckIn: (note?: string) => void
  sendTeamBurst: (text: string, toCallsign?: string) => boolean
  /** True after host shares live map link this mission (controls watcher pill). */
  watchLinkShared: boolean
  missionCommsPrefs: MissionCommsPrefs
  setMissionCommsPrefs: (patch: Partial<MissionCommsPrefs>) => void
  /** Hands-free flow phase for UI status. */
  missionCommsFlowPhase: MissionCommsFlowState['phase']
  /** Inbound message waiting for accept-before-TTS. */
  pendingInboundBurst: MissionBurst | null
  confirmInboundMessage: () => void
  skipInboundMessage: () => void
  /** Outbound message waiting for accept (voice or tap). */
  pendingOutboundConfirm: { label: string; callsign?: string; body: string } | null
  confirmOutboundMessage: () => boolean
  cancelOutboundMessage: () => void
  /** Voice-only: queue send after accept (typed UI sends immediately). */
  queueOutboundConfirm: (body: string, toCallsign?: string) => void
  /** Start hands-free "who / what / accept" flow. */
  startTeamMessageFlow: () => void
  /** Start flow addressed to one callsign or whole mission. */
  startTeamMessageTo: (toCallsign?: string) => void
  /** True while browser code-room join is active (request-offer pings). */
  joinCodeSearching: boolean
  discoverMissionOnLan: (codeInput: string) => Promise<boolean>
  /** Join from encoded offer; returns answer bundle when successful. */
  joinMissionFromOffer: (encodedOffer: string) => Promise<string | null>
  startMission: (name: string) => Promise<void>
  /** @deprecated use startMission */
  startHostMission: (name: string) => Promise<void>
  createJoinOffer: () => Promise<void>
  applyJoinAnswer: (encoded: string) => Promise<void>
  /** @deprecated use applyJoinAnswer */
  applyJoinerAnswer: (encoded: string) => Promise<void>
  startJoinMission: (encodedOffer: string) => Promise<void>
  endMission: () => void
  pushSnapshotNow: () => void
  /** Remote read-only monitor — separate token from field join code. */
  observerToken: string | null
  observerCount: number
  pendingObserverOfferEncoded: string | null
  pendingObserverOfferFitsQr: boolean
  observerSignalingAvailable: boolean
  createObserverInvite: () => Promise<void>
  monitorMissionFromOffer: (encodedOffer: string) => Promise<string | null>
  /** Wait on internet signaling for field lead to create monitor link (token from text). */
  monitorMissionFromToken: (missionId: string, observerToken: string, missionName?: string) => Promise<void>
  monitorTransport: MissionMonitorTransport
  /** True when observer is receiving fresh mission data (map + HUD). */
  monitorLive: boolean
  /** Field operator being watched — for map follow + panel readout. */
  monitoredPresence: TeamPresence | null
  monitorTargetCallsign: string
  shareMonitorInvite: () => Promise<void>
  applyObserverAnswer: (encoded: string) => Promise<void>
  endMonitor: () => void
  dismissNotice: () => void
}

const MissionSyncContext = createContext<MissionSyncContextValue | null>(null)

const PRESENCE_INTERVAL_MS = 8_000
const PRESENCE_GPS_DEBOUNCE_MS = 4_000
const SNAPSHOT_DEBOUNCE_MS = 1800
const CORRIDOR_HINT_DEBOUNCE_MS = 4_000

export function MissionSyncProvider({ children }: { children: ReactNode }) {
  const { state, setWaypoints, setSnapToTrail } = useAppContext()
  const gps = useGPS()
  const travelSpeed = useTravelSpeed(gps.lat, gps.lng, gps.locationState === 'granted', gps.accuracy)
  const { profile } = useTacticalProfile()
  const waypoints = state.waypoints
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints
  const snapToTrailEnabled = state.snapToTrailEnabled

  const [role, setRole] = useState<MissionSyncRole>('idle')
  const [phase, setPhase] = useState<MissionSyncConnectionPhase>('idle')
  const [missionId, setMissionId] = useState<string | null>(null)
  const [missionName, setMissionName] = useState('Field mission')
  const [peers, setPeers] = useState<ConnectedPeer[]>([])
  const [teamPresence, setTeamPresence] = useState<TeamPresence[]>([])
  const [autoApply, setAutoApply] = useState(true)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [lastNotice, setLastNotice] = useState<MissionSyncNotice | null>(null)
  const [pendingOfferEncoded, setPendingOfferEncoded] = useState<string | null>(null)
  const [pendingAnswerEncoded, setPendingAnswerEncoded] = useState<string | null>(null)
  const [teamCheckIns, setTeamCheckIns] = useState<MissionCheckIn[]>([])
  const [teamBursts, setTeamBursts] = useState<MissionBurst[]>([])
  const [lastInboundTeamBurst, setLastInboundTeamBurst] = useState<MissionBurst | null>(null)
  const [activeCommsTarget, setActiveCommsTarget] = useState<{
    deviceId: string
    callsign: string
  } | null>(null)
  const [nativeLink, setNativeLink] = useState<NativeLinkPlatform>({
    available: false,
    platform: 'web',
    discoveryMethod: 'none',
  })
  const [missionJoinToken, setMissionJoinToken] = useState('')
  const [observerTokenState, setObserverTokenState] = useState('')
  const [signalingTransport, setSignalingTransport] = useState<MissionSignalingTransport>('idle')
  const [teamCorridorStatus, setTeamCorridorStatus] = useState<MissionMeshCorridorStatus>('idle')
  const [pendingObserverOfferEncoded, setPendingObserverOfferEncoded] = useState<string | null>(null)
  const [monitorTransport, setMonitorTransport] = useState<MissionMonitorTransport>('idle')
  const [linkRecoveryPending, setLinkRecoveryPending] = useState(false)
  const [relayLinkState, setRelayLinkState] = useState<RelayLinkState>('active')
  const [monitorHostDeviceId, setMonitorHostDeviceId] = useState<string | null>(null)
  const [monitorTargetCallsign, setMonitorTargetCallsign] = useState('Operator')

  const deviceId = useMemo(() => loadOrCreateDeviceId(), [])
  const signalingLabel = transportLabel(signalingTransport)
  const callsign = profile.display_name.trim() || 'Operator'
  const coordinatorRef = useRef<MissionSyncCoordinator | null>(null)
  const joinTokenRef = useRef('')
  const observerTokenRef = useRef('')
  const joinCode = missionJoinToken ? joinCodeFromToken(missionJoinToken) : null
  const observerToken = observerTokenState || null

  const setJoinToken = useCallback((token: string) => {
    joinTokenRef.current = token
    setMissionJoinToken(token)
  }, [])

  const setObserverToken = useCallback((token: string) => {
    observerTokenRef.current = token
    setObserverTokenState(token)
  }, [])
  const revisionRef = useRef(0)
  const applyingRemoteRef = useRef(false)
  const snapshotTimerRef = useRef<number | null>(null)
  const corridorTimerRef = useRef<number | null>(null)
  const sessionCoordinatorReadyRef = useRef(false)
  const lastCheckInAtRef = useRef(0)
  const lastBurstAtRef = useRef(0)
  const lastPublishedPresenceRef = useRef<TeamPresence | null>(null)
  const [watchLinkShared, setWatchLinkShared] = useState(false)
  const [missionCommsPrefs, setMissionCommsPrefsState] = useState<MissionCommsPrefs>(() =>
    loadMissionCommsPrefs(),
  )
  const [pendingInboundBurst, setPendingInboundBurst] = useState<MissionBurst | null>(null)
  const [pendingOutboundConfirm, setPendingOutboundConfirm] = useState<{
    label: string
    callsign?: string
    body: string
  } | null>(null)
  const missionCommsFlowRef = useRef<MissionCommsFlowState>(createIdleMissionCommsFlow())
  const [missionCommsFlowPhase, setMissionCommsFlowPhase] = useState<MissionCommsFlowState['phase']>('idle')
  const lastNativePayloadRef = useRef('')
  const teamPresenceRef = useRef<TeamPresence[]>([])
  teamPresenceRef.current = teamPresence
  const observerSignalUnsubRef = useRef<(() => void) | null>(null)
  const joinCodeHostRoomRef = useRef<{ normalized: string; channel: MissionJoinCodeChannel } | null>(
    null,
  )
  const joinCodeDiscoverRoomRef = useRef<{ normalized: string; channel: MissionJoinCodeChannel } | null>(
    null,
  )
  const joinCodeDiscoverPingRef = useRef<number | null>(null)
  const joinCodeDiscoverTimeoutRef = useRef<number | null>(null)
  const joinCodeDiscoveringRef = useRef(false)
  const [joinCodeSearching, setJoinCodeSearching] = useState(false)
  const joinCodeJoinInFlightRef = useRef(false)
  const lastJoinCodeOfferRef = useRef('')
  const lastJoinCodeInputRef = useRef('')
  const locallySuppressedWaypointIdsRef = useRef<Set<string>>(new Set())
  const peerSnapshotStateRef = useRef<Map<string, PeerSnapshotState>>(new Map())
  const prevWaypointIdsRef = useRef<Set<string>>(new Set())
  const pendingMeshPushAfterDeleteRef = useRef(false)
  const pendingOfferEncodedRef = useRef<string | null>(null)
  const applyJoinAnswerRef = useRef<(encoded: string) => Promise<void>>(async () => {})
  const createJoinOfferRef = useRef<() => Promise<void>>(async () => {})
  const observerChannelRef = useRef<ObserverMonitorChannel | null>(null)
  const waitingForMonitorOfferRef = useRef(false)
  const relayDedupeRef = useRef(new SyncWireDedupe())
  const relayLastAtRef = useRef(0)
  const linkRecoveryTimerRef = useRef<number | null>(null)
  const prevWakeHeldRef = useRef(false)

  const isFieldMember = role === 'member'
  const isObserver = role === 'observer'
  const observerSignalingAvailable = isObserverSignalingAvailable()
  const { missionRelayActive, monitorRelayActive } = useMemo(
    () =>
      computeMissionRelayFlags({
        missionId,
        observerToken: observerTokenState,
        observerSignalingAvailable,
        role,
      }),
    [missionId, observerTokenState, observerSignalingAvailable, role],
  )
  const observerCount = useMemo(() => computeObserverCount(peers), [peers])
  const monitorLive = useMemo(
    () =>
      computeMonitorLive({
        role,
        phase,
        peerCount: peers.length,
        monitorTransport,
        lastSyncAt,
      }),
    [role, phase, peers.length, monitorTransport, lastSyncAt],
  )
  const monitoredPresence = useMemo(
    () => computeMonitoredPresence(teamPresence, deviceId, monitorHostDeviceId),
    [teamPresence, deviceId, monitorHostDeviceId],
  )
  const joinCodeSignalingAvailable = useMemo(() => isJoinCodeSignalingAvailable(), [])
  const filteredTeamComms = useMemo(
    () => computeFilteredTeamComms(teamCheckIns, teamBursts),
    [teamCheckIns, teamBursts],
  )
  const qrFitFlags = useMemo(
    () =>
      computeMissionQrFitFlags({
        pendingOfferEncoded,
        pendingAnswerEncoded,
        pendingObserverOfferEncoded,
      }),
    [pendingOfferEncoded, pendingAnswerEncoded, pendingObserverOfferEncoded],
  )

  const supported = isMissionSyncSupported()
  const bluetoothNote = getBluetoothMeshCapability().reason

  const notify = useCallback((level: MissionSyncNotice['level'], message: string) => {
    setLastNotice({ level, message, at: Date.now() })
  }, [])

  const clearLinkRecoveryTimer = useCallback(() => {
    if (linkRecoveryTimerRef.current != null) {
      window.clearTimeout(linkRecoveryTimerRef.current)
      linkRecoveryTimerRef.current = null
    }
  }, [])

  const completeLinkRecovery = useCallback(
    (mode?: 'mesh' | 'relay') => {
      clearLinkRecoveryTimer()
      setLinkRecoveryPending(false)
      setRelayLinkState('active')
      if (mode === 'mesh') recordMissionOperationalEvent('link_recovery_complete_mesh')
      else if (mode === 'relay') recordMissionOperationalEvent('link_recovery_complete_relay')
    },
    [clearLinkRecoveryTimer],
  )

  const beginLinkRecovery = useCallback(() => {
    setLinkRecoveryPending(true)
    recordMissionOperationalEvent('link_recovery_start')
  }, [])

  const waypointsForSync = useCallback((): typeof waypoints => {
    const suppressed = locallySuppressedWaypointIdsRef.current
    return waypointsRef.current.filter((w) => !suppressed.has(w.id))
  }, [])

  const buildSnapshot = useCallback((): MissionSnapshot | null => {
    if (!missionId) return null
    revisionRef.current += 1
    return {
      missionId,
      missionName,
      revision: revisionRef.current,
      updatedAt: Date.now(),
      hostDeviceId: coordinatorRef.current?.hostDeviceId ?? deviceId,
      sourceDeviceId: deviceId,
      sourceCallsign: callsign,
      waypoints: sanitizeWaypointsForSync(waypointsForSync()),
      snapToTrailEnabled,
    }
  }, [missionId, missionName, deviceId, callsign, waypointsForSync, snapToTrailEnabled])

  const refreshCorridorStatus = useCallback(() => {
    const summary = getCorridorOfflineSummary()
    setTeamCorridorStatus(summary.ready ? 'ready' : summary.updatedAt != null ? 'team-hint' : 'idle')
  }, [])

  const pushCorridorHintNow = useCallback(() => {
    const coord = coordinatorRef.current
    if (!coord || !missionId) return
    if (coord.peerCount === 0 && !monitorRelayActive) return
    const hint = buildMissionCorridorHint({
      missionId,
      sourceDeviceId: deviceId,
      sourceCallsign: callsign,
      waypoints,
    })
    if (!hint) return
    coord.sendCorridorHint(hint)
  }, [missionId, deviceId, callsign, waypoints, monitorRelayActive])

  const scheduleCorridorHint = useCallback(() => {
    if (corridorTimerRef.current != null) window.clearTimeout(corridorTimerRef.current)
    corridorTimerRef.current = window.setTimeout(() => {
      corridorTimerRef.current = null
      if (applyingRemoteRef.current) return
      if ((coordinatorRef.current?.peerCount ?? 0) === 0 && !monitorRelayActive) return
      pushCorridorHintNow()
    }, CORRIDOR_HINT_DEBOUNCE_MS)
  }, [pushCorridorHintNow, monitorRelayActive])

  const handleRemoteCorridorHint = useCallback(
    (hint: MissionCorridorHint) => {
      if (!shouldApplyCorridorHint(hint, missionId)) return
      setTeamCorridorStatus('prefetching')
      void applyMissionCorridorHint(hint).then(({ applied, tilesAdded }) => {
        refreshCorridorStatus()
        if (!applied) return
        if (tilesAdded > 0) {
          notify('success', `Map corridor warmed from ${hint.sourceCallsign} (+${tilesAdded} tiles)`)
        } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
          notify('info', `Corridor bounds saved from ${hint.sourceCallsign} — prefetch when online`)
          setTeamCorridorStatus('team-hint')
        }
      })
    },
    [missionId, notify, refreshCorridorStatus],
  )

  const applyRemoteSnapshot = useCallback(
    (snapshot: MissionSnapshot, fromPeerId: string) => {
      if (snapshot.missionId !== missionId) return
      void fromPeerId
      if (snapshot.missionName && snapshot.missionName !== missionName) {
        setMissionName(snapshot.missionName)
      }
      const prevPeer = peerSnapshotStateRef.current.get(snapshot.sourceDeviceId) ?? null
      const { local: afterRemoval, removed: peerRemoved } = reconcilePeerSnapshotRemovals(
        waypoints,
        snapshot,
        prevPeer,
      )
      const { merged, added, updated, archived } = mergeMissionWaypoints(
        afterRemoval,
        snapshot.waypoints,
        { suppressedIds: locallySuppressedWaypointIdsRef.current },
      )
      peerSnapshotStateRef.current.set(snapshot.sourceDeviceId, peerSnapshotStateFrom(snapshot))
      for (const wp of snapshot.waypoints) {
        if (wp.status === 'archived') locallySuppressedWaypointIdsRef.current.add(wp.id)
      }
      const wpChanged = added > 0 || updated > 0 || archived > 0 || peerRemoved > 0
      const snapChanged =
        snapshot.snapToTrailEnabled !== undefined &&
        snapshot.snapToTrailEnabled !== snapToTrailEnabled
      if (!wpChanged && !snapChanged) return

      applyingRemoteRef.current = true
      try {
        if (autoApply) {
          if (wpChanged) {
            const suppressed = locallySuppressedWaypointIdsRef.current
            setWaypoints(merged.filter((w) => !suppressed.has(w.id)))
          }
          if (snapChanged && snapshot.snapToTrailEnabled !== undefined) {
            setSnapToTrail(snapshot.snapToTrailEnabled)
          }
          setLastSyncAt(Date.now())
          const parts: string[] = []
          if (added > 0) parts.push(`+${added} new`)
          if (updated > 0) parts.push(`${updated} updated`)
          if (archived > 0) parts.push(`${archived} archived`)
          if (peerRemoved > 0) parts.push(`${peerRemoved} removed`)
          if (snapChanged) parts.push('trail mode synced')
          notify('success', `Team sync from ${snapshot.sourceCallsign}: ${parts.join(', ')}`)
        } else if (wpChanged) {
          notify(
            'info',
            `Team update (${added} new, ${updated} updated, ${archived} archived) — enable auto-apply`,
          )
        }
      } finally {
        window.setTimeout(() => {
          applyingRemoteRef.current = false
        }, 0)
      }
    },
    [
      missionId,
      missionName,
      waypoints,
      snapToTrailEnabled,
      autoApply,
      setWaypoints,
      setSnapToTrail,
      notify,
    ],
  )

  const pushSnapshotNow = useCallback(() => {
    const coord = coordinatorRef.current
    const snapshot = buildSnapshot()
    if (!coord || !snapshot || !coord.canPublish) return
    coord.sendSnapshot(snapshot)
    setLastSyncAt(Date.now())
  }, [buildSnapshot])

  const ingestInboundBurst = useCallback(
    (burst: MissionBurst) => {
      if (burst.deviceId === deviceId) return
      setTeamBursts((prev) => filterRecentBursts([...prev, burst]))
      const directed = Boolean(burst.toDeviceId)
      const forMe = burstTargetsLocalDevice(burst, deviceId)
      const watching = role === 'observer'
      const arrow = formatBurstTargetLabel(burst)
      const line = formatBurstLine(burst, deviceId)
      const shouldAlert = forMe || watching || !directed
      if (shouldAlert) {
        playTeamCommsChirp(directed)
        emitHaptic('teamMessage')
        setLastInboundTeamBurst(burst)
        if (missionCommsPrefs.inboundConfirm) {
          setPendingInboundBurst(burst)
          notify(forMe ? 'success' : 'info', `Message from ${burst.callsign} — say accept to listen`)
          void speakMissionCommsPhrase(
            `Message from ${burst.callsign}. Say accept to listen, or skip.`,
          )
        } else {
          notify(forMe ? 'success' : 'info', directed ? `Team message ${arrow ?? ''}: ${burst.text}`.trim() : line)
          void speakInboundTeamMessage(burst.callsign, burst.text)
        }
        return
      }
      if (!directed) notify('info', line)
    },
    [deviceId, notify, role, missionCommsPrefs.inboundConfirm],
  )

  const ingestInboundVoiceClip = useCallback(
    (clip: MissionVoiceClip) => {
      if (clip.deviceId === deviceId) return
      const forMe = voiceClipTargetsLocalDevice(clip, deviceId)
      const watching = role === 'observer'
      const who = clip.callsign
      const dur = `${Math.max(1, Math.round(clip.durationMs / 1000))}s`
      if (forMe || watching || !clip.toDeviceId) {
        playTeamCommsChirp(true)
        playVoiceClip(clip)
        notify('success', `Voice from ${who} (${dur})`)
      } else if (!clip.toDeviceId) {
        notify('info', `Voice from ${who} (${dur})`)
      }
    },
    [deviceId, notify, role],
  )

  const dismissTeamCommsAlert = useCallback(() => setLastInboundTeamBurst(null), [])

  const confirmInboundMessage = useCallback(() => {
    const b = pendingInboundBurst
    if (!b) return
    setPendingInboundBurst(null)
    void speakInboundTeamMessage(b.callsign, b.text)
  }, [pendingInboundBurst])

  const skipInboundMessage = useCallback(() => {
    setPendingInboundBurst(null)
    void speakMissionCommsPhrase('Skipped.')
  }, [])

  const setMissionCommsPrefs = useCallback((patch: Partial<MissionCommsPrefs>) => {
    setMissionCommsPrefsState((prev) => saveMissionCommsPrefs({ ...prev, ...patch }))
  }, [])

  const syncOutboundFlowState = useCallback((flow: MissionCommsFlowState) => {
    missionCommsFlowRef.current = flow
    setMissionCommsFlowPhase(flow.phase)
    if (flow.phase === 'confirm_send' && flow.target && flow.body) {
      setPendingOutboundConfirm({
        label: flow.target.label,
        callsign: flow.target.callsign,
        body: flow.body,
      })
    } else {
      setPendingOutboundConfirm(null)
    }
  }, [])

  const clearOutboundFlow = useCallback(() => {
    syncOutboundFlowState(createIdleMissionCommsFlow())
  }, [syncOutboundFlowState])

  const queueOutboundConfirm = useCallback(
    (body: string, toCallsign?: string) => {
      const linked = coordinatorRef.current?.connectedPeers ?? peers
      let target: { label: string; callsign?: string } = { label: 'whole mission' }
      const trimmed = toCallsign?.trim()
      if (trimmed) {
        const peer = resolveMissionPeerByCallsign(linked, trimmed)
        if (!peer) {
          void speakMissionCommsPhrase(`No linked member matches ${trimmed}.`)
          return
        }
        target = { label: peer.callsign, callsign: peer.callsign }
      }
      const clean = body.trim()
      if (!clean) return
      syncOutboundFlowState({
        phase: 'confirm_send',
        target,
        body: clean,
      })
      void speakMissionCommsPhrase(
        `Send to ${target.label}: ${clean}. Say accept or cancel.`,
      )
    },
    [peers, syncOutboundFlowState],
  )

  const openCommsForTeammate = useCallback((deviceId: string, callsign: string) => {
    const clean = callsign.trim() || 'Teammate'
    setActiveCommsTarget({ deviceId, callsign: clean })
  }, [])

  const clearActiveCommsTarget = useCallback(() => setActiveCommsTarget(null), [])

  const teamCommsReady = useMemo(
    () =>
      computeTeamCommsReady({
        role,
        peerCount: coordinatorRef.current?.peerCount ?? peers.length,
        missionRelayActive,
        monitorRelayActive,
      }),
    [role, peers.length, missionRelayActive, monitorRelayActive],
  )

  const handleRelayWire = useCallback(
    (msg: SyncWireMessage) => {
      if (!relayDedupeRef.current.accept(msg)) return
      relayLastAtRef.current = Date.now()
      setMonitorTransport((prev) => {
        const hasDirect = (coordinatorRef.current?.peerCount ?? 0) > 0
        if (hasDirect && prev !== 'both') return 'both'
        if (!hasDirect) return 'relay'
        return prev
      })
      setPhase((prev) =>
        prev === 'failed' || prev === 'connecting' || prev === 'awaiting-host-answer'
          ? 'connected'
          : prev,
      )
      if (msg.type === 'snapshot') applyRemoteSnapshot(msg.payload, 'relay')
      if (msg.type === 'presence') {
        if (isObserver && msg.payload.callsign) {
          setMonitorTargetCallsign(msg.payload.callsign)
          setMonitorHostDeviceId((prev) => prev ?? msg.payload.deviceId)
        }
        setTeamPresence((prev) => {
          const next = prev.filter((x) => x.deviceId !== msg.payload.deviceId)
          next.push(msg.payload)
          return next.slice(-12)
        })
      }
      if (msg.type === 'checkin' && msg.payload.deviceId !== deviceId) {
        setTeamCheckIns((prev) => filterFreshCheckIns([...prev, msg.payload]))
        notify('info', `${msg.payload.callsign} check-in OK${msg.payload.note ? `: ${msg.payload.note}` : ''}`)
      }
      if (msg.type === 'burst') ingestInboundBurst(msg.payload)
      if (msg.type === 'voice-clip') ingestInboundVoiceClip(msg.payload)
      if (msg.type === 'corridor-hint') handleRemoteCorridorHint(msg.payload)
      setLastSyncAt(Date.now())
      completeLinkRecovery('relay')
    },
    [applyRemoteSnapshot, deviceId, handleRemoteCorridorHint, isObserver, ingestInboundBurst, completeLinkRecovery],
  )

  const attachFieldMonitorRelay = useCallback(
    (coord: MissionSyncCoordinator) => {
      if (!monitorRelayActive || !missionId || !observerTokenRef.current) {
        coord.setOutboundRelay(undefined)
        return
      }
      coord.setOutboundRelay((wire) => {
        void observerChannelRef.current?.publishRelay(wire, deviceId)
      })
    },
    [monitorRelayActive, missionId, deviceId],
  )

  const scheduleSnapshotBroadcast = useCallback(() => {
    if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
    snapshotTimerRef.current = window.setTimeout(() => {
      snapshotTimerRef.current = null
      if (applyingRemoteRef.current) return
      if (peers.length === 0 && !monitorRelayActive) return
      pushSnapshotNow()
    }, SNAPSHOT_DEBOUNCE_MS)
  }, [peers.length, monitorRelayActive, pushSnapshotNow])

  const wireCoordinator = useCallback(
    (coord: MissionSyncCoordinator) => {
      coordinatorRef.current = coord
      attachFieldMonitorRelay(coord)
      coord.setCallbacks({
        onPeerConnected: (peer) => {
          completeLinkRecovery('mesh')
          setPeers(coord.connectedPeers)
          setPhase('connected')
          if (peer.linkRole === 'observer') {
            setMonitorTransport((prev) => (prev === 'relay' ? 'both' : 'direct'))
            const name = peer.callsign?.trim() || 'Watcher'
            notify('success', `${name} is watching your live map`)
            const snap = buildSnapshot()
            if (snap) coord.sendSnapshotToPeer(peer.peerId, snap)
            for (const p of teamPresenceRef.current) {
              coord.sendPresenceToPeer(peer.peerId, p)
            }
            const hint = buildMissionCorridorHint({
              missionId: missionId ?? snap?.missionId ?? '',
              sourceDeviceId: deviceId,
              sourceCallsign: callsign,
              waypoints,
            })
            if (hint) coord.sendCorridorHintToPeer(peer.peerId, hint)
          } else {
            notify('success', `${peer.callsign} linked`)
          }
          pushSnapshotNow()
          pushCorridorHintNow()
        },
        onPeerDisconnected: () => {
          const prevObserverCount = peers.filter((p) => p.linkRole === 'observer').length
          setPeers(coord.connectedPeers)
          const nextObserverCount = coord.connectedPeers.filter(
            (p) => p.linkRole === 'observer',
          ).length
          if (isFieldMember && prevObserverCount > nextObserverCount) {
            notify('info', 'Watcher disconnected — they can reopen your live map link')
          }
          if (coord.peerCount === 0 && missionId) {
            const recovery = resolvePeerDisconnectRecovery({
              isObserver,
              isFieldMember,
              relayLastAtMs: relayLastAtRef.current,
              missionRelayActive,
              observerSignalingAvailable,
            })
            if (recovery.monitorTransport) setMonitorTransport(recovery.monitorTransport)
            setPhase(recovery.phase)
            if (recovery.linkRecoveryPending) beginLinkRecovery()
            else completeLinkRecovery(recovery.monitorTransport === 'relay' ? 'relay' : undefined)
            if (recovery.notifyLevel && recovery.notifyMessage) {
              notify(recovery.notifyLevel, recovery.notifyMessage)
            }
          }
          if (coord.peerCount === 0 && !isObserver) setMonitorTransport('idle')
        },
        onSnapshot: (snap, fromPeer) => applyRemoteSnapshot(snap, fromPeer),
        onPresence: (p) => {
          setTeamPresence((prev) => {
            const next = prev.filter((x) => x.deviceId !== p.deviceId)
            next.push(p)
            return next.slice(-12)
          })
        },
        onCheckIn: (c) => {
          if (c.deviceId === deviceId) return
          setTeamCheckIns((prev) => filterFreshCheckIns([...prev, c]))
          notify('info', `${c.callsign} check-in OK${c.note ? `: ${c.note}` : ''}`)
        },
        onBurst: (b) => ingestInboundBurst(b),
        onVoiceClip: (clip) => ingestInboundVoiceClip(clip),
        onCorridorHint: (hint) => handleRemoteCorridorHint(hint),
        onError: (msg) => {
          if (msg.includes('disconnected') || msg.includes('peer-disconnected')) {
            beginLinkRecovery()
            notify('warn', 'Link blip — mission stays active, reconnecting mesh…')
            return
          }
          if (
            (msg.includes('failed') || msg.includes('ice')) &&
            (coordinatorRef.current?.role === 'observer' ||
              (isFieldMember && missionRelayActive))
          ) {
            if (isRelayFresh(relayLastAtRef.current) || observerSignalingAvailable) {
              if (coordinatorRef.current?.role === 'observer') {
                setMonitorTransport((prev) => (prev === 'direct' ? 'relay' : prev))
              }
              setPhase('connected')
              completeLinkRecovery('relay')
              notify(
                'info',
                coordinatorRef.current?.role === 'observer'
                  ? 'Direct monitor link dropped — still receiving updates over internet relay.'
                  : 'Direct teammate link dropped — mission stays on internet relay when online.',
              )
              return
            }
            if (coordinatorRef.current?.role === 'observer') {
              setPhase('failed')
              notify(
                'warn',
                'Monitor link failed — check cell/Wi‑Fi, or ask field lead to resend monitor bundle.',
              )
              return
            }
          }
          setPhase('failed')
          notify('warn', msg)
        },
      })
    },
    [
      applyRemoteSnapshot,
      notify,
      pushSnapshotNow,
      pushCorridorHintNow,
      handleRemoteCorridorHint,
      missionId,
      deviceId,
      callsign,
      waypoints,
      buildSnapshot,
      attachFieldMonitorRelay,
      isObserver,
      isFieldMember,
      missionRelayActive,
      observerSignalingAvailable,
      peers,
      ingestInboundBurst,
      ingestInboundVoiceClip,
      beginLinkRecovery,
      completeLinkRecovery,
    ],
  )

  const disposeHostJoinCodeRoom = useCallback(() => {
    joinCodeHostRoomRef.current?.channel.dispose()
    joinCodeHostRoomRef.current = null
  }, [])

  const stopJoinCodeDiscovery = useCallback(() => {
    joinCodeDiscoveringRef.current = false
    setJoinCodeSearching(false)
    if (joinCodeDiscoverPingRef.current != null) {
      window.clearInterval(joinCodeDiscoverPingRef.current)
      joinCodeDiscoverPingRef.current = null
    }
    if (joinCodeDiscoverTimeoutRef.current != null) {
      window.clearTimeout(joinCodeDiscoverTimeoutRef.current)
      joinCodeDiscoverTimeoutRef.current = null
    }
    joinCodeDiscoverRoomRef.current?.channel.dispose()
    joinCodeDiscoverRoomRef.current = null
    void nativeStopDiscovery()
  }, [])

  const ensureHostJoinCodeRoom = useCallback((): MissionJoinCodeChannel | null => {
    if (!isJoinCodeSignalingAvailable()) return null
    const token = joinTokenRef.current
    if (!token) return null
    const normalized = normalizeJoinCodeInput(joinCodeFromToken(token))
    if (joinCodeHostRoomRef.current?.normalized === normalized) {
      return joinCodeHostRoomRef.current.channel
    }
    joinCodeHostRoomRef.current?.channel.dispose()
    const channel = new MissionJoinCodeChannel(normalized)
    channel.connect({
      onAnswer: (msg) => {
        if (msg.fromDeviceId === deviceId) return
        void applyJoinAnswerRef.current(msg.encoded)
        notify('success', `Teammate linked via mission code ${formatJoinCode(normalized)}`)
      },
      onRequestOffer: () => {
        const encoded = pendingOfferEncodedRef.current
        const mid = coordinatorRef.current?.missionId
        if (!encoded || !mid) return
        void channel.publish({
          kind: 'offer',
          encoded,
          missionId: mid,
          fromDeviceId: deviceId,
          at: Date.now(),
        })
      },
    })
    joinCodeHostRoomRef.current = { normalized, channel }
    return channel
  }, [deviceId, notify])

  const endMission = useCallback(() => {
    const wasObserver = role === 'observer'
    void nativeStopAdvertise()
    stopJoinCodeDiscovery()
    disposeHostJoinCodeRoom()
    coordinatorRef.current?.close()
    coordinatorRef.current = null
    setRole('idle')
    setPhase('idle')
    setMissionId(null)
    setJoinToken('')
    setPeers([])
    setTeamPresence([])
    setTeamCheckIns([])
    setTeamBursts([])
    setLastInboundTeamBurst(null)
    setActiveCommsTarget(null)
    setWatchLinkShared(false)
    lastPublishedPresenceRef.current = null
    setPendingInboundBurst(null)
    setPendingOutboundConfirm(null)
    missionCommsFlowRef.current = createIdleMissionCommsFlow()
    setMissionCommsFlowPhase('idle')
    setPendingOfferEncoded(null)
    setPendingAnswerEncoded(null)
    setPendingObserverOfferEncoded(null)
    setObserverToken('')
    setSignalingTransport('idle')
    setTeamCorridorStatus('idle')
    lastNativePayloadRef.current = ''
    sessionCoordinatorReadyRef.current = false
    if (corridorTimerRef.current != null) window.clearTimeout(corridorTimerRef.current)
    observerSignalUnsubRef.current?.()
    observerSignalUnsubRef.current = null
    observerChannelRef.current?.dispose()
    observerChannelRef.current = null
    waitingForMonitorOfferRef.current = false
    relayLastAtRef.current = 0
    relayDedupeRef.current = new SyncWireDedupe()
    setMonitorTransport('idle')
    setMonitorHostDeviceId(null)
    setMonitorTargetCallsign('Operator')
    clearLinkRecoveryTimer()
    setLinkRecoveryPending(false)
    setRelayLinkState('active')
    saveMissionSession(null)
    locallySuppressedWaypointIdsRef.current.clear()
    peerSnapshotStateRef.current.clear()
    prevWaypointIdsRef.current.clear()
    notify('info', wasObserver ? 'Mission monitor ended' : 'Mission link ended')
  }, [notify, role, setObserverToken, stopJoinCodeDiscovery, disposeHostJoinCodeRoom, clearLinkRecoveryTimer])

  const endMonitor = endMission

  const ensureObserverOfferEncoded = useCallback(async (): Promise<string | null> => {
    const coord = coordinatorRef.current
    if (!coord || role !== 'member' || !missionId) {
      notify('warn', 'Start a field mission first')
      return null
    }
    try {
      const minted = coord.ensureObserverToken()
      if (minted && minted !== observerTokenRef.current) {
        setObserverToken(minted)
        const saved = loadMissionSession()
        if (saved && saved.missionId === missionId) {
          saveMissionSession({ ...saved, observerToken: minted, updatedAt: Date.now() })
        }
      }
      const { encoded, peerId } = await coord.createObserverOffer()
      setPendingObserverOfferEncoded(encoded)
      const token = observerTokenRef.current || minted
      if (token && observerSignalingAvailable) {
        void publishObserverSignal(missionId, token, {
          kind: 'offer',
          hostPeerId: peerId,
          encoded,
          fromDeviceId: deviceId,
          at: Date.now(),
        })
      }
      if (!isMissionTurnConfigured()) {
        notify('info', MISSION_TURN_SETUP_HINT)
      }
      return encoded
    } catch (err) {
      notify('warn', err instanceof Error ? err.message : 'Could not create watch link')
      return null
    }
  }, [role, missionId, deviceId, notify, observerSignalingAvailable, setObserverToken])

  const shareMonitorInvite = useCallback(async () => {
    if (!isFieldMember || !missionId) {
      notify('warn', 'Start a field mission first')
      return
    }
    const encoded = await ensureObserverOfferEncoded()
    if (!encoded) return

    const url = buildWatchMeUrl({
      encodedOffer: encoded,
      missionId,
      observerToken: observerTokenRef.current ?? undefined,
      missionName,
    })
    const text = buildWatchMeInviteText({
      operatorLabel: callsign?.trim() || missionName,
      url,
    })
    const result = await shareMissionBundle(text, {
      title: 'Watch my live map — Signal One',
      alsoCopy: true,
      filename: 'signal-one-watch-me.txt',
    })
    setWatchLinkShared(true)
    if (result === 'shared') {
      notify('success', 'Live map link sent — they tap it in Messages (no paste)')
    } else if (result === 'copied') {
      notify('success', 'Live map link copied — text it to who is watching')
    } else {
      notify('info', 'Live map link ready — send the message to your watcher')
    }
  }, [
    isFieldMember,
    missionId,
    missionName,
    callsign,
    notify,
    ensureObserverOfferEncoded,
  ])

  const createObserverInvite = useCallback(async () => {
    const encoded = await ensureObserverOfferEncoded()
    if (!encoded) return
    void copyMissionBundle(encoded)
    notify(
      'success',
      observerSignalingAvailable
        ? 'Watch link ready — use Share live map link (recommended)'
        : 'Technical bundle copied — use only if link share fails',
    )
  }, [ensureObserverOfferEncoded, notify, observerSignalingAvailable])

  const acceptMonitorOfferEncoded = useCallback(
    async (encodedOffer: string): Promise<string | null> => {
      const packet = decodeMissionPacket(encodedOffer)
      if (!packet || packet.t !== 'mission-offer') {
        notify('warn', 'Invalid monitor bundle')
        return null
      }
      const offer = packet as MissionOfferPacket
      if (!isObserverOffer(offer) || !offer.observerToken) {
        notify('warn', 'Not a monitor bundle — field join bundles are separate')
        return null
      }
      if (
        missionId &&
        offer.missionId !== missionId &&
        !waitingForMonitorOfferRef.current
      ) {
        notify('warn', 'Monitor bundle is for a different mission')
        return null
      }
      if (
        observerTokenRef.current &&
        offer.observerToken !== observerTokenRef.current
      ) {
        notify('warn', 'Monitor token mismatch')
        return null
      }
      waitingForMonitorOfferRef.current = false
      if (role !== 'observer' || !coordinatorRef.current) {
        endMission()
        setMissionId(offer.missionId)
        setMissionName(offer.missionName)
        setObserverToken(offer.observerToken)
        setMonitorHostDeviceId(offer.hostDeviceId)
        setMonitorTargetCallsign(offer.hostCallsign || 'Operator')
        setJoinToken('')
        setRole('observer')
        setAutoApply(true)
        setPhase('connecting')
        const coord = new MissionSyncCoordinator({
          missionId: offer.missionId,
          missionName: offer.missionName,
          joinToken: '',
          observerToken: offer.observerToken,
          hostDeviceId: offer.hostDeviceId,
          hostCallsign: offer.hostCallsign,
          role: 'observer',
          callbacks: {},
        })
        wireCoordinator(coord)
      }
      const coord = coordinatorRef.current!
      const { encoded } = await coord.acceptObserverOffer(offer, callsign, deviceId)
      setPendingAnswerEncoded(encoded)
      setPhase('awaiting-host-answer')
      void copyMissionBundle(encoded)
      const signalSent =
        observerSignalingAvailable &&
        (await publishObserverSignal(offer.missionId, offer.observerToken, {
          kind: 'answer',
          hostPeerId: offer.peerId,
          encoded,
          fromDeviceId: deviceId,
          at: Date.now(),
        }))
      if (signalSent) {
        notify('info', 'Monitor answer sent — waiting for field team')
      } else {
        notify(
          'info',
          'Monitor answer copied — send it back to the field lead if link does not complete',
        )
      }
      saveMissionSession({
        missionId: offer.missionId,
        missionName: offer.missionName,
        role: 'observer',
        deviceId,
        hostDeviceId: offer.hostDeviceId,
        observerToken: offer.observerToken,
        observerWaitMode: false,
        updatedAt: Date.now(),
      })
      return encoded
    },
    [
      missionId,
      role,
      endMission,
      callsign,
      deviceId,
      wireCoordinator,
      notify,
      setObserverToken,
      observerSignalingAvailable,
    ],
  )

  const monitorMissionFromOffer = useCallback(
    async (encodedOffer: string): Promise<string | null> => {
      if (!supported) {
        notify('warn', 'Mission monitor needs WebRTC')
        return null
      }
      endMission()
      setPhase('connecting')
      setRole('observer')
      setAutoApply(true)
      return acceptMonitorOfferEncoded(encodedOffer)
    },
    [supported, endMission, notify, acceptMonitorOfferEncoded],
  )

  const monitorMissionFromToken = useCallback(
    async (targetMissionId: string, token: string, name?: string) => {
      if (!supported) {
        notify('warn', 'Mission monitor needs WebRTC')
        return
      }
      if (!observerSignalingAvailable) {
        notify('warn', 'Token wait needs Supabase signaling — paste monitor bundle instead')
        return
      }
      const trimmedId = targetMissionId.trim()
      const trimmedToken = token.trim()
      if (!trimmedId || trimmedToken.length < 8) {
        notify('warn', 'Enter mission ID and monitor token from the field lead')
        return
      }
      endMission()
      setMissionId(trimmedId)
      setMissionName(name?.trim() || 'Monitored mission')
      setObserverToken(trimmedToken)
      setJoinToken('')
      setRole('observer')
      setAutoApply(true)
      setPhase('connecting')
      waitingForMonitorOfferRef.current = true
      relayDedupeRef.current = new SyncWireDedupe()
      saveMissionSession({
        missionId: trimmedId,
        missionName: name?.trim() || 'Monitored mission',
        role: 'observer',
        deviceId,
        observerToken: trimmedToken,
        observerWaitMode: true,
        updatedAt: Date.now(),
      })
      notify(
        'info',
        'Waiting for live map from the field — keep HUD open. They should use Share live map link first.',
      )
    },
    [supported, observerSignalingAvailable, endMission, deviceId, notify, setObserverToken],
  )

  const publishJoinOfferToCodeRoom = useCallback(
    async (encoded: string) => {
      const mid = missionId ?? coordinatorRef.current?.missionId
      if (!mid) return false
      const channel = ensureHostJoinCodeRoom()
      if (!channel) return false
      return channel.publish({
        kind: 'offer',
        encoded,
        missionId: mid,
        fromDeviceId: deviceId,
        at: Date.now(),
      })
    },
    [missionId, deviceId, ensureHostJoinCodeRoom],
  )

  const createJoinOffer = useCallback(async () => {
    const coord = coordinatorRef.current
    if (!coord) return
    setPhase('awaiting-joiner')
    const { encoded } = await coord.createJoinOffer()
    setPendingOfferEncoded(encoded)
    pendingOfferEncodedRef.current = encoded
    setPendingAnswerEncoded(null)
    const code = joinCodeFromToken(joinTokenRef.current)
    const codeRoomOk = await publishJoinOfferToCodeRoom(encoded)
    const nativeOk = await nativeAdvertisePayload(code, encoded)
    if (nativeOk) {
      setSignalingTransport('wifi-lan')
      notify(
        'success',
        codeRoomOk
          ? `Code ${code} — teammates enter the same code (Wi‑Fi or Android auto-link).`
          : `Code ${code} — Wi‑Fi + Nearby advertising. Teammate enters this exact code.`,
      )
    } else if (codeRoomOk) {
      setSignalingTransport('share')
      notify(
        'success',
        `Code ${code} is live — teammate taps Join with mission code (callsign can differ).`,
      )
    } else {
      setSignalingTransport('share')
      const { shareMissionBundle, shareBundleResultMessage } = await import('../lib/missionSync/shareBundle')
      const result = await shareMissionBundle(encoded, {
        title: 'Signal One — join mission',
        alsoCopy: false,
      })
      notify(
        'info',
        shareBundleResultMessage(result, 'join') +
          (packetFitsCompactQr(encoded)
            ? ' QR code is below.'
            : ' Or paste join bundle in Mission Link.'),
      )
    }
  }, [notify, publishJoinOfferToCodeRoom])

  const startMission = useCallback(
    async (name: string) => {
      if (!supported) {
        notify('warn', 'Mission link needs WebRTC (Android Chrome)')
        return
      }
      endMission()
      const ids = createMissionIds()
      setJoinToken(ids.joinToken)
      setObserverToken(ids.observerToken)
      const trimmed = name.trim() || 'Field mission'
      setMissionName(trimmed)
      setMissionId(ids.missionId)
      setRole('member')
      setPhase('awaiting-joiner')
      const coord = new MissionSyncCoordinator({
        missionId: ids.missionId,
        missionName: trimmed,
        joinToken: ids.joinToken,
        observerToken: ids.observerToken,
        hostDeviceId: deviceId,
        hostCallsign: callsign,
        role: 'member',
        callbacks: {},
      })
      wireCoordinator(coord)
      saveMissionSession({
        missionId: ids.missionId,
        missionName: trimmed,
        role: 'member',
        deviceId,
        joinToken: ids.joinToken,
        observerToken: ids.observerToken,
        hostDeviceId: deviceId,
        updatedAt: Date.now(),
      })
      notify('info', 'Mission started — share code with teammates on the same Wi‑Fi')
      await createJoinOffer()
    },
    [supported, endMission, deviceId, callsign, wireCoordinator, notify, createJoinOffer, setObserverToken],
  )

  const applyJoinAnswer = useCallback(
    async (encoded: string) => {
      const coord = coordinatorRef.current
      const packet = decodeMissionPacket(encoded)
      if (!coord || !packet || packet.t !== 'mission-answer') {
        notify('warn', 'Invalid answer bundle')
        return
      }
      const answer = packet as MissionAnswerPacket
      const isObs = answerLinkRole(answer) === 'observer'
      try {
        await coord.applyJoinAnswer(answer)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Join answer failed'
        notify('warn', `Could not finish teammate link — ${msg}. Tap Link another teammate.`)
        return
      }
      if (isObs) {
        setPendingObserverOfferEncoded(null)
      } else {
        setPendingOfferEncoded(null)
        void nativeStopDiscovery()
      }
      setPendingAnswerEncoded(null)
      setPeers(coord.connectedPeers)
      setPhase('connected')
      notify(
        'success',
        isObs
          ? `${answer.callsign?.trim() || 'Watcher'} is watching your live map`
          : `${answer.callsign} joined your mission mesh`,
      )
    },
    [notify],
  )

  useEffect(() => {
    applyJoinAnswerRef.current = applyJoinAnswer
  }, [applyJoinAnswer])

  useEffect(() => installFieldWakeLockRecovery(), [])

  useEffect(() => {
    if (!linkRecoveryPending) {
      clearLinkRecoveryTimer()
      return
    }
    linkRecoveryTimerRef.current = window.setTimeout(() => {
      linkRecoveryTimerRef.current = null
      const outcome = resolveLinkRecoveryTimeout({
        relayLastAtMs: relayLastAtRef.current,
        peerCount: coordinatorRef.current?.peerCount ?? 0,
        missionRelayActive,
        observerSignalingAvailable,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
        role,
      })
      setLinkRecoveryPending(outcome.linkRecoveryPending)
      setRelayLinkState(outcome.relayLinkState)
      setPhase(outcome.phase)
      notify('warn', outcome.notifyMessage)
      recordMissionOperationalEvent('link_recovery_timeout', outcome.relayLinkState)
      if (outcome.relayLinkState === 'degraded') {
        recordMissionOperationalEvent('relay_degraded')
      } else if (outcome.relayLinkState === 'unavailable') {
        recordMissionOperationalEvent('relay_unavailable')
      }
    }, LINK_RECOVERY_TIMEOUT_MS)
    return () => clearLinkRecoveryTimer()
  }, [
    linkRecoveryPending,
    missionRelayActive,
    observerSignalingAvailable,
    role,
    notify,
    clearLinkRecoveryTimer,
  ])

  useEffect(() => {
    if (role === 'idle' || !missionId) return
    const tick = () => {
      const next = evaluateRelayLinkState({
        relayLastAtMs: relayLastAtRef.current,
        peerCount: coordinatorRef.current?.peerCount ?? peers.length,
        missionRelayActive,
        observerSignalingAvailable,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      })
      setRelayLinkState((prev) => {
        if (prev === next) return prev
        if (next === 'degraded') recordMissionOperationalEvent('relay_degraded')
        if (next === 'unavailable') recordMissionOperationalEvent('relay_unavailable')
        return next
      })
    }
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [role, missionId, peers.length, missionRelayActive, observerSignalingAvailable])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (isFieldSessionBackgrounded()) {
        recordMissionOperationalEvent('visibility_background')
      } else {
        recordMissionOperationalEvent('visibility_foreground')
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    return subscribeFieldWakeLock((held) => {
      if (prevWakeHeldRef.current && !held) {
        recordMissionOperationalEvent('wake_lock_lost')
      } else if (!prevWakeHeldRef.current && held) {
        recordMissionOperationalEvent('wake_lock_recovered')
      }
      prevWakeHeldRef.current = held
    })
  }, [])

  useEffect(() => {
    const keepAwake = role === 'member' || role === 'observer'
    setFieldWakeLockActive(keepAwake)
    return () => setFieldWakeLockActive(false)
  }, [role])

  useEffect(() => {
    createJoinOfferRef.current = createJoinOffer
  }, [createJoinOffer])

  const applyObserverAnswer = applyJoinAnswer

  const joinMissionFromOffer = useCallback(
    async (encodedOffer: string): Promise<string | null> => {
      if (!supported) {
        notify('warn', 'Mission link needs WebRTC (Android Chrome)')
        return null
      }
      const packet = decodeMissionPacket(encodedOffer)
      if (!packet || packet.t !== 'mission-offer') {
        notify('warn', 'Invalid host bundle')
        return null
      }
      const offer = packet as MissionOfferPacket
      if (isObserverOffer(offer)) {
        notify('warn', 'Use Monitor mission for observer bundles')
        return null
      }
      endMission()
      setJoinToken(offer.joinToken)
      if (offer.observerToken) setObserverToken(offer.observerToken)
      setMissionId(offer.missionId)
      setMissionName(offer.missionName)
      setRole('member')
      setPhase('connecting')
      const coord = new MissionSyncCoordinator({
        missionId: offer.missionId,
        missionName: offer.missionName,
        joinToken: offer.joinToken,
        observerToken: offer.observerToken ?? '',
        hostDeviceId: offer.hostDeviceId,
        hostCallsign: offer.hostCallsign,
        role: 'member',
        callbacks: {},
      })
      wireCoordinator(coord)
      const { encoded } = await coord.joinFromOffer(offer, callsign, deviceId, 'member')
      setPendingAnswerEncoded(encoded)
      setPendingOfferEncoded(null)
      setPhase('awaiting-host-answer')
      void copyMissionBundle(encoded)
      saveMissionSession({
        missionId: offer.missionId,
        missionName: offer.missionName,
        role: 'member',
        deviceId,
        joinToken: offer.joinToken,
        observerToken: offer.observerToken,
        hostDeviceId: offer.hostDeviceId,
        updatedAt: Date.now(),
      })
      return encoded
    },
    [supported, endMission, callsign, deviceId, wireCoordinator, notify],
  )

  const startJoinMission = useCallback(
    async (encodedOffer: string) => {
      const encoded = await joinMissionFromOffer(encodedOffer)
      if (!encoded) return
      notify('info', 'Give answer bundle to mission host (or wait if Wi‑Fi auto-link is running)')
    },
    [joinMissionFromOffer, notify],
  )

  useEffect(() => {
    if (!missionId || !observerTokenRef.current || !observerSignalingAvailable) return

    observerChannelRef.current?.dispose()
    const ch = new ObserverMonitorChannel(missionId, observerTokenRef.current)
    observerChannelRef.current = ch

    if (isFieldMember && coordinatorRef.current) {
      attachFieldMonitorRelay(coordinatorRef.current)
    }

    observerSignalUnsubRef.current = ch.connect({
      onOffer: (msg) => {
        if (!isObserver) return
        if (waitingForMonitorOfferRef.current || !coordinatorRef.current?.peerCount) {
          void acceptMonitorOfferEncoded(msg.encoded)
        }
      },
      onAnswer: (msg) => {
        if (!isFieldMember || msg.fromDeviceId === deviceId) return
        void applyJoinAnswer(msg.encoded)
      },
      onRelay: (wire, fromDeviceId) => {
        if (fromDeviceId === deviceId) return
        if (!isObserver && !isFieldMember) return
        handleRelayWire(wire)
      },
    })

    return () => {
      observerSignalUnsubRef.current?.()
      observerSignalUnsubRef.current = null
      ch.dispose()
      if (observerChannelRef.current === ch) observerChannelRef.current = null
    }
  }, [
    missionId,
    observerTokenState,
    observerSignalingAvailable,
    isFieldMember,
    isObserver,
    deviceId,
    applyJoinAnswer,
    acceptMonitorOfferEncoded,
    handleRelayWire,
    attachFieldMonitorRelay,
  ])

  useEffect(() => {
    if (!missionId || !isFieldMember) return
    if (peers.length === 0 && !monitorRelayActive) return
    scheduleSnapshotBroadcast()
    scheduleCorridorHint()
  }, [
    waypoints,
    snapToTrailEnabled,
    missionId,
    peers.length,
    monitorRelayActive,
    isFieldMember,
    scheduleSnapshotBroadcast,
    scheduleCorridorHint,
  ])

  useEffect(() => {
    refreshCorridorStatus()
  }, [refreshCorridorStatus, lastSyncAt])

  const pushPresence = useCallback(() => {
    const coord = coordinatorRef.current
    if (!coord || !isFieldMember) return
    if (coord.peerCount === 0 && !monitorRelayActive) return
    if (gps.lat == null || gps.lng == null) return

    const last = lastPublishedPresenceRef.current
    let headingDeg: number | undefined
    if (last?.lat != null && last?.lng != null) {
      const toRad = (d: number) => (d * Math.PI) / 180
      const toDeg = (r: number) => (r * 180) / Math.PI
      const y = Math.sin(toRad(gps.lng - last.lng)) * Math.cos(toRad(gps.lat))
      const x =
        Math.cos(toRad(last.lat)) * Math.sin(toRad(gps.lat)) -
        Math.sin(toRad(last.lat)) * Math.cos(toRad(gps.lat)) * Math.cos(toRad(gps.lng - last.lng))
      headingDeg = (toDeg(Math.atan2(y, x)) + 360) % 360
    }

    const presence = buildStabilizedTeamPresence({
      deviceId,
      callsign,
      lat: gps.lat,
      lng: gps.lng,
      accuracy: gps.accuracy,
      elevationM: gps.elevation ?? undefined,
      speedMph: travelSpeed.sample?.mph,
      speedMps: travelSpeed.sample?.speedMps ?? null,
      headingDeg,
      lastPublished: last,
    })
    lastPublishedPresenceRef.current = presence
    coord.sendPresence(presence)
  }, [
    deviceId,
    callsign,
    gps.lat,
    gps.lng,
    gps.accuracy,
    gps.elevation,
    travelSpeed.sample?.mph,
    travelSpeed.sample?.speedMps,
    isFieldMember,
    monitorRelayActive,
  ])

  useEffect(() => {
    if (!isFieldMember || (peers.length === 0 && !monitorRelayActive)) return
    pushPresence()
    const id = window.setInterval(pushPresence, PRESENCE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [peers.length, monitorRelayActive, pushPresence, isFieldMember])

  useEffect(() => {
    if (!isFieldMember || !monitorRelayActive) return
    pushSnapshotNow()
    const id = window.setInterval(() => {
      if ((coordinatorRef.current?.peerCount ?? 0) === 0) pushSnapshotNow()
    }, 10_000)
    return () => window.clearInterval(id)
  }, [isFieldMember, monitorRelayActive, missionId, pushSnapshotNow])

  useEffect(() => {
    if (!isFieldMember || peers.length === 0 && !monitorRelayActive) return
    if (gps.lat == null || gps.lng == null) return
    const id = window.setTimeout(pushPresence, PRESENCE_GPS_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [gps.lat, gps.lng, gps.accuracy, isFieldMember, peers.length, monitorRelayActive, pushPresence])

  const sendTeamCheckIn = useCallback(
    (note?: string) => {
      const coord = coordinatorRef.current
      if (!coord || !isFieldMember) return
      if (coord.peerCount === 0 && !monitorRelayActive) return
      const now = Date.now()
      if (now - lastCheckInAtRef.current < CHECKIN_MIN_INTERVAL_MS) {
        notify('warn', 'Check-in cooldown — wait a few seconds')
        return
      }
      lastCheckInAtRef.current = now
      const payload = buildCheckIn(deviceId, callsign, note)
      coord.sendCheckIn(payload)
      notify(
        'success',
        monitorRelayActive && coord.peerCount === 0
          ? 'Check-in sent to remote monitor(s)'
          : 'Check-in sent to team',
      )
    },
    [deviceId, callsign, isFieldMember, monitorRelayActive, notify],
  )

  const sendTeamBurst = useCallback(
    (text: string, toCallsign?: string): boolean => {
      const coord = coordinatorRef.current
      if (!coord || (role !== 'member' && role !== 'observer')) return false
      const linked = coord.connectedPeers
      if (linked.length === 0 && !monitorRelayActive) {
        notify('warn', 'No mission link yet — join mesh or wait for relay')
        return false
      }
      const now = Date.now()
      if (now - lastBurstAtRef.current < BURST_MIN_INTERVAL_MS) {
        notify('warn', 'Message cooldown — wait a few seconds')
        return false
      }
      let target: TeamBurstTarget | undefined
      const trimmedTarget = toCallsign?.trim()
      if (trimmedTarget) {
        const peer = resolveMissionPeerByCallsign(linked, trimmedTarget)
        if (!peer) {
          notify('warn', `No linked mission member matches "${trimmedTarget}"`)
          return false
        }
        target = {
          scope: 'direct',
          peerId: peer.peerId,
          deviceId: peer.deviceId,
          callsign: peer.callsign,
        }
      }
      const payload = buildBurst(deviceId, callsign, text, target)
      if (!payload) return false
      lastBurstAtRef.current = now
      if (target?.scope === 'direct') {
        coord.sendBurstToPeer(target.peerId, payload)
      } else {
        coord.sendBurst(payload)
      }
      setTeamBursts((prev) => filterRecentBursts([...prev, payload]))
      const label =
        target?.scope === 'direct'
          ? `Message sent to ${target.callsign}`
          : 'Message sent to whole mission'
      notify('success', label)
      return true
    },
    [deviceId, callsign, role, monitorRelayActive, notify],
  )

  const confirmOutboundMessage = useCallback((): boolean => {
    const flow = missionCommsFlowRef.current
    if (flow.phase !== 'confirm_send' || !flow.body) return false
    const sent = sendTeamBurst(flow.body, flow.target?.callsign)
    clearOutboundFlow()
    if (sent) emitHaptic('teamMessageSent')
    return sent
  }, [sendTeamBurst, clearOutboundFlow])

  const cancelOutboundMessage = useCallback(() => {
    clearOutboundFlow()
    void speakMissionCommsPhrase('Message cancelled.')
  }, [clearOutboundFlow])

  const startTeamMessageFlow = useCallback(() => {
    syncOutboundFlowState({ phase: 'await_target', target: null, body: '' })
    void speakMissionCommsPhrase('Who should receive it? Say callsign or whole team.')
  }, [syncOutboundFlowState])

  const startTeamMessageTo = useCallback(
    (toCallsign?: string) => {
      const linked = coordinatorRef.current?.connectedPeers ?? peers
      const trimmed = toCallsign?.trim()
      if (!trimmed) {
        syncOutboundFlowState({
          phase: 'await_body',
          target: { label: 'whole mission' },
          body: '',
        })
        void speakMissionCommsPhrase('To whole mission. What is the message?')
        return
      }
      const peer = resolveMissionPeerByCallsign(linked, trimmed)
      if (!peer) {
        void speakMissionCommsPhrase(`No linked member matches ${trimmed}.`)
        return
      }
      syncOutboundFlowState({
        phase: 'await_body',
        target: { callsign: peer.callsign, label: peer.callsign },
        body: '',
      })
      void speakMissionCommsPhrase(`To ${peer.callsign}. What is the message?`)
    },
    [peers, syncOutboundFlowState],
  )

  const handleMissionCommsVoice = useCallback(
    async (phrase: string): Promise<{ handled: boolean; ok: boolean; feedback: string }> => {
      if (role === 'idle') {
        return { handled: false, ok: false, feedback: '' }
      }

      const inboundAction = matchInboundHearConfirm(phrase)
      if (pendingInboundBurst && inboundAction === 'accept') {
        confirmInboundMessage()
        return { handled: true, ok: true, feedback: 'Playing message.' }
      }
      if (pendingInboundBurst && inboundAction === 'skip') {
        skipInboundMessage()
        return { handled: true, ok: true, feedback: 'Skipped.' }
      }

      const flowBefore = missionCommsFlowRef.current
      const activeFlow = flowBefore.phase !== 'idle'

      if (activeFlow || missionCommsPrefs.handsFree) {
        const linked = coordinatorRef.current?.connectedPeers ?? peers
        const { state, effects } = reduceMissionCommsFlow(flowBefore, phrase, linked, deviceId)
        syncOutboundFlowState(state)

        if (effects.length > 0 || state.phase !== flowBefore.phase) {
          let feedback = 'OK.'
          for (const effect of effects) {
            if (effect.type === 'speak') {
              feedback = effect.text
              await speakMissionCommsPhrase(effect.text)
            }
            if (effect.type === 'cancel') {
              clearOutboundFlow()
            }
            if (effect.type === 'confirm_send') {
              if (!teamCommsReady) {
                feedback = 'No mission link yet.'
                await speakMissionCommsPhrase(feedback)
                clearOutboundFlow()
                return { handled: true, ok: false, feedback }
              }
              const sent = sendTeamBurst(effect.body, effect.target.callsign)
              clearOutboundFlow()
              if (sent) {
                emitHaptic('teamMessageSent')
                feedback = `Sent to ${effect.target.label}.`
                await speakMissionCommsPhrase(feedback)
              } else {
                feedback = 'Message not sent.'
                await speakMissionCommsPhrase(feedback)
              }
            }
          }
          return { handled: true, ok: true, feedback }
        }
      }

      return { handled: false, ok: false, feedback: '' }
    },
    [
      role,
      peers,
      deviceId,
      pendingInboundBurst,
      confirmInboundMessage,
      skipInboundMessage,
      missionCommsPrefs.handsFree,
      syncOutboundFlowState,
      clearOutboundFlow,
      teamCommsReady,
      sendTeamBurst,
    ],
  )

  useEffect(() => {
    setMissionCommsVoiceHandler(handleMissionCommsVoice)
    return () => setMissionCommsVoiceHandler(null)
  }, [handleMissionCommsVoice])

  const discoverMissionOnLan = useCallback(
    async (codeInput: string): Promise<boolean> => {
      if (!isValidJoinCodeInput(codeInput)) {
        notify('warn', 'Enter the full 6-character mission code (e.g. ABC-123)')
        return false
      }
      const token = joinTokenRef.current
      if (
        role === 'member' &&
        missionId &&
        token &&
        !joinCodesMatch(token, codeInput)
      ) {
        notify('warn', 'End your current mission first, then join with the host code.')
        return false
      }
      const code = formatJoinCode(codeInput)
      const normalized = normalizeJoinCodeInput(codeInput)
      let started = false

      stopJoinCodeDiscovery()
      lastJoinCodeOfferRef.current = ''

      if (isJoinCodeSignalingAvailable()) {
        joinCodeDiscoveringRef.current = true
        setJoinCodeSearching(true)
        lastJoinCodeInputRef.current = normalized
        const channel = new MissionJoinCodeChannel(normalized)
        joinCodeDiscoverRoomRef.current = { normalized, channel }
        channel.connect({
          onOffer: (msg) => {
            if (!joinCodeDiscoveringRef.current || msg.fromDeviceId === deviceId) return
            if (msg.encoded === lastJoinCodeOfferRef.current) return
            if (joinCodeJoinInFlightRef.current) return
            lastJoinCodeOfferRef.current = msg.encoded
            joinCodeJoinInFlightRef.current = true
            void (async () => {
              try {
                const answer = await joinMissionFromOffer(msg.encoded)
                if (!answer) {
                  notify('warn', 'Could not complete join — ask host to keep Mission Link open.')
                  return
                }
                const sentCode = await publishJoinCodeAnswerWithRetry({
                  code: normalized,
                  encoded: answer,
                  fromDeviceId: deviceId,
                })
                if (sentCode) {
                  setSignalingTransport('share')
                  notify('success', `Linked to mission ${code} — finishing secure link…`)
                  stopJoinCodeDiscovery()
                } else {
                  notify(
                    'warn',
                    'Host did not receive your join — keep Mission Link open on both devices; retrying…',
                  )
                }
              } finally {
                joinCodeJoinInFlightRef.current = false
              }
            })()
          },
        })
        const pingHost = () => {
          void channel.publish({
            kind: 'request-offer',
            fromDeviceId: deviceId,
            callsign,
            at: Date.now(),
          })
        }
        void pingHost()
        joinCodeDiscoverPingRef.current = window.setInterval(pingHost, 1_500)
        joinCodeDiscoverTimeoutRef.current = window.setTimeout(() => {
          if (!joinCodeDiscoveringRef.current) return
          notify(
            'warn',
            `No host for ${code} yet — confirm phone shows ${code}, Mission Link open, same Wi‑Fi + internet.`,
          )
          stopJoinCodeDiscovery()
        }, 35_000)
        started = true
        notify('info', joinCodeSignalingHint(codeInput))
      }

      const nativeOk = await nativeDiscoverMission(code)
      if (nativeOk) {
        setSignalingTransport('wifi-lan')
        notify('info', `Also scanning local Wi‑Fi + Nearby for ${code}…`)
        started = true
      } else if (!started) {
        notify(
          'warn',
          'Code join unavailable — check internet on Wi‑Fi or paste join bundle below.',
        )
      }
      return started || nativeOk
    },
    [
      missionId,
      role,
      deviceId,
      callsign,
      notify,
      joinMissionFromOffer,
      stopJoinCodeDiscovery,
    ],
  )

  useEffect(() => {
    void wireNativePayloadBridge()
    void getNativeLinkPlatform().then(setNativeLink)
    return onNativePayload((ev) => {
      if (ev.payload === lastNativePayloadRef.current) return
      lastNativePayloadRef.current = ev.payload

      const transport: MissionSignalingTransport =
        ev.transport === 'nearby' ? 'nearby' : ev.transport === 'wifi-lan' ? 'wifi-lan' : 'unknown'
      setSignalingTransport((prev) => (shouldPreferTransport(prev, transport) ? transport : prev))

      const packet = decodeMissionPacket(ev.payload)
      if (!packet) return
      if (packet.t === 'mission-offer') {
        if (isObserverOffer(packet as MissionOfferPacket)) return
        void (async () => {
          const answer = await joinMissionFromOffer(ev.payload)
          if (!answer) return
          let sent = false
          if (ev.transport === 'nearby' && ev.endpointId) {
            sent = await nativeSendNearbyPayload(ev.endpointId, answer)
            if (sent) notify('success', `Answer sent via ${transportLabel('nearby')} — linking…`)
          }
          if (!sent && ev.fromAddress && ev.fromPort != null) {
            sent = await nativeSendPayloadToHost(ev.fromAddress, ev.fromPort, answer)
            if (sent) notify('success', `Answer sent via ${transportLabel('wifi-lan')} — linking…`)
          }
          if (!sent && joinCodeDiscoverRoomRef.current?.channel) {
            sent = await joinCodeDiscoverRoomRef.current.channel.publish({
              kind: 'answer',
              encoded: answer,
              fromDeviceId: deviceId,
              at: Date.now(),
            })
            if (sent) notify('success', `Answer sent — mission code ${formatJoinCode(ev.joinCode)}`)
          }
          if (sent) stopJoinCodeDiscovery()
          else notify('info', 'Paste answer bundle on host tablet if link does not complete')
        })()
        return
      }
      if (packet.t === 'mission-answer') {
        notify('success', `Host received answer via ${transportLabel(transport)}`)
        void applyJoinAnswer(ev.payload)
      }
    })
  }, [joinMissionFromOffer, applyJoinAnswer, notify, deviceId, stopJoinCodeDiscovery])

  useEffect(() => {
    pendingOfferEncodedRef.current = pendingOfferEncoded
  }, [pendingOfferEncoded])

  useEffect(() => {
    if (!isFieldMember || !missionJoinToken) {
      disposeHostJoinCodeRoom()
      return
    }
    ensureHostJoinCodeRoom()
    return () => disposeHostJoinCodeRoom()
  }, [isFieldMember, missionJoinToken, ensureHostJoinCodeRoom, disposeHostJoinCodeRoom])

  useEffect(() => {
    if (!isFieldMember || !pendingOfferEncoded || phase !== 'awaiting-joiner') return
    void publishJoinOfferToCodeRoom(pendingOfferEncoded)
    const id = window.setInterval(() => {
      void publishJoinOfferToCodeRoom(pendingOfferEncoded)
    }, 5_000)
    return () => window.clearInterval(id)
  }, [isFieldMember, pendingOfferEncoded, phase, publishJoinOfferToCodeRoom])

  useEffect(() => {
    if (phase !== 'awaiting-host-answer' || !pendingAnswerEncoded) return
    const code = lastJoinCodeInputRef.current
    if (code.length !== 6) return
    let cancelled = false
    const pushAnswer = () => {
      if (cancelled) return
      void publishJoinCodeAnswerWithRetry(
        { code, encoded: pendingAnswerEncoded, fromDeviceId: deviceId },
        2,
      )
    }
    pushAnswer()
    const id = window.setInterval(pushAnswer, 3_000)
    const stop = window.setTimeout(() => {
      cancelled = true
      window.clearInterval(id)
    }, 45_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.clearTimeout(stop)
    }
  }, [phase, pendingAnswerEncoded, deviceId])

  useEffect(() => {
    if (!missionId || role !== 'member') return
    const onRemoved = (ev: Event) => {
      const id = (ev as CustomEvent<{ id: string }>).detail?.id
      if (id) locallySuppressedWaypointIdsRef.current.add(id)
      pendingMeshPushAfterDeleteRef.current = true
    }
    window.addEventListener(WAYPOINT_REMOVED_EVENT, onRemoved)
    return () => window.removeEventListener(WAYPOINT_REMOVED_EVENT, onRemoved)
  }, [missionId, role])

  useEffect(() => {
    if (!missionId || role !== 'member') return
    if (!pendingMeshPushAfterDeleteRef.current) return
    pendingMeshPushAfterDeleteRef.current = false
    pushSnapshotNow()
  }, [waypoints, missionId, role, pushSnapshotNow])

  useEffect(() => {
    const ids = new Set(waypoints.map((w) => w.id))
    for (const id of prevWaypointIdsRef.current) {
      if (!ids.has(id)) locallySuppressedWaypointIdsRef.current.add(id)
    }
    prevWaypointIdsRef.current = ids
  }, [waypoints])

  useEffect(() => {
    if (role !== 'member' || !missionId) return
    const coord = coordinatorRef.current
    if (!coord) return
    const fieldLinks = coord.connectedPeers.filter((p) => p.linkRole === 'member').length
    if (fieldLinks > 0 && phase !== 'connected') {
      setPeers(coord.connectedPeers)
      setPhase('connected')
    }
  }, [role, missionId, phase, peers.length])

  useEffect(() => {
    const saved = loadMissionSession()
    const outcome = evaluateMissionRestore({
      session: saved,
      deviceId,
      observerSignalingAvailable: isObserverSignalingAvailable(),
    })
    if (outcome === 'none') return
    if (outcome === 'device_mismatch') {
      notify('warn', missionRestoreGuidance(outcome))
      return
    }
    if (outcome === 'corrupt') {
      saveMissionSession(null)
      notify('warn', missionRestoreGuidance(outcome))
      return
    }
    if (!saved) return

    setMissionName(saved.missionName)
    setMissionId(saved.missionId)
    setRole(saved.role === 'observer' ? 'observer' : 'member')
    setJoinToken(saved.joinToken ?? '')
    if (saved.observerToken) setObserverToken(saved.observerToken)
    setPhase('idle')
    refreshCorridorStatus()
    if (saved.role === 'member' && saved.observerToken) setWatchLinkShared(true)
    recordMissionOperationalEvent('mission_restore', outcome)

    if (sessionCoordinatorReadyRef.current) return
    if (outcome === 'observer_wait' || outcome === 'observer_paste') {
      sessionCoordinatorReadyRef.current = true
      if (outcome === 'observer_wait') waitingForMonitorOfferRef.current = true
      setPhase('connecting')
      notify('info', missionRestoreGuidance(outcome))
      return
    }
    if (!saved.joinToken) return
    sessionCoordinatorReadyRef.current = true
    let observerToken = saved.observerToken ?? ''
    const isMissionHost = outcome === 'host_restore'
    if (!observerToken) {
      if (isMissionHost) {
        observerToken = createMissionIds().observerToken
        setObserverToken(observerToken)
        saveMissionSession({ ...saved, observerToken, updatedAt: Date.now() })
        notify('info', 'Monitor token added for this mission — you can share remote watch links now.')
      } else {
        notify(
          'warn',
          'Ask mission lead for a fresh join link to restore internet mesh when you leave Wi‑Fi.',
        )
      }
    } else {
      setObserverToken(observerToken)
    }
    const coord = new MissionSyncCoordinator({
      missionId: saved.missionId,
      missionName: saved.missionName,
      joinToken: saved.joinToken,
      observerToken,
      hostDeviceId: saved.hostDeviceId ?? saved.deviceId,
      hostCallsign: callsign,
      role: 'member',
      callbacks: {},
    })
    wireCoordinator(coord)
    if (isMissionHost) {
      setPhase('awaiting-joiner')
      notify('info', missionRestoreGuidance('host_restore'))
      void createJoinOfferRef.current()
    } else {
      setPhase('connecting')
      notify('info', missionRestoreGuidance('joiner_restore'))
    }
  }, [deviceId, setJoinToken, setObserverToken, callsign, wireCoordinator, notify, refreshCorridorStatus])

  const reconnectMesh = useCallback(async () => {
    if (!coordinatorRef.current || !missionId) {
      notify('warn', 'Start or join a mission first')
      return
    }
    await createJoinOffer()
  }, [missionId, createJoinOffer, notify])

  useEffect(() => {
    return () => {
      coordinatorRef.current?.close()
      if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
      if (corridorTimerRef.current != null) window.clearTimeout(corridorTimerRef.current)
    }
  }, [])

  const dismissNotice = useCallback(() => setLastNotice(null), [])

  const value = useMemo<MissionSyncContextValue>(
    () => ({
      supported,
      role,
      phase,
      missionId,
      missionName,
      deviceId,
      callsign,
      peers,
      teamPresence,
      autoApply,
      setAutoApply,
      lastSyncAt,
      lastNotice,
      pendingOfferEncoded,
      pendingAnswerEncoded,
      pendingOfferFitsQr: qrFitFlags.pendingOfferFitsQr,
      pendingAnswerFitsQr: qrFitFlags.pendingAnswerFitsQr,
      bluetoothNote,
      joinCode,
      nativeLink,
      joinCodeSignalingAvailable,
      signalingTransport,
      signalingLabel,
      teamCorridorStatus,
      reconnectMesh,
      teamCheckIns: filteredTeamComms.teamCheckIns,
      teamBursts: filteredTeamComms.teamBursts,
      teamCommsReady,
      linkRecoveryPending,
      relayLinkState,
      lastInboundTeamBurst,
      dismissTeamCommsAlert,
      activeCommsTarget,
      openCommsForTeammate,
      clearActiveCommsTarget,
      sendTeamCheckIn,
      sendTeamBurst,
      watchLinkShared,
      missionCommsPrefs,
      setMissionCommsPrefs,
      missionCommsFlowPhase,
      pendingInboundBurst,
      confirmInboundMessage,
      skipInboundMessage,
      pendingOutboundConfirm,
      confirmOutboundMessage,
      cancelOutboundMessage,
      queueOutboundConfirm,
      startTeamMessageFlow,
      startTeamMessageTo,
      joinCodeSearching,
      discoverMissionOnLan,
      joinMissionFromOffer,
      startMission,
      startHostMission: startMission,
      createJoinOffer,
      applyJoinAnswer,
      applyJoinerAnswer: applyJoinAnswer,
      startJoinMission,
      endMission,
      pushSnapshotNow,
      observerToken,
      observerCount,
      pendingObserverOfferEncoded,
      pendingObserverOfferFitsQr: qrFitFlags.pendingObserverOfferFitsQr,
      observerSignalingAvailable,
      createObserverInvite,
      monitorMissionFromOffer,
      monitorMissionFromToken,
      monitorTransport,
      monitorLive,
      monitoredPresence,
      monitorTargetCallsign,
      shareMonitorInvite,
      applyObserverAnswer,
      endMonitor,
      dismissNotice,
    }),
    [
      supported,
      role,
      phase,
      missionId,
      missionName,
      joinCode,
      deviceId,
      callsign,
      peers,
      teamPresence,
      autoApply,
      bluetoothNote,
      nativeLink,
      joinCodeSignalingAvailable,
      signalingTransport,
      signalingLabel,
      teamCorridorStatus,
      observerToken,
      observerCount,
      pendingObserverOfferEncoded,
      observerSignalingAvailable,
      filteredTeamComms,
      qrFitFlags,
      teamCommsReady,
      linkRecoveryPending,
      relayLinkState,
      lastInboundTeamBurst,
      dismissTeamCommsAlert,
      activeCommsTarget,
      openCommsForTeammate,
      clearActiveCommsTarget,
      sendTeamCheckIn,
      sendTeamBurst,
      watchLinkShared,
      missionCommsPrefs,
      setMissionCommsPrefs,
      missionCommsFlowPhase,
      pendingInboundBurst,
      confirmInboundMessage,
      skipInboundMessage,
      pendingOutboundConfirm,
      confirmOutboundMessage,
      cancelOutboundMessage,
      queueOutboundConfirm,
      startTeamMessageFlow,
      startTeamMessageTo,
      joinCodeSearching,
      discoverMissionOnLan,
      joinMissionFromOffer,
      lastSyncAt,
      lastNotice,
      pendingOfferEncoded,
      pendingAnswerEncoded,
      startMission,
      createJoinOffer,
      createObserverInvite,
      monitorMissionFromOffer,
      monitorMissionFromToken,
      monitorTransport,
      monitorLive,
      monitoredPresence,
      monitorTargetCallsign,
      shareMonitorInvite,
      applyObserverAnswer,
      startJoinMission,
      endMission,
      endMonitor,
      pushSnapshotNow,
      reconnectMesh,
      dismissNotice,
    ],
  )

  return (
    <MissionSyncContext.Provider value={value}>
      <MonitorJoinBootstrap />
      {children}
    </MissionSyncContext.Provider>
  )
}

export function useMissionSync(): MissionSyncContextValue {
  const ctx = useContext(MissionSyncContext)
  if (!ctx) throw new Error('useMissionSync must be used within MissionSyncProvider')
  return ctx
}
