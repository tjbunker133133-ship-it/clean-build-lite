import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import HudPanel from './HudPanel'
import { useCockpit } from '../context/CockpitContext'
import { requestNotificationPermission } from '../lib/devicePermissions'
import { loadOrCreateAlertWatchToken } from '../lib/push/alertWatchToken'
import { buildAlertSubscribeUrl } from '../lib/push/alertSubscribeUrl'
import { shareAlertInvite } from '../lib/push/shareAlertInvite'
import { sendCompanionTestNotification } from '../lib/wearables/companionNotification'
import {
  openHealthConnectApp,
  readHealthConnectSnapshot,
  refreshHealthConnectCache,
  requestHealthConnectPermissions,
} from '../lib/wearables/healthConnectClient'
import { healthConnectSdkLabel, type HealthConnectUiSnapshot } from '../lib/wearables/healthConnectFormat'
import {
  getWearableCategories,
  getWearablesCompanionStatus,
  readinessColor,
  readinessLabel,
} from '../lib/wearables/wearablesStatus'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchGapMd, touchGapSm, touchMinTarget } from './tokens'

const sectionLabel: CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.14em',
  color: '#a8b2aa',
  margin: 0,
}

function StatusRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: touchFontSm(true) }}>
      <span style={{ color: '#9ea7a0' }}>{label}</span>
      <span style={{ color: color ?? '#c7cec6', fontWeight: 700, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export default function WearablesPanel() {
  const { raisePanel } = useCockpit()
  const { profile } = useTacticalProfile()
  const watchToken = loadOrCreateAlertWatchToken()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const gapSm = touchGapSm(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const [status, setStatus] = useState(() => getWearablesCompanionStatus())
  const [health, setHealth] = useState<HealthConnectUiSnapshot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    setStatus(getWearablesCompanionStatus())
  }, [])

  const refreshHealth = useCallback(async () => {
    const snap = await refreshHealthConnectCache()
    setHealth(snap)
    setStatus(getWearablesCompanionStatus())
  }, [])

  useEffect(() => {
    refresh()
    void refreshHealth()
  }, [refresh, refreshHealth])

  const btn: CSSProperties = {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid rgba(125,255,138,0.35)',
    background: 'rgba(8, 24, 14, 0.5)',
    color: '#c7cec6',
    fontSize: fontSm,
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: tapMin,
    letterSpacing: '0.06em',
  }

  const allowNotifications = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const next = await requestNotificationPermission()
      refresh()
      setNotice(
        next === 'granted'
          ? 'Notifications allowed — send a test alert next.'
          : `Notification permission: ${next}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const testAlert = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await sendCompanionTestNotification()
      setNotice(result.message)
    } finally {
      setBusy(false)
    }
  }

  const shareContactInvite = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await shareAlertInvite({
        operatorName: profile.display_name,
        watchToken,
      })
      if (result === 'shared') setNotice('Contact invite shared.')
      else if (result === 'copied') setNotice('Invite copied — send to your contact’s phone.')
      else setNotice('Could not share invite.')
    } finally {
      setBusy(false)
    }
  }

  const copySubscribeLink = async () => {
    try {
      await navigator.clipboard.writeText(buildAlertSubscribeUrl(watchToken))
      setNotice('Contact subscribe link copied.')
    } catch {
      setNotice('Copy failed.')
    }
  }

  const linkHealthConnect = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await requestHealthConnectPermissions()
      await refreshHealth()
      setNotice(result.message)
    } finally {
      setBusy(false)
    }
  }

  const refreshVitals = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const snap = await readHealthConnectSnapshot()
      setHealth(snap)
      setStatus(getWearablesCompanionStatus())
      if (snap.error) setNotice(snap.error)
      else setNotice('Vitals refreshed (advisory only).')
    } finally {
      setBusy(false)
    }
  }

  const openHealthConnect = async () => {
    setBusy(true)
    try {
      const result = await openHealthConnectApp()
      setNotice(result.message)
    } finally {
      setBusy(false)
    }
  }

  const categories = getWearableCategories()
  const healthColor =
    health?.permissionsGranted && (health.heartRateBpm != null || health.stepsToday != null)
      ? '#7dff8a'
      : health?.nativeEligible
        ? '#ffd166'
        : '#94a3b8'
  const notifColor =
    status.notifications === 'granted'
      ? '#7dff8a'
      : status.notifications === 'denied'
        ? '#ff9aac'
        : '#ffd166'

  return (
    <HudPanel
      panelId="wearables"
      title="Wearables"
      initialPos={{ x: 1220, y: 560 }}
      initialWidth={320}
      minHeight={380}
    >
      <div style={{ display: 'grid', gap: gapMd, padding: gapSm }}>
        <p style={{ margin: 0, fontSize: fontSm, color: '#b8c4b8', lineHeight: 1.45 }}>
          Tier 2 companion devices. Information sharing and phone → watch notification testing.
          Does not change GPS, SOS, or deadman behavior.
        </p>

        <section style={{ display: 'grid', gap: gapSm }}>
          <p style={sectionLabel}>STATUS</p>
          <StatusRow label="Platform" value={status.platformLabel} />
          <StatusRow
            label="Installed app"
            value={status.isStandalone ? 'Yes' : 'Browser tab'}
            color={status.isStandalone ? '#7dff8a' : '#ffd166'}
          />
          <StatusRow label="Notifications" value={status.notifications} color={notifColor} />
          <StatusRow
            label="Push (contacts)"
            value={
              status.pushConfigured
                ? status.pushSupported
                  ? 'Ready'
                  : 'Unsupported browser'
                : 'Not configured'
            }
            color={status.pushConfigured && status.pushSupported ? '#7dff8a' : '#ffd166'}
          />
        </section>

        <section style={{ display: 'grid', gap: gapSm }}>
          <p style={sectionLabel}>HEALTH CONNECT (ANDROID APK)</p>
          <p style={{ margin: 0, fontSize: fontSm, color: '#94a3b8', lineHeight: 1.35 }}>
            Read-only ring / watch vitals. Does not change GPS, SOS, or deadman.
          </p>
          <StatusRow
            label="Health Connect"
            value={health ? healthConnectSdkLabel(health.sdkStatus) : 'Checking…'}
            color={healthColor}
          />
          {health?.nativeEligible ? (
            <>
              <StatusRow
                label="Permissions"
                value={health.permissionsGranted ? 'Granted' : 'Not granted'}
                color={health.permissionsGranted ? '#7dff8a' : '#ffd166'}
              />
              <StatusRow
                label="Heart rate"
                value={
                  health.heartRateBpm != null
                    ? `${health.heartRateBpm} bpm`
                    : 'No recent sample'
                }
                color={health.heartRateBpm != null ? '#7dff8a' : undefined}
              />
              <StatusRow
                label="Steps today"
                value={health.stepsToday != null ? health.stepsToday.toLocaleString() : '—'}
              />
              <div style={{ display: 'grid', gap: gapSm }}>
                <button type="button" style={btn} disabled={busy} onClick={() => void linkHealthConnect()}>
                  Link Health Connect
                </button>
                <button type="button" style={btn} disabled={busy} onClick={() => void refreshVitals()}>
                  Refresh vitals
                </button>
                <button
                  type="button"
                  style={{ ...btn, borderColor: 'rgba(199,206,198,0.25)' }}
                  disabled={busy}
                  onClick={() => void openHealthConnect()}
                >
                  Open Health Connect app
                </button>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: fontSm, color: '#9ea7a0', lineHeight: 1.4 }}>
              Install the Android field APK to use Health Connect. Browser and iOS show notifications only.
            </p>
          )}
        </section>

        <section style={{ display: 'grid', gap: gapSm }}>
          <p style={sectionLabel}>QUICK ACTIONS</p>
          <div style={{ display: 'grid', gap: gapSm }}>
            <button type="button" style={btn} disabled={busy} onClick={() => void allowNotifications()}>
              Allow notifications
            </button>
            <button type="button" style={btn} disabled={busy} onClick={() => void testAlert()}>
              Send test alert (not SOS)
            </button>
            <button type="button" style={btn} disabled={busy} onClick={() => void shareContactInvite()}>
              Share contact push invite
            </button>
            <button type="button" style={{ ...btn, opacity: 0.9 }} disabled={busy} onClick={() => void copySubscribeLink()}>
              Copy contact subscribe link
            </button>
          </div>
          {notice ? (
            <p style={{ margin: 0, fontSize: fontSm, color: '#9fe4ad', lineHeight: 1.4 }}>{notice}</p>
          ) : null}
        </section>

        <section style={{ display: 'grid', gap: gapSm }}>
          <p style={sectionLabel}>DEVICE GUIDE</p>
          {categories.map((cat) => (
            <div
              key={cat.id}
              style={{
                padding: '10px 10px',
                borderRadius: 8,
                border: '1px solid rgba(199,206,198,0.14)',
                background: 'rgba(6,8,10,0.55)',
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                <strong style={{ fontSize: fontSm, color: '#e2e8f0' }}>{cat.title}</strong>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    color: readinessColor(cat.readiness),
                    whiteSpace: 'nowrap',
                  }}
                >
                  {readinessLabel(cat.readiness).toUpperCase()}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: fontSm, color: '#9ea7a0', lineHeight: 1.4 }}>{cat.summary}</p>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: fontSm, color: '#b8c4b8', lineHeight: 1.45 }}>
                {cat.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {cat.note ? (
                <p style={{ margin: 0, fontSize: fontSm, color: '#94a3b8', lineHeight: 1.35 }}>{cat.note}</p>
              ) : null}
            </div>
          ))}
        </section>

        <p style={{ margin: 0, fontSize: fontSm, color: '#7a827a', lineHeight: 1.35 }}>
          More: Preflight checklist · Mission Link (team mesh). See docs/WEARABLES_TIER2.md in the repo.
        </p>
        <button
          type="button"
          style={{ ...btn, borderColor: 'rgba(199,206,198,0.25)' }}
          onClick={() => {
            raisePanel('preflight')
          }}
        >
          Open Preflight
        </button>
      </div>
    </HudPanel>
  )
}
