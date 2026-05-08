import { useEffect, useState } from 'react'
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
 * Mounts ONLY when ALL of the following are true:
 *   - the device is using the mobile interaction model (phones + tablets)
 *   - the app is NOT already installed (browser tab, not standalone)
 *   - install is currently eligible (Android prompt captured, OR iOS in browser)
 *   - the user has not previously dismissed the hint (localStorage)
 *
 * No modal takeover. No layout shift in the cockpit area. No map
 * obstruction (sits above bottom safe-area, panel system is z-indexed
 * higher when active).
 *
 * Android: shows an "INSTALL" button that triggers the captured
 * `beforeinstallprompt` event. After acceptance OR dismissal we hide
 * permanently because the browser will not re-fire the event during
 * this session.
 *
 * iOS: shows a single-line guidance string pointing the user at the
 * Share-sheet "Add to Home Screen" entry. There is no programmatic
 * install API on iOS, so this is informational only.
 */
export default function InstallHelperBanner() {
  const profile = getDeviceProfile()
  const [snap, setSnap] = useState(getRuntimeSnapshot)
  const [dismissed, setDismissed] = useState(() => wasInstallHintDismissed())

  useEffect(() => {
    return subscribeRuntimeSnapshot((s) => setSnap(s))
  }, [])

  // Mobile interaction model only. Desktop never shows this hint —
  // browsers expose install via the address bar and that path is
  // sufficient for the planning-cockpit experience.
  if (profile.interactionMode !== 'mobile') return null
  if (snap.installMode.standalone) return null
  if (!snap.installMode.eligible) return null
  if (dismissed) return null

  const isMobile = profile.interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const platform = snap.installMode.platform
  const promptAvailable = snap.installMode.promptAvailable

  const onInstall = async () => {
    if (platform !== 'android' || !promptAvailable) return
    const outcome = await triggerInstallPrompt()
    // Both 'accepted' and 'dismissed' mean the prompt was actually
    // shown — Android Chrome will not re-fire `beforeinstallprompt`
    // for the same session, so we hide the helper either way.
    if (outcome === 'accepted' || outcome === 'dismissed') {
      setDismissed(true)
      dismissInstallHint()
    }
  }

  const onDismiss = () => {
    setDismissed(true)
    dismissInstallHint()
  }

  return (
    <div
      role="status"
      aria-label="Install HUD"
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        left: 'calc(env(safe-area-inset-left, 0px) + 12px)',
        right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
        zIndex: 5000,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: gapMd,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'rgba(8, 12, 14, 0.92)',
        border: '1px solid rgba(125,255,138,0.42)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
        color: '#d8e3d8',
        fontFamily: 'ui-monospace, system-ui, sans-serif',
        fontSize: fontSm,
        letterSpacing: '0.04em',
      }}
    >
      <div style={{ flex: 1, lineHeight: 1.4, minWidth: 0 }}>
        <div
          style={{
            fontSize: fontSm,
            color: '#7dff8a',
            letterSpacing: '0.14em',
            fontWeight: 700,
            marginBottom: 2,
          }}
        >
          INSTALL HUD
        </div>
        {platform === 'ios' ? (
          <div>
            Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>
          </div>
        ) : (
          <div>For offline GPS + voice continuity. If migrating from Netlify, uninstall old HUD app first.</div>
        )}
      </div>
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
            flexShrink: 0,
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
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}
