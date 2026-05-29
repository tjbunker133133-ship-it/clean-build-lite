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
  MissionSnapshot,
  MissionSyncConnectionPhase,
  MissionSyncRole,
  TeamPresence,
} from '../lib/missionSync/types'
import { getBluetoothMeshCapability } from '../lib/missionSync/bluetooth'
import { joinCodeFromToken, joinCodesMatch } from '../lib/missionSync/joinCode'
import {
  getNativeLinkPlatform,
  nativeAdvertisePayload,
  nativeDiscoverMission,
  nativeStopAdvertise,
  nativeStopDiscovery,
  onNativePayload,
  wireNativePayloadBridge,
  type NativeLinkPlatform,
} from '../lib/missionSync/nativeLink'
import { isMissionSyncSupported } from '../lib/missionSync/webrtc'

export type MissionSyncNotice = {
  level: 'info' | 'success' | 'warn'
  message: string
  at: number
}

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
  teamCheckIns: MissionCheckIn[]
  teamBursts: MissionBurst[]
  sendTeamCheckIn: (note?: string) => void
  sendTeamBurst: (text: string) => boolean
  discoverMissionOnLan: (codeInput: string) => Promise<boolean>
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
  dismissNotice: () => void
}

const MissionSyncContext = createContext<MissionSyncContextValue | null>(null)

const PRESENCE_INTERVAL_MS = 8_000
const PRESENCE_GPS_DEBOUNCE_MS = 4_000
const SNAPSHOT_DEBOUNCE_MS = 1800

