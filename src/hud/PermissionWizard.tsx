import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GPSData } from '../hooks/useGPS'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchFontMd, touchGapMd, touchGapSm, touchMinTarget } from './tokens'
import {
  getPermissionSnapshot,
  requestCameraPermission,
  requestGeolocationPermission,
  requestMicrophonePermission,
  requestMotionPermission,
  requestNotificationPermission,
  requestOrientationPermission,
  type PermissionStateLike,
} from '../lib/devicePermissions'
import {
  androidLocationFixClipboardLines,
  copyTextToClipboard,
  safariLocationFixClipboardLines,
  tryOpenAndroidLocationSettings,
  tryOpenIosLocationPrivacySettings,
  tryOpenIosLocationPrivacySettingsAlternate,
} from '../lib/systemSettingsLinks'
import { traceAction } from '../runtime/actionTrace'

export type WizardStepId =
  | 'intro'
  | 'location'
  | 'microphone'
  | 'camera'
  | 'notifications'
  | 'orientation'
  | 'motion'
  | 'done'

type Props = {
  visible: boolean
  geo: PermissionStateLike
  mic: PermissionStateLike
  camera: PermissionStateLike
  notif: PermissionStateLike
  orient: PermissionStateLike
  motion: PermissionStateLike
  setGeo: (s: PermissionStateLike) => void
  setMic: (s: PermissionStateLike) => void
  setCamera: (s: PermissionStateLike) => void
  setNotif: (s: PermissionStateLike) => void
  setOrient: (s: PermissionStateLike) => void
  setMotion: (s: PermissionStateLike) => void
  gps: GPSData
  isAppleMobile: boolean
  isAndroid: boolean
  platformHint: string
  locationDenied: boolean
  allRequested: boolean
  busy: boolean
  setBusy: (v: boolean) => void
  onClose: () => void
  onResetApp: () => void
}

function makeBtnBase(isMobile: boolean): React.CSSProperties {
  return {
    minHeight: Math.max(touchMinTarget(isMobile), 42),
    borderRadius: 8,
    border: '1px solid rgba(199,206,198,0.35)',
    background: 'rgba(199,206,198,0.12)',
    color: '#e2e8e2',
    fontSize: touchFontSm(isMobile),
    fontWeight: 700,
    letterSpacing: '0.08em',
    cursor: 'pointer',
    padding: '0 14px',
  }
}

function hasOrientationRequest(): boolean {
  return typeof (DeviceOrientationEvent as any)?.requestPermission === 'function'
}

function hasMotionRequest(): boolean {
  return typeof (DeviceMotionEvent as any)?.requestPermission === 'function'
}

function stateLabel(s: PermissionStateLike): string {
  if (s === 'granted') return 'GRANTED'
  if (s === 'denied') return 'DENIED'
  if (s === 'unsupported') return 'N/A'
  if (s === 'prompt') return 'ASK'
  return '…'
}

