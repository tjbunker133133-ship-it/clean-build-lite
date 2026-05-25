import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import HudPanel from './HudPanel'
import { useGPS, requestLocation } from '../hooks/useGPS'
import {
  requestCameraPermission,
  getPermissionSnapshot,
  requestMicrophonePermission,
  requestMotionPermission,
  requestNotificationPermission,
  requestOrientationPermission,
  type PermissionStateLike,
} from '../lib/devicePermissions'
import { COCKPIT_STORAGE_KEY } from '../types/cockpit'
import { resetAppState } from '../utils/resetApp'
import { forceUpdateApp, isForceUpdateInFlight } from '../utils/forceUpdate'
import { iosInstallCopy } from '../lib/iosInstallGuide'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { updatePermission } from '../runtime/runtimeSnapshot'
import { hudDevLog, isHudVerboseDebug } from '../lib/tier1DebugLog'
import { touchFontSm, touchFontMd, touchGapMd, touchGapSm, touchMinTarget } from './tokens'
import { resolveRapidEndpointMeta } from '../lib/rescue/resolveRapidEndpoint'
import { readRescuePipelineTrace } from '../lib/rescue/rescuePipelineTrace'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import TacticalProfileEditor from './TacticalProfileEditor'
import { traceAction } from '../runtime/actionTrace'
import { useCockpit } from '../context/CockpitContext'
import { clampMobileToReachableViewport, isPanelReachableInViewport } from '../lib/mobilePanelHelpers'
import { cockpitViewport } from '../lib/viewport'
import { resolveBuildLabel } from '../runtime/buildLabel'

type CheckState = 'pass' | 'warn' | 'fail'
type ManualCheckKey =
  | 'contactsLoaded'
  | 'audioAudible'
  | 'corridorVerified'
  | 'deadmanRenew'
  | 'sosDryRun'

type CheckRow = {
  label: string
  state: CheckState
  detail: string
  weight?: number
  critical?: boolean
}

const MANUAL_KEY = 'tactical_preflight_manual_v1'
// Try mobile-scoped key first, fall back to legacy desktop key. Used only for
// status display; the authoritative writers live in CockpitContext.
const DEVICE_TUNE_KEYS = [
  `${COCKPIT_STORAGE_KEY}_device_tune_mobile`,
  `${COCKPIT_STORAGE_KEY}_device_tune`,
]

function stateColor(state: CheckState) {
  if (state === 'pass') return '#7dff8a'
  if (state === 'warn') return '#ffd166'
  return '#ff6b87'
}

function scoreForState(state: CheckState, critical = false) {
  if (state === 'pass') return 1
  if (state === 'warn') return critical ? 0.5 : 0.7
  return 0
}

function readinessBand(score: number): {
  label: 'GREEN' | 'YELLOW-GREEN' | 'YELLOW' | 'ORANGE' | 'RED'
  color: string
  detail: string
} {
  if (score >= 90) return { label: 'GREEN', color: '#7dff8a', detail: 'Field Ready' }
  if (score >= 80) return { label: 'YELLOW-GREEN', color: '#a9f58f', detail: 'Pilot Ready' }
  if (score >= 70) return { label: 'YELLOW', color: '#ffd166', detail: 'Fix Soon' }
  if (score >= 60) return { label: 'ORANGE', color: '#ffb570', detail: 'Hold' }
  return { label: 'RED', color: '#ff6b87', detail: 'No-Go' }
}