export function MissionSyncProvider({ children }: { children: ReactNode }) {
  const { state, setWaypoints } = useAppContext()
  const gps = useGPS()
  const { profile } = useTacticalProfile()
  const waypoints = state.waypoints

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

  const deviceId = useMemo(() => loadOrCreateDeviceId(), [])
  const callsign = profile.display_name.trim() || 'Operator'
  const coordinatorRef = useRef<MissionSyncCoordinator | null>(null)
  const joinTokenRef = useRef('')
  const joinCode = missionJoinToken ? joinCodeFromToken(missionJoinToken) : null

  const setJoinToken = useCallback((token: string) => {
    joinTokenRef.current = token
    setMissionJoinToken(token)
  }, [])
  const revisionRef = useRef(0)
  const applyingRemoteRef = useRef(false)
  const snapshotTimerRef = useRef<number | null>(null)
  const lastCheckInAtRef = useRef(0)
  const lastBurstAtRef = useRef(0)

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
    }
  }, [missionId, missionName, deviceId, callsign, waypoints])

  const applyRemoteSnapshot = useCallback(
    (snapshot: MissionSnapshot, fromPeerId: string) => {
      if (snapshot.missionId !== missionId) return
      const { merged, added, updated } = mergeMissionWaypoints(waypoints, snapshot.waypoints)
      if (added === 0 && updated === 0) return
      applyingRemoteRef.current = true
      try {
        if (autoApply) {
          setWaypoints(merged)
          setLastSyncAt(Date.now())
          notify(
            'success',
            `Team sync from ${snapshot.sourceCallsign}: +${added} new, ${updated} updated`,
          )
        } else {
          notify(
            'info',
            `Team update available (${added} new, ${updated} updated) — enable auto-apply`,
          )
        }
      } finally {
        window.setTimeout(() => {
          applyingRemoteRef.current = false
        }, 0)
      }
      void fromPeerId
    },
    [missionId, waypoints, autoApply, setWaypoints, notify],
  )

  const pushSnapshotNow = useCallback(() => {
    const coord = coordinatorRef.current
    const snapshot = buildSnapshot()
    if (!coord || !snapshot) return
    coord.sendSnapshot(snapshot)
    setLastSyncAt(Date.now())
  }, [buildSnapshot])

  const scheduleSnapshotBroadcast = useCallback(() => {
    if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
    snapshotTimerRef.current = window.setTimeout(() => {
      snapshotTimerRef.current = null
      if (applyingRemoteRef.current) return
      if (peers.length === 0) return
      pushSnapshotNow()
    }, SNAPSHOT_DEBOUNCE_MS)
  }, [peers.length, role, pushSnapshotNow])

  const wireCoordinator = useCallback(
    (coord: MissionSyncCoordinator) => {
      coordinatorRef.current = coord
      coord.setCallbacks({
        onPeerConnected: (peer) => {
          setPeers(coord.connectedPeers)
          setPhase('connected')
          notify('success', `${peer.callsign} linked`)
          pushSnapshotNow()
        },
        onPeerDisconnected: () => {
          setPeers(coord.connectedPeers)
          if (coord.peerCount === 0 && missionId) setPhase('awaiting-joiner')
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
        onError: (msg) => {
          setPhase('failed')
          notify('warn', msg)
        },
      })
    },
    [applyRemoteSnapshot, notify, pushSnapshotNow, missionId, deviceId],
  )

  const endMission = useCallback(() => {
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
    saveMissionSession(null)
    notify('info', 'Mission link ended')
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
      const trimmed = name.trim() || 'Field mission'
      setMissionName(trimmed)
      setMissionId(ids.missionId)
      setRole('member')
      setPhase('awaiting-joiner')
      const coord = new MissionSyncCoordinator({
        missionId: ids.missionId,
        missionName: trimmed,
        joinToken: ids.joinToken,
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
        hostDeviceId: deviceId,
        updatedAt: Date.now(),
      })
      notify('info', 'Mission started — any tablet can link teammates')
    },
    [supported, endMission, deviceId, callsign, wireCoordinator, notify],
  )

  const createJoinOffer = useCallback(async () => {
    const coord = coordinatorRef.current
    if (!coord || role !== 'member') return
    setPhase('awaiting-joiner')
    const { encoded } = await coord.createJoinOffer()
    setPendingOfferEncoded(encoded)
    setPendingAnswerEncoded(null)
    const code = joinCodeFromToken(joinTokenRef.current)
    if (await nativeAdvertisePayload(code, encoded)) {
      notify('info', `LAN discovery on · code ${code} · QR/copy still works`)
    } else {
      notify('info', packetFitsCompactQr(encoded) ? 'Show QR or copy join bundle' : 'Copy join bundle to teammate')
    }
  }, [role, notify])

  const applyJoinAnswer = useCallback(
    async (encoded: string) => {
      const coord = coordinatorRef.current
      const packet = decodeMissionPacket(encoded)
      if (!coord || !packet || packet.t !== 'mission-answer') {
        notify('warn', 'Invalid answer bundle')
        return
      }
      await coord.applyJoinAnswer(packet as MissionAnswerPacket)
      setPendingOfferEncoded(null)
      setPendingAnswerEncoded(null)
      setPeers(coord.connectedPeers)
      setPhase('connected')
    },
    [notify],
  )

  const startJoinMission = useCallback(
    async (encodedOffer: string) => {
      if (!supported) {
        notify('warn', 'Mission link needs WebRTC (Android Chrome)')
        return
      }
      const packet = decodeMissionPacket(encodedOffer)
      if (!packet || packet.t !== 'mission-offer') {
        notify('warn', 'Invalid host bundle')
        return
      }
      const offer = packet as MissionOfferPacket
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
      const { encoded } = await coord.joinFromOffer(offer, callsign, deviceId)
      setPendingAnswerEncoded(encoded)
      setPendingOfferEncoded(null)
      const code = joinCodeFromToken(offer.joinToken)
      void nativeAdvertisePayload(code, encoded)
      setPhase('awaiting-host-answer')
      saveMissionSession({
        missionId: offer.missionId,
        missionName: offer.missionName,
        role: 'member',
        deviceId,
        joinToken: offer.joinToken,
        hostDeviceId: offer.hostDeviceId,
        updatedAt: Date.now(),
      })
      notify('info', 'Give answer bundle to the tablet that showed the join bundle')
    },
    [supported, endMission, callsign, deviceId, wireCoordinator, notify],
  )

  useEffect(() => {
    if (!missionId || peers.length === 0) return
    scheduleSnapshotBroadcast()
  }, [waypoints, missionId, peers.length, scheduleSnapshotBroadcast])

  const pushPresence = useCallback(() => {
    const coord = coordinatorRef.current
    if (!coord || peers.length === 0) return
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
  }, [deviceId, callsign, gps.lat, gps.lng, gps.accuracy, peers.length])

  useEffect(() => {
    if (peers.length === 0) return
    pushPresence()
    const id = window.setInterval(pushPresence, PRESENCE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [peers.length, pushPresence])

  useEffect(() => {
    if (peers.length === 0) return
    if (gps.lat == null || gps.lng == null) return
    const id = window.setTimeout(pushPresence, PRESENCE_GPS_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [gps.lat, gps.lng, gps.accuracy, peers.length, pushPresence])

  const sendTeamCheckIn = useCallback(
    (note?: string) => {
      const coord = coordinatorRef.current
      if (!coord || peers.length === 0) return
      const now = Date.now()
      if (now - lastCheckInAtRef.current < CHECKIN_MIN_INTERVAL_MS) {
        notify('warn', 'Check-in cooldown — wait a few seconds')
        return
      }
      lastCheckInAtRef.current = now
      const payload = buildCheckIn(deviceId, callsign, note)
      coord.sendCheckIn(payload)
      notify('success', 'Check-in sent to team')
    },
    [deviceId, callsign, peers.length, notify],
  )

  const sendTeamBurst = useCallback(
    (text: string): boolean => {
      const coord = coordinatorRef.current
      if (!coord || peers.length === 0) return false
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
    [deviceId, callsign, peers.length, notify],
  )

  const discoverMissionOnLan = useCallback(
    async (codeInput: string): Promise<boolean> => {
      const token = joinTokenRef.current
      if (token && missionId && !joinCodesMatch(token, codeInput)) {
        notify('warn', 'Mission code does not match this mission')
        return false
      }
      const code = token ? joinCodeFromToken(token) : codeInput.trim().toUpperCase()
      const ok = await nativeDiscoverMission(code)
      if (ok) notify('info', `Searching LAN for mission ${code}…`)
      else notify('warn', 'LAN discovery needs the Android Play build')
      return ok
    },
    [missionId, notify],
  )

  useEffect(() => {
    void wireNativePayloadBridge()
    void getNativeLinkPlatform().then(setNativeLink)
    return onNativePayload((ev) => {
      const packet = decodeMissionPacket(ev.payload)
      if (!packet) return
      if (packet.t === 'mission-offer') {
        void startJoinMission(ev.payload)
        return
      }
      if (packet.t === 'mission-answer') {
        void applyJoinAnswer(ev.payload)
      }
    })
  }, [startJoinMission, applyJoinAnswer])

  useEffect(() => {
    const saved = loadMissionSession()
    if (!saved || saved.deviceId !== deviceId) return
    setMissionName(saved.missionName)
    setMissionId(saved.missionId)
    setRole('member')
    setJoinToken(saved.joinToken ?? '')
    setPhase('idle')
  }, [deviceId, setJoinToken])

  useEffect(() => {
    return () => {
      coordinatorRef.current?.close()
      if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
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
      teamCheckIns: filterFreshCheckIns(teamCheckIns),
      teamBursts: filterRecentBursts(teamBursts),
      sendTeamCheckIn,
      sendTeamBurst,
      discoverMissionOnLan,
      startMission,
      startHostMission: startMission,
      createJoinOffer,
      applyJoinAnswer,
      applyJoinerAnswer: applyJoinAnswer,
      startJoinMission,
      endMission,
      pushSnapshotNow,
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
      teamCheckIns,
      teamBursts,
      sendTeamCheckIn,
      sendTeamBurst,
      discoverMissionOnLan,
      lastSyncAt,
      lastNotice,
      pendingOfferEncoded,
      pendingAnswerEncoded,
      startMission,
      createJoinOffer,
      applyJoinAnswer,
      startJoinMission,
      endMission,
      pushSnapshotNow,
    ],
  )

  return <MissionSyncContext.Provider value={value}>{children}</MissionSyncContext.Provider>
}

export function useMissionSync(): MissionSyncContextValue {
  const ctx = useContext(MissionSyncContext)
  if (!ctx) throw new Error('useMissionSync must be used within MissionSyncProvider')
  return ctx
}
