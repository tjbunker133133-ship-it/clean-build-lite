import { useEffect, useMemo, useState } from 'react'
import HudPanel from './HudPanel'
import { useGPS } from '../hooks/useGPS'

type CheckState = 'pass' | 'warn' | 'fail'
type ManualCheckKey = 'contactsLoaded' | 'audioAudible' | 'corridorVerified' | 'sosDryRun'

type CheckRow = {
  label: string
  state: CheckState
  detail: string
}

const MANUAL_KEY = 'tactical_preflight_manual_v1'

function stateColor(state: CheckState) {
  if (state === 'pass') return '#7dff8a'
  if (state === 'warn') return '#ffd166'
  return '#ff6b87'
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
  const [isStandalone, setIsStandalone] = useState(false)
  const [recheckTick, setRecheckTick] = useState(0)
  const [lastRecheckAt, setLastRecheckAt] = useState<number | null>(null)
  const [manual, setManual] = useState<Record<ManualCheckKey, boolean>>({
    contactsLoaded: false,
    audioAudible: false,
    corridorVerified: false,
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
    if (!navigator.permissions?.query) return
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        if (!alive) return
        setGeoPerm(s.state)
      })
      .catch(() => {
        if (alive) setGeoPerm('unknown')
      })
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((s) => {
        if (!alive) return
        setMicPerm(s.state)
      })
      .catch(() => {
        if (alive) setMicPerm('unknown')
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
  const speechSupported = !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  const checks: CheckRow[] = useMemo(() => {
    const gpsLock = gps.lat != null && gps.lng != null
    return [
      {
        label: 'Network',
        state: online ? 'pass' : 'warn',
        detail: online ? 'Online' : 'Offline mode',
      },
      {
        label: 'PWA Install',
        state: isStandalone ? 'pass' : 'warn',
        detail: isStandalone ? 'Standalone' : 'Browser tab',
      },
      {
        label: 'GPS Permission',
        state: geoPerm === 'granted' ? 'pass' : geoPerm === 'prompt' ? 'warn' : 'fail',
        detail: geoPerm,
      },
      {
        label: 'GPS Lock',
        state: gpsLock ? 'pass' : 'warn',
        detail: gpsLock ? `Lat ${gps.lat?.toFixed(5)} / Lng ${gps.lng?.toFixed(5)}` : 'Awaiting fix',
      },
      {
        label: 'Mic Permission',
        state: micPerm === 'granted' ? 'pass' : micPerm === 'prompt' ? 'warn' : 'fail',
        detail: micPerm,
      },
      {
        label: 'Voice Recognition',
        state: speechSupported ? 'pass' : 'warn',
        detail: speechSupported ? 'Supported' : 'Fallback typed mode',
      },
      {
        label: 'Rescue Endpoint',
        state: endpoint ? 'pass' : 'fail',
        detail: endpoint ? 'Configured' : 'Missing',
      },
      {
        label: 'Emergency Contacts',
        state: savedContactsCount > 0 ? 'pass' : 'warn',
        detail: `${savedContactsCount} saved`,
      },
    ]
  }, [endpoint, geoPerm, gps.lat, gps.lng, isStandalone, micPerm, online, savedContactsCount, speechSupported, recheckTick])

  const passCount = checks.filter((c) => c.state === 'pass').length
  const manualPass = Object.values(manual).filter(Boolean).length
  const total = checks.length + 4
  const score = Math.round(((passCount + manualPass) / total) * 100)
  const runAutoRecheck = () => {
    setRecheckTick((v) => v + 1)
    setLastRecheckAt(Date.now())
  }

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
        {lastRecheckAt != null && (
          <div style={{ fontSize: 10, color: '#9ea7a0' }}>
            Last recheck: {new Date(lastRecheckAt).toLocaleTimeString()}
          </div>
        )}

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

        <div style={{ fontSize: 10, color: '#9ea7a0', letterSpacing: '0.08em' }}>MANUAL CHECKS</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {(
            [
              ['contactsLoaded', 'Contacts loaded and route-selected'],
              ['audioAudible', 'Alarm is clearly audible on device'],
              ['corridorVerified', 'Corridor warning verified with live GPS'],
              ['sosDryRun', 'SOS dry-run + disarm tested'],
            ] as Array<[ManualCheckKey, string]>
          ).map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d6ddd6' }}>
              <input
                type="checkbox"
                checked={manual[key]}
                onChange={(e) => setManual((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </HudPanel>
  )
}

