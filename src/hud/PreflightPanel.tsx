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
import { forceUpdateApp } from '../utils/forceUpdate'

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
const DEVICE_TUNE_KEY = `${COCKPIT_STORAGE_KEY}_device_tune`

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

function readRapidEndpoint(): string {
  const env = ((import.meta as any).env?.VITE_RAPID_ENDPOINT_URL as string | undefined)?.trim()
  if (env) return env
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      const value = localStorage.getItem(key)
      if (!value) continue
      try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed.heartbeatFnUrl === 'string' && parsed.heartbeatFnUrl.trim()) {
          return parsed.heartbeatFnUrl.trim()
        }
      } catch {
        // noop
      }
    }
  } catch {
    // noop
  }
  return ''
}

export default function PreflightPanel() {
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
  const [manual, setManual] = useState<Record<ManualCheckKey, boolean>>({
    contactsLoaded: false,
    audioAudible: false,
    corridorVerified: false,
    deadmanRenew: false,
    sosDryRun: false,
  })

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
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
    setIsStandalone(standalone)
  }, [recheckTick])

  useEffect(() => {
    let alive = true
    void getPermissionSnapshot().then((snapshot) => {
      if (!alive) return
      setGeoPerm(snapshot.geolocation === 'unsupported' ? 'unknown' : snapshot.geolocation)
      setMicPerm(snapshot.microphone === 'unsupported' ? 'unknown' : snapshot.microphone)
      setNotifPerm(snapshot.notifications)
    })
    return () => {
      alive = false
    }
  }, [recheckTick])

  const savedContactsCount = useMemo(() => {
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

  const endpoint = useMemo(() => readRapidEndpoint(), [])
  const buildId = useMemo(() => ((import.meta as any).env?.VITE_GIT_COMMIT as string | undefined) ?? 'unknown', [])
  const speechSupported = !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  const deviceTuneMeta = useMemo(() => {
    try {
      const raw = localStorage.getItem(DEVICE_TUNE_KEY)
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
        detail: isStandalone ? 'Standalone' : 'Browser tab',
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
        detail: endpoint ? 'Configured' : 'Missing (recommended for live rescue ops)',
        weight: 1.4,
        critical: true,
      },
      {
        label: 'Emergency Contacts',
        state: savedContactsCount > 0 ? 'pass' : 'warn',
        detail: `${savedContactsCount} saved`,
        weight: 1.2,
        critical: true,
      },
    ]
  }, [
    endpoint,
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
    savedContactsCount,
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
    { label: 'Emergency contact loaded', pass: savedContactsCount > 0 },
    { label: 'GPS permission granted', pass: geoPerm === 'granted' },
    { label: 'GPS lock acquired', pass: gpsLock },
    { label: 'Deadman renew verified', pass: manual.deadmanRenew },
    { label: 'SOS dry-run verified', pass: manual.sosDryRun },
  ]
  const hardGatePass = hardGates.every((g) => g.pass)
  const goHold = hardGatePass && score >= 80 ? 'GO' : 'HOLD'
  const goHoldColor = goHold === 'GO' ? '#7dff8a' : '#ff6b87'
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

  const permissionButtonStyle: CSSProperties = {
    minHeight: 38,
    borderRadius: 8,
    border: '1px solid rgba(199,206,198,0.35)',
    background: 'rgba(199,206,198,0.12)',
    color: '#e2e8e2',
    cursor: 'pointer',
    fontSize: 10,
    letterSpacing: '0.06em',
    fontWeight: 700,
  }

  useEffect(() => {
    console.log('[BUILD]', buildId)
  }, [buildId])

  return (
    <HudPanel panelId="preflight" title="Preflight Test" initialPos={{ x: 16, y: 180 }} initialWidth={320}>
      <div style={{ display: 'grid', gap: 8, fontSize: 11 }}>
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
            minHeight: 38,
            borderRadius: 8,
            border: '1px solid rgba(125,255,138,0.45)',
            background: 'rgba(125,255,138,0.14)',
            color: '#d8f8dd',
            cursor: 'pointer',
            fontSize: 11,
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
            minHeight: 38,
            borderRadius: 8,
            border: '1px solid rgba(255,209,102,0.45)',
            background: 'rgba(255,209,102,0.14)',
            color: '#ffe6b3',
            cursor: 'pointer',
            fontSize: 11,
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}
        >
          {requestingPerms ? 'REQUESTING PERMISSIONS…' : 'REQUEST ALL DEVICE PERMISSIONS'}
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
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
          <div style={{ fontSize: 10, color: '#9ea7a0' }}>
            Last recheck: {new Date(lastRecheckAt).toLocaleTimeString()}
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gap: 2,
            fontSize: 10,
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
                gap: 6,
                padding: '5px 4px',
                borderBottom: '1px solid rgba(199,206,198,0.08)',
              }}
            >
              <div>
                <div style={{ color: '#d6ddd6' }}>{check.label}</div>
                <div style={{ color: '#9ea7a0', fontSize: 10 }}>{check.detail}</div>
              </div>
              <div style={{ color: stateColor(check.state), fontWeight: 700, alignSelf: 'center' }}>
                {check.state === 'pass' ? 'PASS' : check.state === 'warn' ? 'WARN' : 'FAIL'}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 10, color: '#9ea7a0', letterSpacing: '0.08em' }}>HARD GATE CHECKS (REQUIRED)</div>
        <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid rgba(199,206,198,0.16)', borderRadius: 8, padding: 6 }}>
          {hardGates.map((gate) => (
            <div
              key={gate.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 6,
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

        <div style={{ fontSize: 10, color: '#9ea7a0', letterSpacing: '0.08em' }}>MANUAL CHECKS</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {manualRows.map((row) => (
            <label key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d6ddd6' }}>
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
            gap: 6,
          }}
        >
          <button
            type="button"
            data-no-drag
            onClick={() => void forceUpdateApp()}
            style={{
              minHeight: 36,
              borderRadius: 8,
              border: '1px solid rgba(125,209,255,0.45)',
              background: 'rgba(125,209,255,0.12)',
              color: '#d8eefc',
              cursor: 'pointer',
              fontSize: 10,
              letterSpacing: '0.08em',
              fontWeight: 700,
            }}
          >
            FORCE UPDATE APP
          </button>
          <button
            type="button"
            data-no-drag
            onClick={() => void resetAppState()}
            style={{
              minHeight: 36,
              borderRadius: 8,
              border: '1px solid rgba(255,107,135,0.4)',
              background: 'rgba(255,107,135,0.12)',
              color: '#ffd5dd',
              cursor: 'pointer',
              fontSize: 10,
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