export default function PermissionWizard({
  visible,
  geo,
  mic,
  camera,
  notif,
  orient,
  motion,
  setGeo,
  setMic,
  setCamera,
  setNotif,
  setOrient,
  setMotion,
  gps,
  isAppleMobile,
  isAndroid,
  platformHint,
  locationDenied,
  allRequested,
  busy,
  setBusy,
  onClose,
  onResetApp,
}: Props) {
  const steps = useMemo(() => {
    const s: WizardStepId[] = ['intro', 'location', 'microphone', 'camera', 'notifications']
    if (hasOrientationRequest()) s.push('orientation')
    if (hasMotionRequest()) s.push('motion')
    s.push('done')
    return s
  }, [])

  const [stepIndex, setStepIndex] = useState(0)
  const [attempted, setAttempted] = useState<Partial<Record<WizardStepId, boolean>>>({})
  const [linkHint, setLinkHint] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [settingsFallback, setSettingsFallback] = useState<string | null>(null)
  const showSettingsFallback = useCallback(
    (msg: string) => setSettingsFallback(msg),
    [],
  )

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const gapSm = touchGapSm(isMobile)
  const tapMin = touchMinTarget(isMobile)
  const btnBase = makeBtnBase(isMobile)

  useEffect(() => {
    if (visible) {
      setStepIndex(0)
      setAttempted({})
      setLinkHint(null)
      setShowAdvanced(false)
    }
  }, [visible])

  const stepId = steps[Math.min(stepIndex, steps.length - 1)] ?? 'intro'
  const total = steps.length
  const stepNum = stepIndex + 1

  const refreshSnapshot = useCallback(() => {
    void getPermissionSnapshot().then((s) => {
      setGeo(s.geolocation)
      setMic(s.microphone)
      setNotif(s.notifications)
    })
  }, [setGeo, setMic, setNotif])

  const runRequest = useCallback(
    async (fn: () => Promise<PermissionStateLike>, set: (s: PermissionStateLike) => void, id: WizardStepId) => {
      traceAction(`permission_request:${id}`, 'handler_enter')
      if (busy) {
        traceAction(`permission_request:${id}`, 'guard_reject', { reason: 'busy' })
        return
      }
      setBusy(true)
      try {
        traceAction(`permission_request:${id}`, 'async_start')
        set(await fn())
        setAttempted((a) => ({ ...a, [id]: true }))
        refreshSnapshot()
        traceAction(`permission_request:${id}`, 'async_complete')
      } finally {
        setBusy(false)
      }
    },
    [busy, setBusy, refreshSnapshot],
  )

  const runAllRemaining = useCallback(async () => {
    traceAction('permission_request:batch_remaining', 'handler_enter')
    if (busy) {
      traceAction('permission_request:batch_remaining', 'guard_reject', { reason: 'busy' })
      return
    }
    setBusy(true)
    try {
      traceAction('permission_request:batch_remaining', 'async_start')
      setGeo(await requestGeolocationPermission())
      setMic(await requestMicrophonePermission())
      setCamera(await requestCameraPermission())
      setNotif(await requestNotificationPermission())
      setOrient(await requestOrientationPermission())
      setMotion(await requestMotionPermission())
      setAttempted((a) => ({
        ...a,
        location: true,
        microphone: true,
        camera: true,
        notifications: true,
        orientation: true,
        motion: true,
      }))
      refreshSnapshot()
      traceAction('permission_request:batch_remaining', 'async_complete')
    } finally {
      setBusy(false)
    }
  }, [busy, setBusy, setGeo, setMic, setCamera, setNotif, setOrient, setMotion, refreshSnapshot])

  const goNext = () => {
    if (stepIndex < steps.length - 1) setStepIndex((i) => i + 1)
  }
  const goBack = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1)
  }

  const markSkipped = (id: WizardStepId) => {
    setAttempted((a) => ({ ...a, [id]: true }))
    goNext()
  }

  const permissionResolved = (s: PermissionStateLike) =>
    s === 'granted' || s === 'denied' || s === 'unsupported'

  const canAdvanceFrom = (id: WizardStepId): boolean => {
    if (id === 'intro') return true
    if (id === 'done') return false
    if (id === 'location') return permissionResolved(geo) || Boolean(attempted.location)
    if (id === 'microphone') return permissionResolved(mic) || Boolean(attempted.microphone)
    if (id === 'camera') return permissionResolved(camera) || Boolean(attempted.camera)
    if (id === 'notifications') return permissionResolved(notif) || Boolean(attempted.notifications)
    if (id === 'orientation') return permissionResolved(orient) || Boolean(attempted.orientation)
    if (id === 'motion') return permissionResolved(motion) || Boolean(attempted.motion)
    return true
  }

  if (!visible) return null

  return (
    <>
    <div
      style={{
        width: 'min(560px, 100%)',
        borderRadius: 12,
        border: '1px solid rgba(125,255,138,0.45)',
        background: 'rgba(8,12,14,0.92)',
        color: '#d8e3d8',
        padding: 14,
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: gapMd }}>
        <div style={{ fontSize: fontMd, letterSpacing: '0.12em', color: '#7dff8a', fontWeight: 800 }}>
          PERMISSION SETUP
        </div>
        <div style={{ fontSize: fontSm, color: '#8a9a8c', letterSpacing: '0.06em' }}>
          STEP {stepNum} / {total}
        </div>
      </div>

      <div
        style={{
          height: 4,
          borderRadius: 999,
          background: 'rgba(199,206,198,0.15)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.round((stepNum / total) * 100)}%`,
            background: 'linear-gradient(90deg, #2d5a3d, #7dff8a)',
            transition: 'width 220ms ease',
          }}
        />
      </div>

      {stepId === 'intro' && (
        <>
          <div style={{ fontSize: fontSm, color: '#b8c4b8', lineHeight: 1.5 }}>
            <p style={{ margin: '0 0 8px' }}>{platformHint}</p>
            <p style={{ margin: 0, color: '#9ec4a8' }}>
              This wizard walks through <strong>location</strong>, <strong>microphone</strong>, <strong>camera</strong>,{' '}
              <strong>notifications</strong>
              {steps.includes('orientation') ? ', sensors' : ''} — one tap at a time. Grant what you need for your mission;
              you can change choices later in system settings.
            </p>
          </div>
          <button type="button" onClick={goNext} style={{ ...btnBase, borderColor: 'rgba(125,255,138,0.55)', background: 'rgba(125,255,138,0.16)' }}>
            START
          </button>
        </>
      )}

      {stepId === 'location' && (
        <>
          <div>
            <div style={{ fontSize: fontMd, fontWeight: 800, color: '#d8e3d8', marginBottom: 6 }}>Location (GPS)</div>
            <div style={{ fontSize: fontSm, color: '#9ea7a0', lineHeight: 1.45 }}>
              Needed for coords, weather, elevation, and map follow. Status:{' '}
              <strong style={{ color: geo === 'granted' ? '#7dff8a' : '#ffd166' }}>{stateLabel(geo)}</strong>
              {gps.lat != null && gps.lng != null && (
                <span style={{ color: '#7dff8a' }}> · GPS fix OK</span>
              )}
            </div>
          </div>
          {(isAppleMobile || isAndroid) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: gapSm }}>
              {isAppleMobile && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setLinkHint('If Settings does not open, use COPY STEPS.')
                      window.setTimeout(() => setLinkHint(null), 8000)
                      tryOpenIosLocationPrivacySettings(showSettingsFallback)
                    }}
                    style={{ ...btnBase, flex: '1 1 140px', borderColor: 'rgba(125,255,138,0.5)', background: 'rgba(125,255,138,0.12)' }}
                  >
                    OPEN IPHONE SETTINGS
                  </button>
                  <button
                    type="button"
                    onClick={() => tryOpenIosLocationPrivacySettingsAlternate(showSettingsFallback)}
                    style={{ ...btnBase, flex: '1 1 120px' }}
                  >
                    ALT SETTINGS LINK
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyTextToClipboard(safariLocationFixClipboardLines()).then((ok) => setLinkHint(ok ? 'Copied Safari steps.' : 'Copy failed.'))}
                    style={{ ...btnBase, flex: '1 1 120px' }}
                  >
                    COPY SAFARI STEPS
                  </button>
                </>
              )}
              {isAndroid && (
                <>
                  <button
                    type="button"
                    onClick={() => tryOpenAndroidLocationSettings(showSettingsFallback)}
                    style={{ ...btnBase, flex: '1 1 160px', borderColor: 'rgba(125,255,138,0.5)' }}
                  >
                    OPEN ANDROID LOCATION
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyTextToClipboard(androidLocationFixClipboardLines())}
                    style={{ ...btnBase, flex: '1 1 120px' }}
                  >
                    COPY ANDROID STEPS
                  </button>
                </>
              )}
            </div>
          )}
          {linkHint && <div style={{ fontSize: fontSm, color: '#a8d4b8' }}>{linkHint}</div>}
          {locationDenied && (
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                border: '1px solid rgba(255,107,135,0.45)',
                background: 'rgba(40,12,20,0.45)',
                fontSize: fontSm,
                color: '#ffd0d8',
              }}
            >
              Location is denied — use system settings above, then tap REQUEST LOCATION again.
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void runRequest(requestGeolocationPermission, setGeo, 'location')}
            style={{ ...btnBase, borderColor: 'rgba(125,255,138,0.55)', background: 'rgba(125,255,138,0.18)' }}
          >
            {busy ? 'REQUESTING…' : 'REQUEST LOCATION'}
          </button>
        </>
      )}

      {stepId === 'microphone' && (
        <>
          <div>
            <div style={{ fontSize: fontMd, fontWeight: 800, marginBottom: 6 }}>Microphone</div>
            <div style={{ fontSize: fontSm, color: '#9ea7a0' }}>
              Voice commands. Status: <strong style={{ color: mic === 'granted' ? '#7dff8a' : '#ffd166' }}>{stateLabel(mic)}</strong>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runRequest(requestMicrophonePermission, setMic, 'microphone')}
            style={{ ...btnBase, borderColor: 'rgba(125,255,138,0.45)', background: 'rgba(125,255,138,0.12)' }}
          >
            {busy ? 'REQUESTING…' : 'REQUEST MICROPHONE'}
          </button>
        </>
      )}

      {stepId === 'camera' && (
        <>
          <div>
            <div style={{ fontSize: fontMd, fontWeight: 800, marginBottom: 6 }}>Camera</div>
            <div style={{ fontSize: fontSm, color: '#9ea7a0' }}>
              Optional for future visual features. Status:{' '}
              <strong style={{ color: camera === 'granted' ? '#7dff8a' : '#ffd166' }}>{stateLabel(camera)}</strong>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runRequest(requestCameraPermission, setCamera, 'camera')}
            style={btnBase}
          >
            {busy ? 'REQUESTING…' : 'REQUEST CAMERA'}
          </button>
        </>
      )}

      {stepId === 'notifications' && (
        <>
          <div>
            <div style={{ fontSize: fontMd, fontWeight: 800, marginBottom: 6 }}>Notifications</div>
            <div style={{ fontSize: fontSm, color: '#9ea7a0' }}>
              Alerts and deadman renewals. Status:{' '}
              <strong style={{ color: notif === 'granted' ? '#7dff8a' : '#ffd166' }}>{stateLabel(notif)}</strong>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runRequest(requestNotificationPermission, setNotif, 'notifications')}
            style={btnBase}
          >
            {busy ? 'REQUESTING…' : 'REQUEST NOTIFICATIONS'}
          </button>
        </>
      )}

      {stepId === 'orientation' && (
        <>
          <div>
            <div style={{ fontSize: fontMd, fontWeight: 800, marginBottom: 6 }}>Device orientation</div>
            <div style={{ fontSize: fontSm, color: '#9ea7a0' }}>
              Compass-style features on supported devices (often iOS Safari). Status:{' '}
              <strong style={{ color: orient === 'granted' ? '#7dff8a' : '#ffd166' }}>{stateLabel(orient)}</strong>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runRequest(requestOrientationPermission, setOrient, 'orientation')}
            style={btnBase}
          >
            {busy ? 'REQUESTING…' : 'REQUEST ORIENTATION'}
          </button>
        </>
      )}

      {stepId === 'motion' && (
        <>
          <div>
            <div style={{ fontSize: fontMd, fontWeight: 800, marginBottom: 6 }}>Motion</div>
            <div style={{ fontSize: fontSm, color: '#9ea7a0' }}>
              Motion sensors where the browser supports a prompt. Status:{' '}
              <strong style={{ color: motion === 'granted' ? '#7dff8a' : '#ffd166' }}>{stateLabel(motion)}</strong>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runRequest(requestMotionPermission, setMotion, 'motion')}
            style={btnBase}
          >
            {busy ? 'REQUESTING…' : 'REQUEST MOTION'}
          </button>
          <button type="button" disabled={busy} onClick={() => markSkipped('motion')} style={{ ...btnBase, opacity: 0.85 }}>
            SKIP (NOT NEEDED)
          </button>
        </>
      )}

      {stepId === 'done' && (
        <>
          <div style={{ fontSize: fontMd, fontWeight: 800 }}>Summary</div>
          <div
            style={{
              display: 'grid',
              gap: gapSm,
              fontSize: fontSm,
              fontFamily: 'var(--font-mono, monospace)',
              color: '#b8c1b9',
            }}
          >
            <div>LOCATION ··· {stateLabel(geo)}</div>
            <div>MIC ··· {stateLabel(mic)}</div>
            <div>CAMERA ··· {stateLabel(camera)}</div>
            <div>NOTIFY ··· {stateLabel(notif)}</div>
            {steps.includes('orientation') && <div>ORIENT ··· {stateLabel(orient)}</div>}
            {steps.includes('motion') && <div>MOTION ··· {stateLabel(motion)}</div>}
          </div>
          <button type="button" disabled={busy} onClick={() => void runAllRemaining()} style={{ ...btnBase, fontSize: fontSm }}>
            {busy ? 'REQUESTING…' : 'REQUEST ALL REMAINING (BATCH)'}
          </button>
          <button
            type="button"
            onClick={() => {
              traceAction('enter_hud', 'handler_enter', { source: 'permission_wizard_done' })
              traceAction('enter_hud', 'state_result', { overlayVisible: false })
              onClose()
            }}
            style={{
              ...btnBase,
              borderColor: 'rgba(125,255,138,0.55)',
              color: '#d8ffe0',
            }}
          >
            ENTER HUD
          </button>
        </>
      )}

      {stepId !== 'intro' && stepId !== 'done' && (
        <div style={{ display: 'flex', gap: gapMd, flexWrap: 'wrap' }}>
          <button type="button" onClick={goBack} style={{ ...btnBase, flex: '0 0 auto', minHeight: tapMin }}>
            BACK
          </button>
          <button
            type="button"
            onClick={goNext}
            style={{
              ...btnBase,
              flex: 1,
              minHeight: tapMin,
              borderColor: 'rgba(125,255,138,0.45)',
              color: '#e4fcea',
            }}
          >
            NEXT
          </button>
        </div>
      )}

      <div style={{ borderTop: '1px solid rgba(199,206,198,0.15)', paddingTop: gapMd, display: 'grid', gap: gapSm }}>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          style={{ ...btnBase, minHeight: tapMin, fontSize: fontSm, borderColor: 'rgba(199,206,198,0.2)' }}
        >
          {showAdvanced ? 'HIDE' : 'SHOW'} ALL PERMISSION BUTTONS (ADVANCED)
        </button>
        {showAdvanced && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: gapSm }}>
            <button type="button" disabled={busy} onClick={() => void runRequest(requestGeolocationPermission, setGeo, 'location')} style={{ ...btnBase, minHeight: tapMin, fontSize: fontSm }}>
              LOC ({geo})
            </button>
            <button type="button" disabled={busy} onClick={() => void runRequest(requestMicrophonePermission, setMic, 'microphone')} style={{ ...btnBase, minHeight: tapMin, fontSize: fontSm }}>
              MIC ({mic})
            </button>
            <button type="button" disabled={busy} onClick={() => void runRequest(requestCameraPermission, setCamera, 'camera')} style={{ ...btnBase, minHeight: tapMin, fontSize: fontSm }}>
              CAM ({camera})
            </button>
            <button type="button" disabled={busy} onClick={() => void runRequest(requestNotificationPermission, setNotif, 'notifications')} style={{ ...btnBase, minHeight: tapMin, fontSize: fontSm }}>
              NTFY ({notif})
            </button>
            {steps.includes('orientation') && (
              <button type="button" disabled={busy} onClick={() => void runRequest(requestOrientationPermission, setOrient, 'orientation')} style={{ ...btnBase, minHeight: tapMin, fontSize: fontSm }}>
                ORI ({orient})
              </button>
            )}
            {steps.includes('motion') && (
              <button type="button" disabled={busy} onClick={() => void runRequest(requestMotionPermission, setMotion, 'motion')} style={{ ...btnBase, minHeight: tapMin, fontSize: fontSm }}>
                MOT ({motion})
              </button>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <button
            type="button"
            onClick={() => {
              traceAction('reset_app', 'handler_enter', { source: 'permission_wizard' })
              onResetApp()
            }}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#a8b4ac',
              minHeight: tapMin,
              fontSize: fontSm,
              letterSpacing: '0.06em',
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: '0 6px',
            }}
          >
            Reset App
          </button>
        </div>
      </div>
    </div>
    {settingsFallback && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Open Settings manually"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100003,
          background: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
        onClick={() => setSettingsFallback(null)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(420px, 100%)',
            background: 'rgba(8,12,14,0.96)',
            border: '1px solid rgba(125,255,138,0.55)',
            borderRadius: 12,
            padding: 16,
            color: '#d8e3d8',
            display: 'grid',
            gap: 10,
          }}
        >
          <div style={{ fontSize: fontMd, fontWeight: 800, letterSpacing: '0.06em', color: '#7dff8a' }}>
            OPEN SETTINGS MANUALLY
          </div>
          <div style={{ fontSize: fontSm, color: '#b8c4b8', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {settingsFallback}
          </div>
          <button
            type="button"
            onClick={() => setSettingsFallback(null)}
            style={{ ...btnBase, marginTop: 4 }}
          >
            OK
          </button>
        </div>
      </div>
    )}
    </>
  )
}
