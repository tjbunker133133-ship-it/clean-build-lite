import { useEffect, useMemo, useState } from 'react'
import { iosInstallCopy } from '../lib/iosInstallGuide'
import { getDeviceProfile } from '../runtime/deviceProfile'
import {
  dismissInstallHint,
  triggerInstallPrompt,
  wasInstallHintDismissed,
} from '../runtime/pwa'
import { getRuntimeSnapshot, subscribeRuntimeSnapshot } from '../runtime/runtimeSnapshot'
import { touchFontSm, touchGapMd, touchMinTarget } from './tokens'

/**
 * Minimal, dismissible install hint.
 *
 * Android: INSTALL button uses captured `beforeinstallprompt`.
 * iPhone / iPad: Share → Add to Home Screen (no programmatic install on iOS).
 */
export default function InstallHelperBanner() {
  const profile = getDeviceProfile()
  const [snap, setSnap] = useState(getRuntimeSnapshot)
  const [dismissed, setDismissed] = useState(() => wasInstallHintDismissed())
  const [iosStepsOpen, setIosStepsOpen] = useState(false)

  useEffect(() => {
    return subscribeRuntimeSnapshot((s) => setSnap(s))
  }, [])

  if (profile.interactionMode !== 'mobile') return null
  if (profile.isStandalone || profile.isPWA) return null
  if (snap.installMode.standalone) return null
  if (!snap.installMode.eligible) return null
  if (dismissed) return null

  const isMobile = profile.interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const platform = snap.installMode.platform
  const promptAvailable = snap.installMode.promptAvailable
  const iosCopy = useMemo(
    () => iosInstallCopy(profile.type === 'tablet'),
    [profile.type],
  )

  const onInstall = async () => {
    if (platform !== 'android' || !promptAvailable) return
    const outcome = await triggerInstallPrompt()
    if (outcome === 'accepted' || outcome === 'dismissed') {
      setDismissed(true)
      dismissInstallHint()
    }
  }

  const onDismiss = () => {
    setDismissed(true)
    dismissInstallHint()
  }

  const title =
    platform === 'ios' ? iosCopy.title : 'INSTALL HUD'

  return (
    <div
      role="status"
      aria-label={platform === 'ios' ? 'Add HUD V.1 to Home Screen' : 'Install HUD V.1'}
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        left: 'calc(env(safe-area-inset-left, 0px) + 12px)',
        right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
        zIndex: 5000,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: gapMd,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'rgba(8, 12, 14, 0.94)',
        border: '1px solid rgba(125,255,138,0.42)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
        color: '#d8e3d8',
        fontFamily: 'ui-monospace, system-ui, sans-serif',
        fontSize: fontSm,
        letterSpacing: '0.04em',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: gapMd }}>
        <div style={{ flex: 1, lineHeight: 1.45, minWidth: 0 }}>
          <div
            style={{
              fontSize: fontSm,
              color: '#7dff8a',
              letterSpacing: '0.14em',
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            {title}
          </div>
          {platform === 'ios' ? (
            <>
              <p style={{ margin: '0 0 8px', color: '#c7d4c8' }}>{iosCopy.lead}</p>
              {iosStepsOpen ? (
                <ol style={{ margin: 0, paddingLeft: 18, color: '#d8e3d8' }}>
                  {iosCopy.steps.map((step) => (
                    <li key={step} style={{ marginBottom: 4 }}>
                      {step}
                    </li>
                  ))}
                </ol>
              ) : null}
              {iosStepsOpen ? (
                <p style={{ margin: '8px 0 0', color: '#e8c29a', fontSize: fontSm }}>{iosCopy.avoid}</p>
              ) : null}
            </>
          ) : (
            <div>For offline GPS + voice continuity</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          {platform === 'ios' ? (
            <button
              type="button"
              onClick={() => setIosStepsOpen((v) => !v)}
              style={{
                minHeight: tapMin,
                padding: '0 12px',
                borderRadius: 8,
                border: '1px solid rgba(125,255,138,0.6)',
                background: 'rgba(125,255,138,0.16)',
                color: '#7dff8a',
                cursor: 'pointer',
                fontSize: fontSm,
                fontWeight: 700,
                letterSpacing: '0.06em',
              }}
            >
              {iosStepsOpen ? 'HIDE' : 'STEPS'}
            </button>
          ) : null}
          {platform === 'android' && promptAvailable ? (
            <button
              type="button"
              onClick={() => void onInstall()}
              style={{
                minHeight: tapMin,
                padding: '0 18px',
                borderRadius: 8,
                border: '1px solid rgba(125,255,138,0.6)',
                background: 'rgba(125,255,138,0.16)',
                color: '#7dff8a',
                cursor: 'pointer',
                fontSize: fontSm,
                fontWeight: 700,
                letterSpacing: '0.08em',
              }}
            >
              INSTALL
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss install hint"
            title="Dismiss"
            onClick={onDismiss}
            style={{
              minHeight: tapMin,
              minWidth: tapMin,
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.3)',
              background: 'transparent',
              color: 'rgba(199,206,198,0.85)',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
