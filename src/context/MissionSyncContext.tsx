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
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { decodeMissionPacket, packetFitsCompactQr } from '../lib/missionSync/codec'
import {
  MissionSyncCoordinator,
  createMissionIds,
} from '../lib/missionSync/coordinator'
import { mergeMissionWaypoints } from '../lib/missionSync/merge'
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
import type {
  ConnectedPeer,
  MissionAnswerPacket,
  MissionBurst,
  MissionCheckIn,
  MissionOfferPacket,
  MissionCorridorHint,
  MissionSnapshot,
  MissionSyncConnectionPhase,
  MissionSyncRole,
  TeamPresence,
} from '../lib/missionSync/types'
import { getBluetoothMeshCapability } from '../lib/missionSync/bluetooth'
import { joinCodeFromToken, joinCodesMatch, formatJoinCode, isValidJoinCodeInput } from '../lib/missionSync/joinCode'
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
  watchOfferFitsQr,
} from '../lib/missionSync/monitorInviteUrl'
import { SyncWireDedupe } from '../lib/missionSync/wireDedupe'
import type { SyncWireMessage } from '../lib/missionSync/types'
import { isMissionTurnConfigured, MISSION_TURN_SETUP_HINT } from '../lib/missionSync/turnConfig'
import { copyMissionBundle, shareMissionBundle } from '../lib/missionSync/shareBundle'
import { isMissionSyncSupported } from '../lib/missionSync/webrtc'
import { isMonitorSessionLive } from '../lib/missionSync/monitorLive'
import { pickMonitoredPresence } from '../lib/missionSync/monitorUx'
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
  /** Active bundle-exchange path (Wi‑Fi LAN vs Nearby vs manual). */
  signalingTransport: MissionSignalingTransport
  signalingLabel: string
  teamCorridorStatus: MissionMeshCorridorStatus
  reconnectMesh: () => Promise<void>
  teamCheckIns: MissionCheckIn[]
  teamBursts: MissionBurst[]
  sendTeamCheckIn: (note?: string) => void
  sendTeamBurst: (text: string) => boolean
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
  const { profile } = useTacticalProfile()
  const waypoints = state.waypoints
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
  const lastNativePayloadRef = useRef('')
  const teamPresenceRef = useRef<TeamPresence[]>([])
  teamPresenceRef.current = teamPresence
  const observerSignalUnsubRef = useRef<(() => void) | null>(null)
  const observerChannelRef = useRef<ObserverMonitorChannel | null>(null)
  const waitingForMonitorOfferRef = useRef(false)
  const relayDedupeRef = useRef(new SyncWireDedupe())
  const relayLastAtRef = useRef(0)

  const isFieldMember = role === 'member'
  const isObserver = role === 'observer'
  const observerSignalingAvailable = isObserverSignalingAvailable()
  const monitorRelayActive =
    isFieldMember && Boolean(observerTokenState) && observerSignalingAvailable
  const observerCount = useMemo(
    () => peers.filter((p) => p.linkRole === 'observer').length,
    [peers],
  )
  const monitorLive = useMemo(
    () =>
      isMonitorSessionLive({
        role,
        phase,
        peerCount: peers.length,
        monitorTransport,
        lastSyncAt,
      }),
    [role, phase, peers.length, monitorTransport, lastSyncAt],
  )
  const monitoredPresence = useMemo(
    () => pickMonitoredPresence(teamPresence, deviceId, monitorHostDeviceId),
    [teamPresence, deviceId, monitorHostDeviceId],
  )

  const supported = isMissionSyncSupported()
  const bluetoothNote = getBluetoothMeshCapability().reason

  const notify = useCallback((level: MissionSyncNotice['level'], message: string) => {
    setLastNotice({ level, message, at: Date.now() })
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
      waypoints: sanitizeWaypointsForSync(waypoints),
      snapToTrailEnabled,
    }
  }, [missionId, missionName, deviceId, callsign, waypoints, snapToTrailEnabled])

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
      const { merged, added, updated, archived } = mergeMissionWaypoints(
        waypoints,
        snapshot.waypoints,
      )
      const wpChanged = added > 0 || updated > 0 || archived > 0
      const snapChanged =
        snapshot.snapToTrailEnabled !== undefined &&
        snapshot.snapToTrailEnabled !== snapToTrailEnabled
      if (!wpChanged && !snapChanged) return

      applyingRemoteRef.current = true
      try {
        if (autoApply) {
          if (wpChanged) setWaypoints(merged)
          if (snapChanged && snapshot.snapToTrailEnabled !== undefined) {
            setSnapToTrail(snapshot.snapToTrailEnabled)
          }
          setLastSyncAt(Date.now())
          const parts: string[] = []
          if (added > 0) parts.push(`+${added} new`)
          if (updated > 0) parts.push(`${updated} updated`)
          if (archived > 0) parts.push(`${archived} archived`)
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
      if (msg.type === 'burst' && msg.payload.deviceId !== deviceId) {
        setTeamBursts((prev) => filterRecentBursts([...prev, msg.payload]))
        notify('info', `${msg.payload.callsign}: ${msg.payload.text}`)
      }
      if (msg.type === 'corridor-hint') handleRemoteCorridorHint(msg.payload)
      setLastSyncAt(Date.now())
    },
    [applyRemoteSnapshot, deviceId, handleRemoteCorridorHint, notify, isObserver],
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
            if (isObserver && Date.now() - relayLastAtRef.current < 45_000) {
              setMonitorTransport('relay')
              setPhase('connected')
            } else if (isObserver && observerSignalingAvailable) {
              setPhase('connecting')
            } else {
              setPhase('awaiting-joiner')
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
        onBurst: (b) => {
          if (b.deviceId === deviceId) return
          setTeamBursts((prev) => filterRecentBursts([...prev, b]))
          notify('info', `${b.callsign}: ${b.text}`)
        },
        onCorridorHint: (hint) => handleRemoteCorridorHint(hint),
        onError: (msg) => {
          if (msg.includes('disconnected') || msg.includes('peer-disconnected')) {
            notify('warn', 'Link blip — mission stays active, reconnecting mesh…')
            return
          }
          if (
            coordinatorRef.current?.role === 'observer' &&
            (msg.includes('failed') || msg.includes('ice'))
          ) {
            if (Date.now() - relayLastAtRef.current < 45_000 || observerSignalingAvailable) {
              setMonitorTransport((prev) => (prev === 'direct' ? 'relay' : prev))
              setPhase('connected')
              notify(
                'info',
                'Direct monitor link dropped — still receiving updates over internet relay.',
              )
              return
            }
            setPhase('failed')
            notify(
              'warn',
              'Monitor link failed — check cell/Wi‑Fi, or ask field lead to resend monitor bundle.',
            )
            return
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
      observerSignalingAvailable,
    ],
  )

  const endMission = useCallback(() => {
    const wasObserver = role === 'observer'
    void nativeStopAdvertise()
    void nativeStopDiscovery()
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
    saveMissionSession(null)
    notify('info', wasObserver ? 'Mission monitor ended' : 'Mission link ended')
  }, [notify, role, setObserverToken])

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

  const createJoinOffer = useCallback(async () => {
    const coord = coordinatorRef.current
    if (!coord) return
    setPhase('awaiting-joiner')
    const { encoded } = await coord.createJoinOffer()
    setPendingOfferEncoded(encoded)
    setPendingAnswerEncoded(null)
    const code = joinCodeFromToken(joinTokenRef.current)
    if (await nativeAdvertisePayload(code, encoded)) {
      setSignalingTransport('wifi-lan')
      notify(
        'info',
        `Teammate code ${code} — searching Wi‑Fi + Nearby. Share join link if auto-link fails.`,
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
          (packetFitsCompactQr(encoded) ? ' QR code is below.' : ' Bundle is large — use Share, not QR.'),
      )
    }
  }, [notify])

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
      await coord.applyJoinAnswer(answer)
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
      setMissionId(offer.missionId)
      setMissionName(offer.missionName)
      setRole('member')
      setPhase('connecting')
      const coord = new MissionSyncCoordinator({
        missionId: offer.missionId,
        missionName: offer.missionName,
        joinToken: offer.joinToken,
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
        if (!isObserver || fromDeviceId === deviceId) return
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
    const presence: TeamPresence = {
      deviceId,
      callsign,
      lat: gps.lat,
      lng: gps.lng,
      accuracy: gps.accuracy,
      updatedAt: Date.now(),
    }
    coord.sendPresence(presence)
  }, [deviceId, callsign, gps.lat, gps.lng, gps.accuracy, isFieldMember, monitorRelayActive])

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
    (text: string): boolean => {
      const coord = coordinatorRef.current
      if (!coord || !isFieldMember) return false
      if (coord.peerCount === 0 && !monitorRelayActive) return false
      const now = Date.now()
      if (now - lastBurstAtRef.current < BURST_MIN_INTERVAL_MS) {
        notify('warn', 'Message cooldown — wait a few seconds')
        return false
      }
      const payload = buildBurst(deviceId, callsign, text)
      if (!payload) return false
      lastBurstAtRef.current = now
      coord.sendBurst(payload)
      return true
    },
    [deviceId, callsign, isFieldMember, monitorRelayActive, notify],
  )

  const discoverMissionOnLan = useCallback(
    async (codeInput: string): Promise<boolean> => {
      if (!isValidJoinCodeInput(codeInput)) {
        notify('warn', 'Enter the full 6-character mission code (e.g. ABC-123)')
        return false
      }
      const token = joinTokenRef.current
      if (token && missionId && !joinCodesMatch(token, codeInput)) {
        notify('warn', 'Mission code does not match this mission')
        return false
      }
      const code = token ? joinCodeFromToken(token) : formatJoinCode(codeInput)
      const ok = await nativeDiscoverMission(code)
      if (ok) {
        setSignalingTransport('wifi-lan')
        notify(
          'info',
          `Searching Wi‑Fi + Bluetooth/Nearby for ${code}… same hotspot preferred, no pairing needed`,
        )
      } else {
        notify(
          'warn',
          'Auto-link needs the Android field app — or scan QR / paste join bundle',
        )
      }
      return ok
    },
    [missionId, notify],
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
          if (sent) void nativeStopDiscovery()
          else notify('info', 'Paste answer bundle on host tablet if link does not complete')
        })()
        return
      }
      if (packet.t === 'mission-answer') {
        notify('success', `Host received answer via ${transportLabel(transport)}`)
        void applyJoinAnswer(ev.payload)
      }
    })
  }, [joinMissionFromOffer, applyJoinAnswer, notify])

  useEffect(() => {
    const saved = loadMissionSession()
    if (!saved || saved.deviceId !== deviceId) return
    setMissionName(saved.missionName)
    setMissionId(saved.missionId)
    setRole(saved.role === 'observer' ? 'observer' : 'member')
    setJoinToken(saved.joinToken ?? '')
    if (saved.observerToken) setObserverToken(saved.observerToken)
    setPhase('idle')
    refreshCorridorStatus()

    if (sessionCoordinatorReadyRef.current) return
    if (saved.role === 'observer') {
      sessionCoordinatorReadyRef.current = true
      if (saved.observerToken && saved.observerWaitMode && isObserverSignalingAvailable()) {
        waitingForMonitorOfferRef.current = true
        setPhase('connecting')
        notify(
          'info',
          'Monitor session restored — waiting for field lead. Internet relay resumes when online.',
        )
      } else if (saved.observerToken) {
        setPhase('connecting')
        notify(
          'info',
          'Monitor session restored — paste a new monitor bundle to reconnect WebRTC, or wait for field lead.',
        )
      } else {
        notify('info', 'Monitor session restored — paste a new monitor bundle to reconnect')
      }
      return
    }
    if (!saved.joinToken) return
    sessionCoordinatorReadyRef.current = true
    let observerToken = saved.observerToken ?? ''
    if (!observerToken) {
      observerToken = createMissionIds().observerToken
      setObserverToken(observerToken)
      saveMissionSession({ ...saved, observerToken, updatedAt: Date.now() })
      notify('info', 'Monitor token added for this mission — you can share remote watch links now.')
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
    notify('info', 'Mission restored — link a teammate to resume mesh sync')
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
      pendingOfferFitsQr: pendingOfferEncoded ? packetFitsCompactQr(pendingOfferEncoded) : false,
      pendingAnswerFitsQr: pendingAnswerEncoded ? packetFitsCompactQr(pendingAnswerEncoded) : false,
      bluetoothNote,
      joinCode,
      nativeLink,
      signalingTransport,
      signalingLabel,
      teamCorridorStatus,
      reconnectMesh,
      teamCheckIns: filterFreshCheckIns(teamCheckIns),
      teamBursts: filterRecentBursts(teamBursts),
      sendTeamCheckIn,
      sendTeamBurst,
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
      pendingObserverOfferFitsQr: pendingObserverOfferEncoded
        ? watchOfferFitsQr(pendingObserverOfferEncoded)
        : false,
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
      dismissNotice: () => setLastNotice(null),
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
      signalingTransport,
      signalingLabel,
      teamCorridorStatus,
      observerToken,
      observerCount,
      pendingObserverOfferEncoded,
      observerSignalingAvailable,
      teamCheckIns,
      teamBursts,
      sendTeamCheckIn,
      sendTeamBurst,
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
