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
import { getDeviceProfile } from '../runtime/deviceProfile'
import { getRuntimeSnapshot, subscribeRuntimeSnapshot, updatePermission } from '../runtime/runtimeSnapshot'
import { touchFontSm, touchFontMd, touchGapMd, touchGapSm, touchMinTarget } from './tokens'
import {
  fetchEmergencyContacts,
  createEmergencyContact,
  deleteEmergencyContact,
  updateEmergencyContact,
  type EmergencyContact,
} from '../lib/emergencyContacts'
import { traceAction } from '../runtime/actionTrace'
import { useCockpit } from '../context/CockpitContext'
import { clampMobileToReachableViewport, isPanelReachableInViewport } from '../lib/mobilePanelHelpers'
import { cockpitViewport } from '../lib/viewport'
import { useAppContext } from '../context/AppContext'
import {
  backendReady,
  getSupabaseDiagnostics,
  probeSupabaseReachability,
  type SupabaseEnvReadiness,
} from '../lib/supabase'
import { mergePersistedGeolocationState } from '../lib/permissionRecoveryCopy'

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
const CONTACT_PHONE_STORAGE_KEY = 'hud_emergency_contact_phone_v1'

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
  const { state } = useAppContext()
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
  const [manual, setManual] = useState<Record<ManualCheckKey, boolean>>({
    contactsLoaded: false,
    audioAudible: false,
    corridorVerified: false,
    deadmanRenew: false,
    sosDryRun: false,
  })
  // Single source of truth for backend contacts in this panel. The list
  // drives the readiness rows + the editor list. Status is set to
  // 'unavailable' only when the Supabase fetch genuinely fails (network
  // error, table missing, RLS denial, etc.) — empty arrays are 'ok'.
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [contactsStatus, setContactsStatus] = useState<'loading' | 'ok' | 'unavailable'>('loading')
  const [contactForm, setContactForm] = useState<{
    id: string | null
    name: string
    email: string
    phone: string
    relationship: string
  }>({
    id: null,
    name: '',
    email: '',
    phone: '',
    relationship: '',
  })
  const [contactBusy, setContactBusy] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)
  const [lastContactDiagSig, setLastContactDiagSig] = useState('')
  const [lastEligibilityDiagSig, setLastEligibilityDiagSig] = useState('')
  const [lastVisibilityDiagSig, setLastVisibilityDiagSig] = useState('')
  const [forceUpdateBusy, setForceUpdateBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null)
  const [contactPhoneMap, setContactPhoneMap] = useState<Record<string, string>>({})
  const [runtimeSnap, setRuntimeSnap] = useState(() => getRuntimeSnapshot())
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null)
  const [backendLastCheckedAt, setBackendLastCheckedAt] = useState<number | null>(null)
  const [backendEnvReadiness, setBackendEnvReadiness] = useState<SupabaseEnvReadiness>(
    getSupabaseDiagnostics().envReadiness,
  )

  const persistContactPhoneMap = (next: Record<string, string>) => {
    setContactPhoneMap(next)
    try {
      localStorage.setItem(CONTACT_PHONE_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // noop
    }
  }

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
      const raw = localStorage.getItem(CONTACT_PHONE_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, string> | null
      if (!parsed || typeof parsed !== 'object') return
      setContactPhoneMap(parsed)
    } catch {
      // noop
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const sig = `${contactsStatus}:${contacts.length}:${contactError ?? ''}`
    if (sig === lastContactDiagSig) return
    setLastContactDiagSig(sig)
    console.info('[HUD DEV] contact-hydration', {
      status: contactsStatus,
      hydratedCount: contacts.length,
      validationReason: contactError ?? null,
    })
  }, [contactsStatus, contacts.length, contactError, lastContactDiagSig])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const t = window.setTimeout(() => {
      console.log('[CONTACT FORM STATE]', {
        name: contactForm.name,
        email: contactForm.email,
        phone: contactForm.phone,
        relationship: contactForm.relationship,
      })
    }, 320)
    return () => window.clearTimeout(t)
  }, [contactForm])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const profile = getDeviceProfile()
    const layout = panels.preflight
    const { vw, vh } = cockpitViewport()
    const pos = { x: layout?.x ?? 0, y: layout?.y ?? 0 }
    const size = { w: layout?.w ?? 320, h: layout?.h ?? 300 }
    const reachable = isPanelReachableInViewport(pos, size, { vw, vh }, 36)
    const sig = `${profile.interactionMode}:${Boolean(layout)}:${layout?.docked ?? false}:${layout?.minimized ?? false}:${reachable}:${layout?.z ?? 0}`
    if (sig === lastVisibilityDiagSig) return
    setLastVisibilityDiagSig(sig)
    console.info('[HUD DEV] emergency-panel-visibility', {
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
    if (import.meta.env.DEV) {
      console.info('[HUD DEV] emergency-panel-recovery', {
        panel: 'preflight',
        reason: 'offscreen_or_unreachable',
        from: { x: layout.x, y: layout.y },
        to: reachable,
      })
    }
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

  // Load backend contacts once on mount. No polling, no timer. Refresh on
  // explicit operator action (after add/delete). Failures collapse to
  // 'unavailable' — never crash the HUD.
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info('[HUD DEV] emergency-config-panel-mounted', {
        panel: 'preflight',
        interactionMode: getDeviceProfile().interactionMode,
      })
    }
    let alive = true
    void fetchEmergencyContacts()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) {
          setContactsStatus('unavailable')
          return
        }
        setContacts(data)
        setContactsStatus('ok')
      })
      .catch(() => {
        if (!alive) return
        setContactsStatus('unavailable')
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    void getPermissionSnapshot().then((snapshot) => {
      if (!alive) return
      let persistedGps: string | null = null
      try {
        persistedGps = localStorage.getItem('gpsPermission')
      } catch {
        persistedGps = null
      }
      const rawGeo = snapshot.geolocation
      const geoQuery = rawGeo === 'unsupported' ? 'unknown' : rawGeo
      const geoMerged = mergePersistedGeolocationState(geoQuery, persistedGps)
      const geoForUi = geoMerged === 'unsupported' ? 'unknown' : geoMerged
      setGeoPerm(geoForUi)
      setMicPerm(snapshot.microphone === 'unsupported' ? 'unknown' : snapshot.microphone)
      setNotifPerm(snapshot.notifications)
      updatePermission('geolocation', geoMerged as never)
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

  const endpoint = useMemo(() => readRapidEndpoint(), [])
  const compileBuild = useMemo(
    () => (typeof __BUILD_ID__ === 'string' && __BUILD_ID__.length > 0 ? __BUILD_ID__ : 'unknown'),
    [],
  )
  const runtimeBuild = runtimeSnap.buildId || 'unknown'
  const preflightBuild = runtimeBuild
  const overlayBuild = runtimeSnap.buildId || 'unknown'
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
        label: 'Contacts Loaded',
        state: contactsStatus === 'ok' && contacts.length > 0 ? 'pass' : 'warn',
        detail: contactsStatus === 'ok' ? `${contacts.length} loaded` : 'Not loaded',
        weight: 1.1,
        critical: true,
      },
      {
        label: 'Routes Selected',
        state: state.waypoints.length > 0 ? 'pass' : 'warn',
        detail: state.waypoints.length > 0 ? `${state.waypoints.length} selected` : 'No route selected',
        weight: 0.9,
      },
      {
        label: 'Emergency Contacts Saved',
        state: contactsStatus === 'ok' && contacts.length > 0 ? 'pass' : 'warn',
        detail: contactsStatus === 'ok' ? `${contacts.length} saved` : 'Unavailable',
        weight: 1.1,
        critical: true,
      },
      {
        label: 'Emergency Contacts',
        state: contactsStatus === 'ok' && contacts.length > 0 ? 'pass' : 'warn',
        detail:
          contactsStatus === 'unavailable'
            ? 'Backend unavailable'
            : `${contacts.length} loaded`,
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
    contactsStatus,
    contacts.length,
    state.waypoints.length,
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
    { label: 'Emergency contact loaded', pass: contactsStatus === 'ok' && contacts.length > 0 },
    { label: 'GPS permission granted', pass: geoPerm === 'granted' },
    { label: 'GPS lock acquired', pass: gpsLock },
    { label: 'Deadman renew verified', pass: manual.deadmanRenew },
    { label: 'SOS dry-run verified', pass: manual.sosDryRun },
  ]
  const hardGatePass = hardGates.every((g) => g.pass)
  const goHold = hardGatePass && score >= 80 ? 'GO' : 'HOLD'
  const goHoldColor = goHold === 'GO' ? '#7dff8a' : '#ff6b87'

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const sig = `${contactsStatus}:${contacts.length}:${Boolean(endpoint)}`
    if (sig === lastEligibilityDiagSig) return
    setLastEligibilityDiagSig(sig)
    console.info('[HUD DEV] rescue-eligibility-state', {
      contactsStatus,
      hydratedContacts: contacts.length,
      endpointConfigured: Boolean(endpoint),
      eligible:
        contactsStatus === 'ok' &&
        contacts.length > 0 &&
        Boolean(endpoint),
    })
  }, [contactsStatus, contacts.length, endpoint, lastEligibilityDiagSig])
  const runAutoRecheck = () => {
    setRecheckTick((v) => v + 1)
    setLastRecheckAt(Date.now())
  }

  // Operator actions on the backend contact roster. Both handlers gate on
  // contactBusy to prevent overlapping requests and update local state
  // optimistically (or refetch) so the readiness rows stay in sync.
  const reloadContacts = async (): Promise<void> => {
    const { data, error } = await fetchEmergencyContacts()
    if (error) {
      setContactsStatus('unavailable')
      return
    }
    setContacts(data)
    setContactsStatus('ok')
    if (import.meta.env.DEV) console.log('[EmergencyContacts] loaded', data)
  }

  const handleAddContact = async () => {
    traceAction('emergency_contact_add', 'handler_enter')
    if (contactBusy) {
      traceAction('emergency_contact_add', 'guard_reject', { reason: 'busy' })
      return
    }
    const name = contactForm.name.trim()
    const email = contactForm.email.trim()
    const relationship = contactForm.relationship.trim()
    const phone = contactForm.phone.trim()
    if (!name || !email) {
      setContactError('Name and email required')
      traceAction('emergency_contact_add', 'guard_reject', { reason: 'validation_missing_fields' })
      if (import.meta.env.DEV) {
        console.log('[ADD CONTACT FLOW]', {
          backendReady,
          payload: { name, email, phone, relationship, id: contactForm.id },
          validationPassed: false,
          supabaseCalled: false,
          error: 'validation_missing_fields',
        })
      }
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setContactError('Invalid email format')
      traceAction('emergency_contact_add', 'guard_reject', { reason: 'validation_invalid_email' })
      if (import.meta.env.DEV) {
        console.log('[ADD CONTACT FLOW]', {
          backendReady,
          payload: { name, email, phone, relationship, id: contactForm.id },
          validationPassed: false,
          supabaseCalled: false,
          error: 'validation_invalid_email',
        })
      }
      return
    }
    setContactBusy(true)
    setContactError(null)
    traceAction('emergency_contact_add', 'async_start')
    if (import.meta.env.DEV) {
      console.log('[ADD CONTACT FLOW]', {
        backendReady,
        payload: { name, email, phone, relationship, id: contactForm.id },
        validationPassed: true,
        supabaseCalled: true,
        error: null,
      })
    }
    const action = contactForm.id
      ? updateEmergencyContact(contactForm.id, {
          contact_name: name,
          email,
          relationship: relationship || null,
        })
      : createEmergencyContact({
          contact_name: name,
          email,
          relationship: relationship || null,
          // First contact added becomes priority 1 (primary); subsequent get 2.
          priority: contacts.length === 0 ? 1 : 2,
        })
    const { error } = await action
    if (error) {
      setContactError(error.message)
      traceAction('emergency_contact_add', 'failure', { reason: 'backend_error' })
      if (import.meta.env.DEV) {
        console.log('[ADD CONTACT FLOW]', {
          backendReady,
          payload: { name, email, phone, relationship, id: contactForm.id },
          validationPassed: true,
          supabaseCalled: true,
          error: error.message,
        })
      }
      setContactBusy(false)
      return
    }
    if (contactForm.id) {
      persistContactPhoneMap({ ...contactPhoneMap, [contactForm.id]: phone })
    }
    setContactForm({ id: null, name: '', email: '', phone: '', relationship: '' })
    await reloadContacts()
    if (import.meta.env.DEV) {
      console.log('[EmergencyContacts] saved count', contacts.length + (contactForm.id ? 0 : 1))
      console.log('[ADD CONTACT FLOW]', {
        backendReady,
        payload: { name, email, phone, relationship },
        validationPassed: true,
        supabaseCalled: true,
        error: null,
        result: 'success',
      })
    }
    traceAction('emergency_contact_add', 'async_complete', { hydratedCount: contacts.length + 1 })
    setContactBusy(false)
  }

  const handleDeleteContact = async (id: string) => {
    traceAction('emergency_contact_remove', 'handler_enter')
    if (contactBusy) {
      traceAction('emergency_contact_remove', 'guard_reject', { reason: 'busy' })
      return
    }
    setContactBusy(true)
    setContactError(null)
    traceAction('emergency_contact_remove', 'async_start')
    const { error } = await deleteEmergencyContact(id)
    if (error) {
      setContactError(error.message)
      traceAction('emergency_contact_remove', 'failure', { reason: 'backend_error' })
      setContactBusy(false)
      return
    }
    setContacts((prev) => prev.filter((c) => c.id !== id))
    const nextPhones = { ...contactPhoneMap }
    delete nextPhones[id]
    persistContactPhoneMap(nextPhones)
    if (import.meta.env.DEV) {
      console.log('[EmergencyContacts] saved count', Math.max(0, contacts.length - 1))
    }
    traceAction('emergency_contact_remove', 'async_complete', { removed: true })
    setContactBusy(false)
  }

  const startEditContact = (c: EmergencyContact) => {
    setContactForm({
      id: c.id,
      name: c.contact_name,
      email: c.email,
      phone: contactPhoneMap[c.id] ?? '',
      relationship: c.relationship ?? '',
    })
    setContactError(null)
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

  const handleForceUpdate = async () => {
    if (forceUpdateBusy || resetBusy) return
    setForceUpdateBusy(true)
    setRecoveryStatus('Checking for runtime update…')
    try {
      const snap = getRuntimeSnapshot()
      const beforeBuild = snap.buildId
      const networkBuild = snap.deploymentIntegrity.latestBuildId
      const reloadReason =
        snap.deploymentIntegrity.staleStatus === 'stale_detected'
          ? 'recovery_reload'
          : 'force_update'
      if (import.meta.env.DEV) {
        console.table({
          beforeBuild,
          afterBuild: 'pending_reload',
          networkBuild: networkBuild ?? 'unknown',
          updateTriggered: true,
          reloadReason,
        })
      }
      const result = await forceUpdateApp()
      if (!result.ok) {
        setRecoveryStatus(result.message)
      } else if (runtimeSnap.deploymentIntegrity.staleStatus === 'fresh') {
        setRecoveryStatus('Already on latest build')
      } else {
        setRecoveryStatus(result.message)
      }
    } catch (err) {
      console.warn('[ForceUpdate] handler error', err)
      setRecoveryStatus('Force update failed before reload')
    } finally {
      window.setTimeout(() => setForceUpdateBusy(false), 1200)
    }
  }

  const handleResetApp = async () => {
    if (resetBusy || forceUpdateBusy) return
    setResetBusy(true)
    setRecoveryStatus('Running app reset…')
    try {
      const result = await resetAppState()
      setRecoveryStatus(result.message)
    } catch (err) {
      console.warn('[ResetApp] handler error', err)
      setRecoveryStatus('Reset failed before reload')
    } finally {
      window.setTimeout(() => setResetBusy(false), 1200)
    }
  }

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const hostLc = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : ''
  const deploymentProvider =
    hostLc.includes('vercel.app') ? 'vercel' : hostLc === 'localhost' || hostLc === '127.0.0.1' ? 'local' : 'hosted'
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
    return subscribeRuntimeSnapshot((snap) => setRuntimeSnap({ ...snap }))
  }, [])

  useEffect(() => {
    const diag = getSupabaseDiagnostics()
    setBackendEnvReadiness(diag.envReadiness)
    void probeSupabaseReachability().then((ok) => {
      setBackendReachable(ok)
      setBackendLastCheckedAt(Date.now())
    })
  }, [recheckTick])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.log('[BuildSource]', {
      compileBuild,
      runtimeBuild,
      preflightBuild,
      overlayBuild,
    })
  }, [compileBuild, runtimeBuild, preflightBuild, overlayBuild])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.count('[PreflightPanel render]')
    const layout = panels.preflight
    if (!layout) return
    console.log('[PreflightPanel dimensions]', {
      w: layout.w,
      h: layout.h ?? null,
      x: layout.x,
      y: layout.y,
      docked: layout.docked,
      minimized: layout.minimized,
    })
  }, [panels.preflight])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('hud_force_update_result_v1')
      if (!raw) return
      sessionStorage.removeItem('hud_force_update_result_v1')
      const parsed = JSON.parse(raw) as {
        beforeBuild?: string
        afterBuild?: string
        networkBuild?: string | null
        reloadReason?: string
      }
      if (parsed.reloadReason === 'already_latest') {
        setRecoveryStatus('Already on latest build')
      } else if (
        typeof parsed.beforeBuild === 'string' &&
        typeof parsed.afterBuild === 'string' &&
        parsed.beforeBuild !== parsed.afterBuild
      ) {
        setRecoveryStatus(`Updated from ${parsed.beforeBuild.slice(0, 19)} -> ${parsed.afterBuild.slice(0, 19)}`)
      } else if (parsed.reloadReason === 'recovery_reload') {
        setRecoveryStatus('Recovery reload executed')
      } else {
        setRecoveryStatus('Reload executed; build unchanged (already latest deploy)')
      }
    } catch {
      // ignore
    }
  }, [])

  const supabaseDiag = getSupabaseDiagnostics()

  return (
    <HudPanel panelId="preflight" title="Preflight Test" initialPos={{ x: 16, y: 180 }} initialWidth={320}>
      <div style={{ display: 'grid', gap: gapMd, fontSize: fontSm }}>
        <div
          style={{
            display: 'grid',
            gap: 2,
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid rgba(125,209,255,0.38)',
            background: 'rgba(125,209,255,0.12)',
            color: '#d8eefc',
          }}
        >
          <div>
            <strong>
              Running on{' '}
              {deploymentProvider === 'vercel'
                ? 'Vercel'
                : deploymentProvider === 'local'
                  ? 'Local dev'
                  : 'Hosted'}
            </strong>
          </div>
          <div>
            build <strong>{runtimeBuild.slice(0, 19)}</strong> • origin <strong>{window.location.origin}</strong>
          </div>
          <div>
            SW <strong>{runtimeSnap.serviceWorker.status}</strong> • cache generation{' '}
            <strong>{runtimeSnap.deploymentIntegrity.cacheGeneration || 'none'}</strong>
          </div>
          <div>
            backend configured <strong>{supabaseDiag.backendConfigured ? 'yes' : 'no'}</strong> • reachable{' '}
            <strong>{backendReachable == null ? 'unknown' : backendReachable ? 'yes' : 'no'}</strong>
          </div>
          <div>
            env readiness <strong>{backendEnvReadiness}</strong> • provider{' '}
            <strong>{deploymentProvider}</strong>
          </div>
          {!supabaseDiag.backendConfigured ? (
            <div style={{ fontSize: fontSm, lineHeight: 1.45, opacity: 0.95 }}>
              {supabaseDiag.deployEnvHint}
            </div>
          ) : null}
          <div>
            build <strong>{runtimeBuild.slice(0, 19)}</strong> • backend check{' '}
            <strong>{backendLastCheckedAt ? new Date(backendLastCheckedAt).toLocaleTimeString() : 'pending'}</strong>
          </div>
        </div>
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
              if (import.meta.env.DEV) {
                console.info('[HUD DEV] emergency-panel-recovery', {
                  panel: 'preflight',
                  reason: 'operator_reachability_action',
                  to: next,
                })
              }
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
            Build: <strong style={{ color: '#d6ddd6' }}>{runtimeBuild}</strong>
          </div>
          <div>
            Status:{' '}
            <strong style={{ color: '#d6ddd6' }}>
              Build {runtimeBuild.slice(0, 19)} • SW {runtimeSnap.serviceWorker.status} • Freshness{' '}
              {runtimeSnap.deploymentIntegrity.staleStatus}
            </strong>
          </div>
          <div>
            SW state: <strong style={{ color: '#d6ddd6' }}>{runtimeSnap.serviceWorker.status}</strong>
          </div>
          <div>
            Stale status:{' '}
            <strong style={{ color: '#d6ddd6' }}>{runtimeSnap.deploymentIntegrity.staleStatus}</strong>
          </div>
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

        <div style={{ fontSize: fontSm, color: '#9ea7a0', letterSpacing: '0.08em' }}>BACKEND CONTACTS</div>
        <div style={{ border: '1px solid rgba(199,206,198,0.16)', borderRadius: 8, padding: 6, display: 'grid', gap: gapSm }}>
          {contactsStatus === 'loading' && (
            <div style={{ color: '#9ea7a0', fontSize: fontSm, padding: '4px 4px' }}>Loading…</div>
          )}
          {contactsStatus === 'unavailable' && (
            <div style={{ color: stateColor('warn'), fontSize: fontSm, padding: '4px 4px', lineHeight: 1.45 }}>
              Could not load contacts from Supabase (network, RLS, or table error). Check the browser console for{' '}
              <code>[SYSTEM TRACE]</code> steps. You can still edit the form; retry after fixing the backend.
            </div>
          )}
          {contactsStatus === 'ok' && contacts.length === 0 && (
            <div style={{ color: '#9ea7a0', fontSize: fontSm, padding: '4px 4px' }}>
              No contacts on file
            </div>
          )}
          {contactsStatus === 'ok' && contacts.length > 0 && (
            <div style={{ display: 'grid', gap: 2 }}>
              {contacts.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: gapSm,
                    padding: '5px 4px',
                    borderBottom: '1px solid rgba(199,206,198,0.08)',
                  }}
                >
                  <div>
                    <div style={{ color: '#d6ddd6' }}>
                      {c.contact_name}
                      {(c.priority ?? 1) === 1 ? <span style={{ color: '#9ea7a0' }}> · primary</span> : null}
                    </div>
                    <div style={{ color: '#9ea7a0', fontSize: fontSm }}>
                      {c.email}
                      {contactPhoneMap[c.id] ? ` · ${contactPhoneMap[c.id]}` : ''}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <button
                      type="button"
                      data-no-drag
                      disabled={contactBusy}
                      onClick={() => startEditContact(c)}
                      style={{
                        minHeight: tapMin,
                        borderRadius: 6,
                        border: '1px solid rgba(125,209,255,0.45)',
                        background: 'rgba(125,209,255,0.12)',
                        color: '#d8eefc',
                        cursor: contactBusy ? 'wait' : 'pointer',
                        fontSize: fontSm,
                        letterSpacing: '0.08em',
                        fontWeight: 700,
                        padding: '0 10px',
                      }}
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      data-no-drag
                      disabled={contactBusy}
                      onClick={() => void handleDeleteContact(c.id)}
                      style={{
                        minHeight: tapMin,
                        borderRadius: 6,
                        border: '1px solid rgba(255,107,135,0.45)',
                        background: 'rgba(255,107,135,0.12)',
                        color: '#ffd5dd',
                        cursor: contactBusy ? 'wait' : 'pointer',
                        fontSize: fontSm,
                        letterSpacing: '0.08em',
                        fontWeight: 700,
                        padding: '0 10px',
                      }}
                    >
                      REMOVE
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Add-contact form (operator-driven, gated by contactBusy) ── */}
          <div style={{ display: 'grid', gap: gapSm, paddingTop: 4 }}>
            <input
              type="text"
              data-no-drag
              placeholder="Contact name"
              value={contactForm.name}
              onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))}
              disabled={contactBusy}
              style={{
                minHeight: tapMin,
                borderRadius: 6,
                border: '1px solid rgba(199,206,198,0.28)',
                background: 'rgba(10,12,13,0.8)',
                color: '#d3dad3',
                padding: '0 10px',
                fontSize: fontMd,
              }}
            />
            <input
              type="email"
              data-no-drag
              placeholder="Email"
              value={contactForm.email}
              onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
              disabled={contactBusy}
              style={{
                minHeight: tapMin,
                borderRadius: 6,
                border: '1px solid rgba(199,206,198,0.28)',
                background: 'rgba(10,12,13,0.8)',
                color: '#d3dad3',
                padding: '0 10px',
                fontSize: fontMd,
              }}
            />
            <input
              type="tel"
              data-no-drag
              placeholder="Phone (optional)"
              value={contactForm.phone}
              onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))}
              disabled={contactBusy}
              style={{
                minHeight: tapMin,
                borderRadius: 6,
                border: '1px solid rgba(199,206,198,0.28)',
                background: 'rgba(10,12,13,0.8)',
                color: '#d3dad3',
                padding: '0 10px',
                fontSize: fontMd,
              }}
            />
            <input
              type="text"
              data-no-drag
              placeholder="Relationship (optional)"
              value={contactForm.relationship}
              onChange={(e) => setContactForm((f) => ({ ...f, relationship: e.target.value }))}
              disabled={contactBusy}
              style={{
                minHeight: tapMin,
                borderRadius: 6,
                border: '1px solid rgba(199,206,198,0.28)',
                background: 'rgba(10,12,13,0.8)',
                color: '#d3dad3',
                padding: '0 10px',
                fontSize: fontMd,
              }}
            />
            <button
              type="button"
              data-no-drag
              onClick={() => void handleAddContact()}
              disabled={contactBusy}
              style={{
                minHeight: tapMin,
                borderRadius: 8,
                border: '1px solid rgba(125,255,138,0.45)',
                background: 'rgba(125,255,138,0.14)',
                color: '#d8f8dd',
                cursor: contactBusy ? 'wait' : 'pointer',
                fontSize: fontSm,
                letterSpacing: '0.08em',
                fontWeight: 700,
              }}
            >
              {contactBusy ? 'SAVING…' : contactForm.id ? 'SAVE CONTACT' : 'ADD CONTACT'}
            </button>
            {!backendReady ? (
              <div style={{ color: '#a9c4a9', fontSize: fontSm, lineHeight: 1.45 }}>
                Supabase is not configured for this build — contacts are saved to <strong>this device only</strong>{' '}
                (local roster). For cloud sync and multi-device SOS, add{' '}
                <code style={{ fontSize: '0.85em' }}>VITE_SUPABASE_URL</code> and{' '}
                <code style={{ fontSize: '0.85em' }}>VITE_SUPABASE_ANON_KEY</code> in your host env and redeploy.
              </div>
            ) : null}
            {contactForm.id && (
              <button
                type="button"
                data-no-drag
                onClick={() => setContactForm({ id: null, name: '', email: '', phone: '', relationship: '' })}
                disabled={contactBusy}
                style={{
                  minHeight: tapMin,
                  borderRadius: 8,
                  border: '1px solid rgba(199,206,198,0.35)',
                  background: 'rgba(199,206,198,0.12)',
                  color: '#d8e3d8',
                  cursor: 'pointer',
                  fontSize: fontSm,
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                }}
              >
                CANCEL EDIT
              </button>
            )}
            {contactError && (
              <div style={{ color: stateColor('fail'), fontSize: fontSm }}>{contactError}</div>
            )}
          </div>

          {/* ── Readiness indicators driven by the live contact list ── */}
          {(() => {
            const count = contacts.length
            const hasPrimary = contacts.some((c) => (c.priority ?? 1) === 1)
            const escalation = count >= 2
            type Row = { label: string; state: CheckState; detail: string }
            const rows: Row[] = (() => {
              if (contactsStatus === 'loading') {
                return [
                  { label: 'Emergency contacts configured', state: 'warn', detail: 'Loading…' },
                  { label: 'Primary contact available', state: 'warn', detail: 'Loading…' },
                  { label: 'Rescue escalation available', state: 'warn', detail: 'Loading…' },
                ]
              }
              if (contactsStatus === 'unavailable') {
                return [
                  { label: 'Backend unavailable', state: 'warn', detail: 'Supabase fetch failed' },
                  { label: 'Primary contact available', state: 'warn', detail: 'Cannot verify (backend unavailable)' },
                  { label: 'Rescue escalation available', state: 'warn', detail: 'Cannot verify (backend unavailable)' },
                ]
              }
              return [
                {
                  label: count > 0 ? 'Emergency contacts configured' : 'No emergency contacts configured',
                  state: count > 0 ? 'pass' : 'warn',
                  detail: count > 0 ? `${count} on file` : 'Add at least one above',
                },
                {
                  label: 'Primary contact available',
                  state: hasPrimary ? 'pass' : 'warn',
                  detail: hasPrimary ? 'Priority 1 set' : 'No priority-1 contact',
                },
                {
                  label: 'Rescue escalation available',
                  state: escalation ? 'pass' : 'warn',
                  detail: escalation ? '2+ contacts (chain ready)' : 'Need 2+ contacts',
                },
              ]
            })()
            return (
              <div style={{ display: 'grid', gap: 2, paddingTop: 4 }}>
                {rows.map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: gapSm,
                      padding: '5px 4px',
                      borderBottom: '1px solid rgba(199,206,198,0.08)',
                    }}
                  >
                    <div>
                      <div style={{ color: '#d6ddd6' }}>{row.label}</div>
                      <div style={{ color: '#9ea7a0', fontSize: fontSm }}>{row.detail}</div>
                    </div>
                    <div style={{ color: stateColor(row.state), fontWeight: 700, alignSelf: 'center' }}>
                      {row.state === 'pass' ? 'PASS' : row.state === 'warn' ? 'WARN' : 'FAIL'}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
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
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255,209,102,0.35)',
            background: 'rgba(255,209,102,0.1)',
            color: '#ffe6b3',
            fontSize: fontSm,
            lineHeight: 1.5,
          }}
        >
          Android migration safety flow: uninstall old Netlify-installed PWA, clear old Netlify site storage, open the
          Vercel URL in Chrome, verify the provider banner/build ID/origin above, then install the fresh Vercel PWA.
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
            onClick={() => void handleForceUpdate()}
            disabled={forceUpdateBusy || resetBusy}
            style={{
              minHeight: tapMin,
              borderRadius: 8,
              border: '1px solid rgba(125,209,255,0.45)',
              background: 'rgba(125,209,255,0.12)',
              color: '#d8eefc',
              cursor: forceUpdateBusy || resetBusy ? 'wait' : 'pointer',
              fontSize: fontSm,
              letterSpacing: '0.08em',
              fontWeight: 700,
              opacity: forceUpdateBusy || resetBusy ? 0.8 : 1,
            }}
          >
            {forceUpdateBusy ? 'FORCE UPDATE IN PROGRESS…' : 'FORCE UPDATE APP'}
          </button>
          <button
            type="button"
            data-no-drag
            onClick={() => void handleResetApp()}
            disabled={resetBusy || forceUpdateBusy}
            style={{
              minHeight: tapMin,
              borderRadius: 8,
              border: '1px solid rgba(255,107,135,0.4)',
              background: 'rgba(255,107,135,0.12)',
              color: '#ffd5dd',
              cursor: resetBusy || forceUpdateBusy ? 'wait' : 'pointer',
              fontSize: fontSm,
              letterSpacing: '0.08em',
              fontWeight: 700,
              opacity: resetBusy || forceUpdateBusy ? 0.8 : 1,
            }}
          >
            {resetBusy ? 'RESET IN PROGRESS…' : 'RESET APP / FIX ISSUES'}
          </button>
          {recoveryStatus && (
            <div style={{ color: '#9ea7a0', fontSize: fontSm }}>
              {recoveryStatus}
            </div>
          )}
        </div>
      </div>
    </HudPanel>
  )
}