export default function PreflightPanel() {
  const { panels, updatePanel, raisePanel } = useCockpit()
  const gps = useGPS()
  const [online, setOnline] = useState(navigator.onLine)
  const [geoPerm, setGeoPerm] = useState<PermissionState | 'unknown'>('unknown')
  const [micPerm, setMicPerm] = useState<PermissionState | 'unknown'>('unknown')
  const [notifPerm, setNotifPerm] = useState<PermissionStateLike>('unknown')
  const [orientationPerm, setOrientationPerm] = useState<PermissionStateLike>('unknown')
  const [motionPerm, setMotionPerm] = useState<PermissionStateLike>('unknown')
  const [cameraPerm, setCameraPerm] = useState<PermissionStateLike>('unknown')
  const [isStandalone, setIsStandalone] = useState(false)
  const [recheckTick, setRecheckTick] = useState(0)
  const [lastRecheckAt, setLastRecheckAt] = useState<number | null>(null)
  const [requestingPerms, setRequestingPerms] = useState(false)
  const [forceUpdating, setForceUpdating] = useState(false)
  const [manual, setManual] = useState<Record<ManualCheckKey, boolean>>({
    contactsLoaded: false,
    audioAudible: false,
    corridorVerified: false,
    deadmanRenew: false,
    sosDryRun: false,
  })
  const { profile, assessment, operationalReady } = useTacticalProfile()
  const contactCount = assessment.validContactCount
  const [lastContactDiagSig, setLastContactDiagSig] = useState('')
  const [lastEligibilityDiagSig, setLastEligibilityDiagSig] = useState('')
  const [lastVisibilityDiagSig, setLastVisibilityDiagSig] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MANUAL_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      setManual((prev) => ({ ...prev, ...parsed }))
    } catch {
      // noop
    }
  }, [])

  useEffect(() => {
    if (!isHudVerboseDebug()) return
    const sig = `${operationalReady}:${contactCount}:${profile.updated_at}`
    if (sig === lastContactDiagSig) return
    setLastContactDiagSig(sig)
    hudDevLog('contact-hydration', {
      operationalReady,
      hydratedCount: contactCount,
      validationIssues: assessment.issues,
    })
  }, [operationalReady, contactCount, profile.updated_at, assessment.issues, lastContactDiagSig])

  useEffect(() => {
    if (!isHudVerboseDebug()) return
    const profile = getDeviceProfile()
    const layout = panels.preflight
    const { vw, vh } = cockpitViewport()
    const pos = { x: layout?.x ?? 0, y: layout?.y ?? 0 }
    const size = { w: layout?.w ?? 320, h: layout?.h ?? 300 }
    const reachable = isPanelReachableInViewport(pos, size, { vw, vh }, 36)
    const sig = `${profile.interactionMode}:${Boolean(layout)}:${layout?.docked ?? false}:${layout?.minimized ?? false}:${reachable}:${layout?.z ?? 0}`
    if (sig === lastVisibilityDiagSig) return
    setLastVisibilityDiagSig(sig)
    hudDevLog('emergency-panel-visibility', {
      panel: 'preflight',
      interactionMode: profile.interactionMode,
      mounted: Boolean(layout),
      docked: layout?.docked ?? null,
      minimized: layout?.minimized ?? null,
      reachable,
      z: layout?.z ?? null,
    })
  }, [panels.preflight, lastVisibilityDiagSig])

  useEffect(() => {
    const profile = getDeviceProfile()
    if (profile.interactionMode !== 'mobile') return
    const layout = panels.preflight
    if (!layout || layout.docked) return
    const { vw, vh } = cockpitViewport()
    const reachable = clampMobileToReachableViewport(
      { x: layout.x, y: layout.y },
      { w: layout.w, h: layout.h ?? 300 },
      { vw, vh },
      36,
    )
    if (Math.abs(reachable.x - layout.x) <= 0.5 && Math.abs(reachable.y - layout.y) <= 0.5) return
    updatePanel('preflight', { x: reachable.x, y: reachable.y })
    hudDevLog('emergency-panel-recovery', {
        panel: 'preflight',
        reason: 'offscreen_or_unreachable',
        from: { x: layout.x, y: layout.y },
        to: reachable,
      })
  }, [panels.preflight, updatePanel])

  useEffect(() => {
    try {
      localStorage.setItem(MANUAL_KEY, JSON.stringify(manual))
    } catch {
      // noop
    }
  }, [manual])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    // Force effect refresh on explicit recheck requests.
    void recheckTick
    setIsStandalone(getDeviceProfile().isStandalone)
  }, [recheckTick])

  useEffect(() => {
    hudDevLog('emergency-config-panel-mounted', {
      panel: 'preflight',
      interactionMode: getDeviceProfile().interactionMode,
      operationalReady,
      contactCount,
    })
  }, [operationalReady, contactCount])

  useEffect(() => {
    let alive = true
    void getPermissionSnapshot().then((snapshot) => {
      if (!alive) return
      setGeoPerm(snapshot.geolocation === 'unsupported' ? 'unknown' : snapshot.geolocation)
      setMicPerm(snapshot.microphone === 'unsupported' ? 'unknown' : snapshot.microphone)
      setNotifPerm(snapshot.notifications)
      updatePermission('geolocation', snapshot.geolocation as never)
      updatePermission('microphone', snapshot.microphone as never)
      updatePermission('notifications', snapshot.notifications as never)
    })
    return () => {
      alive = false
    }
  }, [recheckTick])

  const legacySavedContactsCount = useMemo(() => {
    try {
      const raw =
        localStorage.getItem('titanium_saved_contacts') ??
        localStorage.getItem('emergency_contacts_saved') ??
        '[]'
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  }, [])

  const endpointMeta = useMemo(() => resolveRapidEndpointMeta(), [recheckTick])
  const endpoint = endpointMeta.url
  const buildId = useMemo(() => resolveBuildLabel(), [])
  const speechSupported = !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  const deviceTuneMeta = useMemo(() => {
    try {
      let raw: string | null = null
      for (const key of DEVICE_TUNE_KEYS) {
        raw = localStorage.getItem(key)
        if (raw) break
      }
      if (!raw) return null
      const parsed = JSON.parse(raw) as { v?: string; device?: string; ts?: number }
      return {
        device: typeof parsed?.device === 'string' ? parsed.device : 'unknown',
        version: typeof parsed?.v === 'string' ? parsed.v : 'unknown',
        ts: typeof parsed?.ts === 'number' && Number.isFinite(parsed.ts) ? parsed.ts : null,
      }
    } catch {
      return null
    }
  }, [recheckTick])

  const checks: CheckRow[] = useMemo(() => {
    const deviceProfile = getDeviceProfile()
    const gpsLock =
      gps.locationState === 'granted' && gps.lat != null && gps.lng != null
    return [
      {
        label: 'Network',
        state: online ? 'pass' : 'warn',
        detail: online ? 'Online' : 'Offline mode',
        weight: 1.2,
        critical: true,
      },
      {
        label: 'PWA Install',
        state: isStandalone ? 'pass' : 'warn',
        detail: isStandalone
          ? 'Home Screen app'
          : deviceProfile.isIOS
            ? 'Safari tab — use Add to Home Screen'
            : 'Browser tab',
        weight: 0.8,
      },
      {
        label: 'GPS Permission',
        state: geoPerm === 'granted' ? 'pass' : geoPerm === 'prompt' ? 'warn' : 'warn',
        detail: geoPerm,
        weight: 1.4,
        critical: true,
      },
      {
        label: 'GPS Lock',
        state: gpsLock ? 'pass' : 'warn',
        detail: gpsLock ? `Lat ${gps.lat?.toFixed(5)} / Lng ${gps.lng?.toFixed(5)}` : 'Awaiting fix',
        weight: 1.6,
        critical: true,
      },
      {
        label: 'Mic Permission',
        state: micPerm === 'granted' ? 'pass' : micPerm === 'prompt' ? 'warn' : 'warn',
        detail: micPerm,
        weight: 1,
      },
      {
        label: 'Notification Permission',
        state: notifPerm === 'granted' ? 'pass' : notifPerm === 'prompt' ? 'warn' : 'warn',
        detail: notifPerm,
        weight: 0.8,
      },
      {
        label: 'Orientation Permission',
        state: orientationPerm === 'granted' ? 'pass' : orientationPerm === 'unsupported' ? 'warn' : 'warn',
        detail: orientationPerm,
        weight: 0.8,
      },
      {
        label: 'Motion Permission',
        state: motionPerm === 'granted' ? 'pass' : motionPerm === 'unsupported' ? 'warn' : 'warn',
        detail: motionPerm,
        weight: 0.8,
      },
      {
        label: 'Camera Permission',
        state: cameraPerm === 'granted' ? 'pass' : cameraPerm === 'unsupported' ? 'warn' : 'warn',
        detail: cameraPerm,
        weight: 0.7,
      },
      {
        label: 'Voice Recognition',
        state: speechSupported ? 'pass' : 'warn',
        detail: speechSupported ? 'Supported' : 'Fallback typed mode',
        weight: 1,
      },
      {
        label: 'Rescue Endpoint',
        state: endpoint ? 'pass' : 'warn',
        detail: endpoint
          ? `send-rescue-email (${endpointMeta.source})`
          : 'Missing (recommended for live rescue ops)',
        weight: 1.4,
        critical: true,
      },
      {
        label: 'Tactical Profile',
        state: operationalReady ? 'pass' : 'warn',
        detail: operationalReady
          ? `${profile.display_name || 'Operator'} · ${contactCount} contact(s)`
          : assessment.messages[0] ?? 'Identity or contacts incomplete',
        weight: 1.2,
        critical: true,
      },
    ]
  }, [
    endpoint,
    endpointMeta.source,
    geoPerm,
    gps.lat,
    gps.lng,
    gps.locationState,
    isStandalone,
    micPerm,
    notifPerm,
    motionPerm,
    orientationPerm,
    cameraPerm,
    online,
    operationalReady,
    contactCount,
    profile.display_name,
    assessment.messages,
    speechSupported,
    recheckTick,
  ])

  const checksWeight = checks.reduce((sum, c) => sum + (c.weight ?? 1), 0)
  const checksScore = checks.reduce(
    (sum, c) => sum + scoreForState(c.state, c.critical) * (c.weight ?? 1),
    0,
  )
  const manualRows: Array<{ key: ManualCheckKey; label: string; weight: number }> = [
    { key: 'contactsLoaded', label: 'Contacts loaded and route-selected', weight: 1.1 },
    { key: 'audioAudible', label: 'Alarm is clearly audible on device', weight: 0.8 },
    { key: 'corridorVerified', label: 'Corridor warning verified with live GPS', weight: 0.8 },
    { key: 'deadmanRenew', label: 'Deadman renew + timeout flow verified', weight: 1.1 },
    { key: 'sosDryRun', label: 'SOS dry-run + disarm tested', weight: 1.3 },
  ]
  const manualWeight = manualRows.reduce((sum, row) => sum + row.weight, 0)
  const manualScore = manualRows.reduce(
    (sum, row) => sum + (manual[row.key] ? 1 : 0.6) * row.weight,
    0,
  )
  const score = Math.round(((checksScore + manualScore) / (checksWeight + manualWeight)) * 100)
  const band = readinessBand(score)
  const gpsLock =
    gps.locationState === 'granted' && gps.lat != null && gps.lng != null
  const hardGates = [
    { label: 'Rescue endpoint configured', pass: !!endpoint },
    { label: 'Tactical profile ready', pass: operationalReady },
    { label: 'GPS permission granted', pass: geoPerm === 'granted' },
    { label: 'GPS lock acquired', pass: gpsLock },
    { label: 'Deadman renew verified', pass: manual.deadmanRenew },
    { label: 'SOS dry-run verified', pass: manual.sosDryRun },
  ]
  const hardGatePass = hardGates.every((g) => g.pass)
  const goHold = hardGatePass && score >= 80 ? 'GO' : 'HOLD'
  const goHoldColor = goHold === 'GO' ? '#7dff8a' : '#ff6b87'

  useEffect(() => {
    if (!isHudVerboseDebug()) return
    const sig = `${operationalReady}:${contactCount}:${Boolean(endpoint)}`
    if (sig === lastEligibilityDiagSig) return
    setLastEligibilityDiagSig(sig)
    hudDevLog('rescue-eligibility-state', {
      operationalReady,
      hydratedContacts: contactCount,
      endpointConfigured: Boolean(endpoint),
      eligible: operationalReady && Boolean(endpoint),
    })
  }, [operationalReady, contactCount, endpoint, lastEligibilityDiagSig])
  const runAutoRecheck = () => {
    setRecheckTick((v) => v + 1)
    setLastRecheckAt(Date.now())
  }

  const requestAllPermissions = async () => {
    if (requestingPerms) return
    setRequestingPerms(true)
    try {
      // Run sequentially from the same user gesture for better iOS Safari reliability.
      await requestLocation()
      const snapGeo = await getPermissionSnapshot()
      setGeoPerm(snapGeo.geolocation === 'unsupported' ? 'unknown' : snapGeo.geolocation)
      const mic = await requestMicrophonePermission()
      const camera = await requestCameraPermission()
      const notif = await requestNotificationPermission()
      const orientation = await requestOrientationPermission()
      const motion = await requestMotionPermission()
      setMicPerm(mic === 'unsupported' ? 'unknown' : mic)
      setCameraPerm(camera)
      setNotifPerm(notif)
      setOrientationPerm(orientation)
      setMotionPerm(motion)
      setLastRecheckAt(Date.now())
      setRecheckTick((v) => v + 1)
    } finally {
      setRequestingPerms(false)
    }
  }

  const requestOne = async (fn: () => Promise<void>) => {
    if (requestingPerms) return
    setRequestingPerms(true)
    try {
      await fn()
      setLastRecheckAt(Date.now())
      setRecheckTick((v) => v + 1)
    } finally {
      setRequestingPerms(false)
    }
  }

  const deviceProfile = getDeviceProfile()
  const isMobile = deviceProfile.interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const gapSm = touchGapSm(isMobile)
  const tapMin = touchMinTarget(isMobile)
  const permissionButtonStyle: CSSProperties = {
    minHeight: tapMin,
    borderRadius: 8,
    border: '1px solid rgba(199,206,198,0.35)',
    background: 'rgba(199,206,198,0.12)',
    color: '#e2e8e2',
    cursor: 'pointer',
    fontSize: fontSm,
    letterSpacing: '0.06em',
    fontWeight: 700,
  }

  useEffect(() => {
    hudDevLog('build', { buildId })
  }, [buildId])

  return (
    <HudPanel panelId="preflight" title="Preflight Test" initialPos={{ x: 16, y: 180 }} initialWidth={320}>
      <div style={{ display: 'grid', gap: gapMd, fontSize: fontSm }}>
        {isMobile && (
          <button
            type="button"
            data-no-drag
            onClick={() => {
              const { vw, vh } = cockpitViewport()
              const next = clampMobileToReachableViewport(
                { x: panels.preflight?.x ?? 16, y: panels.preflight?.y ?? 72 },
                { w: panels.preflight?.w ?? 320, h: panels.preflight?.h ?? 320 },
                { vw, vh },
                36,
              )
              updatePanel('preflight', { docked: false, minimized: false, x: next.x, y: next.y })
              raisePanel('preflight')
              hudDevLog('emergency-panel-recovery', {
                  panel: 'preflight',
                  reason: 'operator_reachability_action',
                  to: next,
                })
            }}
            style={{
              minHeight: tapMin,
              borderRadius: 8,
              border: '1px solid rgba(125,255,138,0.45)',
              background: 'rgba(125,255,138,0.14)',
              color: '#d8f8dd',
              cursor: 'pointer',
              fontSize: fontSm,
              letterSpacing: '0.08em',
              fontWeight: 700,
            }}
          >
            ENSURE CONTACT PANEL IS VISIBLE
          </button>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid rgba(199,206,198,0.26)',
            background: 'rgba(10,12,13,0.6)',
            color: '#d8e3d8',
          }}
        >
          <span>Readiness Score</span>
          <strong style={{ color: score >= 80 ? '#7dff8a' : score >= 60 ? '#ffd166' : '#ff6b87' }}>{score}%</strong>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 8px',
            borderRadius: 8,
            border: `1px solid ${band.color}66`,
            background: 'rgba(10,12,13,0.6)',
            color: '#d8e3d8',
          }}
        >
          <span>
            Readiness Band: <strong style={{ color: band.color }}>{band.label}</strong> ({band.detail})
          </span>
          <strong style={{ color: goHoldColor }}>{goHold}</strong>
        </div>
        <button
          type="button"
          data-no-drag
          onClick={runAutoRecheck}
          style={{
            minHeight: tapMin,
            borderRadius: 8,
            border: '1px solid rgba(125,255,138,0.45)',
            background: 'rgba(125,255,138,0.14)',
            color: '#d8f8dd',
            cursor: 'pointer',
            fontSize: fontSm,
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}
        >
          RUN AUTO RECHECK
        </button>
        <button
          type="button"
          data-no-drag
          onClick={() => void requestAllPermissions()}
          style={{
            minHeight: tapMin,
            borderRadius: 8,
            border: '1px solid rgba(255,209,102,0.45)',
            background: 'rgba(255,209,102,0.14)',
            color: '#ffe6b3',
            cursor: 'pointer',
            fontSize: fontSm,
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}
        >
          {requestingPerms ? 'REQUESTING PERMISSIONS…' : 'REQUEST ALL DEVICE PERMISSIONS'}
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: gapSm }}>
          <button
            type="button"
            data-no-drag
            style={permissionButtonStyle}
            disabled={requestingPerms}
            onClick={() =>
              void requestOne(async () => {
                await requestLocation()
                const s = await getPermissionSnapshot()
                setGeoPerm(s.geolocation === 'unsupported' ? 'unknown' : s.geolocation)
              })
            }
          >
            PROMPT LOCATION
          </button>
          <button
            type="button"
            data-no-drag
            style={permissionButtonStyle}
            disabled={requestingPerms}
            onClick={() =>
              void requestOne(async () => {
                const s = await requestMicrophonePermission()
                setMicPerm(s === 'unsupported' ? 'unknown' : s)
              })
            }
          >
            PROMPT MIC
          </button>
          <button
            type="button"
            data-no-drag
            style={permissionButtonStyle}
            disabled={requestingPerms}
            onClick={() =>
              void requestOne(async () => {
                setCameraPerm(await requestCameraPermission())
              })
            }
          >
            PROMPT CAMERA
          </button>
          <button
            type="button"
            data-no-drag
            style={permissionButtonStyle}
            disabled={requestingPerms}
            onClick={() =>
              void requestOne(async () => {
                setNotifPerm(await requestNotificationPermission())
              })
            }
          >
            PROMPT NOTIFY
          </button>
          <button
            type="button"
            data-no-drag
            style={permissionButtonStyle}
            disabled={requestingPerms}
            onClick={() =>
              void requestOne(async () => {
                setOrientationPerm(await requestOrientationPermission())
              })
            }
          >
            PROMPT ORIENT
          </button>
          <button
            type="button"
            data-no-drag
            style={permissionButtonStyle}
            disabled={requestingPerms}
            onClick={() =>
              void requestOne(async () => {
                setMotionPerm(await requestMotionPermission())
              })
            }
          >
            PROMPT MOTION
          </button>
        </div>
        {lastRecheckAt != null && (
          <div style={{ fontSize: fontSm, color: '#9ea7a0' }}>
            Last recheck: {new Date(lastRecheckAt).toLocaleTimeString()}
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gap: 2,
            fontSize: fontSm,
            color: '#9ea7a0',
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid rgba(199,206,198,0.18)',
            background: 'rgba(12,16,14,0.45)',
          }}
        >
          <div>
            Device profile: <strong style={{ color: '#d6ddd6' }}>{(deviceTuneMeta?.device ?? 'unknown').toUpperCase()}</strong>
          </div>
          <div>
            Tune version: <strong style={{ color: '#d6ddd6' }}>{deviceTuneMeta?.version ?? 'not applied'}</strong>
          </div>
          <div>
            Build: <strong style={{ color: '#d6ddd6' }}>{buildId}</strong>
          </div>
          {isHudVerboseDebug() && readRescuePipelineTrace().length > 0 ? (
            <div style={{ fontSize: '0.68rem', color: '#9aa89a', lineHeight: 1.35 }}>
              Last rescue trace:{' '}
              <strong style={{ color: '#d6ddd6' }}>
                {JSON.stringify(readRescuePipelineTrace().slice(-1)[0]?.data ?? {})}
              </strong>
            </div>
          ) : null}
          <div>
            Legacy local contacts: <strong style={{ color: '#d6ddd6' }}>{legacySavedContactsCount}</strong>
          </div>
          <div>
            Last optimized:{' '}
            <strong style={{ color: '#d6ddd6' }}>
              {deviceTuneMeta?.ts ? new Date(deviceTuneMeta.ts).toLocaleString() : 'not recorded'}
            </strong>
          </div>
        </div>

        <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid rgba(199,206,198,0.16)', borderRadius: 8, padding: 6 }}>
          {checks.map((check) => (
            <div
              key={check.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: gapSm,
                padding: '5px 4px',
                borderBottom: '1px solid rgba(199,206,198,0.08)',
              }}
            >
              <div>
                <div style={{ color: '#d6ddd6' }}>{check.label}</div>
                <div style={{ color: '#9ea7a0', fontSize: fontSm }}>{check.detail}</div>
              </div>
              <div style={{ color: stateColor(check.state), fontWeight: 700, alignSelf: 'center' }}>
                {check.state === 'pass' ? 'PASS' : check.state === 'warn' ? 'WARN' : 'FAIL'}
              </div>
            </div>
          ))}
        </div>

        {deviceProfile.isIOS && !isStandalone ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(125,255,138,0.35)',
              background: 'rgba(12,24,16,0.55)',
              fontSize: fontSm,
              color: '#c7d4c8',
              lineHeight: 1.45,
            }}
          >
            <div style={{ color: '#7dff8a', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6 }}>
              iPHONE / iPAD: ADD TO HOME SCREEN
            </div>
            <p style={{ margin: '0 0 6px' }}>{iosInstallCopy(deviceProfile.type === 'tablet').lead}</p>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {iosInstallCopy(deviceProfile.type === 'tablet').steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}

        <div style={{ fontSize: fontSm, color: '#9ea7a0', letterSpacing: '0.08em' }}>
          TACTICAL PROFILE (DEVICE-LOCAL)
        </div>
        <div
          style={{
            border: '1px solid rgba(199,206,198,0.16)',
            borderRadius: 8,
            padding: 8,
            display: 'grid',
            gap: gapSm,
          }}
        >
          <TacticalProfileEditor />
        </div>

        <div style={{ fontSize: fontSm, color: '#9ea7a0', letterSpacing: '0.08em' }}>HARD GATE CHECKS (REQUIRED)</div>
        <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid rgba(199,206,198,0.16)', borderRadius: 8, padding: 6 }}>
          {hardGates.map((gate) => (
            <div
              key={gate.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: gapSm,
                padding: '5px 4px',
                borderBottom: '1px solid rgba(199,206,198,0.08)',
              }}
            >
              <div style={{ color: '#d6ddd6' }}>{gate.label}</div>
              <div style={{ color: gate.pass ? '#7dff8a' : '#ff6b87', fontWeight: 700 }}>
                {gate.pass ? 'PASS' : 'BLOCK'}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: fontSm, color: '#9ea7a0', letterSpacing: '0.08em' }}>MANUAL CHECKS</div>
        <div style={{ display: 'grid', gap: gapSm }}>
          {manualRows.map((row) => (
            <label key={row.key} style={{ display: 'flex', alignItems: 'center', gap: gapMd, color: '#d6ddd6', minHeight: tapMin, fontSize: fontMd }}>
              <input
                type="checkbox"
                checked={manual[row.key]}
                onChange={(e) => setManual((prev) => ({ ...prev, [row.key]: e.target.checked }))}
              />
              {row.label}
            </label>
          ))}
        </div>
        <div
          style={{
            marginTop: 6,
            paddingTop: 10,
            borderTop: '1px solid rgba(199,206,198,0.16)',
            display: 'grid',
            gap: gapSm,
          }}
        >
          <button
            type="button"
            data-no-drag
            disabled={forceUpdating || isForceUpdateInFlight()}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (forceUpdating || isForceUpdateInFlight()) return
              setForceUpdating(true)
              void forceUpdateApp()
            }}
            style={{
              minHeight: tapMin,
              borderRadius: 8,
              border: '1px solid rgba(125,209,255,0.45)',
              background: 'rgba(125,209,255,0.12)',
              color: '#d8eefc',
              cursor: forceUpdating ? 'wait' : 'pointer',
              fontSize: fontSm,
              letterSpacing: '0.08em',
              fontWeight: 700,
              touchAction: 'manipulation',
              opacity: forceUpdating ? 0.72 : 1,
            }}
          >
            {forceUpdating ? 'UPDATING…' : 'FORCE UPDATE APP'}
          </button>
          <button
            type="button"
            data-no-drag
            onClick={() => void resetAppState()}
            style={{
              minHeight: tapMin,
              borderRadius: 8,
              border: '1px solid rgba(255,107,135,0.4)',
              background: 'rgba(255,107,135,0.12)',
              color: '#ffd5dd',
              cursor: 'pointer',
              fontSize: fontSm,
              letterSpacing: '0.08em',
              fontWeight: 700,
            }}
          >
            RESET APP / FIX ISSUES
          </button>
        </div>
      </div>
    </HudPanel>
  )
}

