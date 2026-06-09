import { useState } from 'react'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { useCockpitOptional } from '../context/CockpitContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm } from './tokens'

/**
 * Non-blocking banner when tactical identity / contacts are incomplete.
 * Classic opens preflight panel; Modern/Balanced dispatch runtime events.
 */
export default function TacticalSetupBanner() {
  const { assessment, operationalReady } = useTacticalProfile()
  const { mode } = useHudPresentation()
  const cockpit = useCockpitOptional()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('tactical_setup_banner_dismissed_v1') === '1'
    } catch {
      return false
    }
  })

  if (operationalReady || dismissed) return null

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const headline = assessment.issues.includes('no_contacts')
    ? 'Emergency setup incomplete — no contacts configured'
    : 'Emergency setup incomplete — profile required for SOS / Deadman / Check-In'

  const openSetup = () => {
    if (mode === 'immersive') {
      window.dispatchEvent(new CustomEvent('hud:open-preflight'))
      return
    }
    if (mode === 'hybrid') {
      window.dispatchEvent(new CustomEvent('hud:show-permissions'))
      return
    }
    cockpit?.raisePanel('preflight')
  }

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10050,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '8px 12px',
        background: 'rgba(48, 18, 22, 0.94)',
        borderBottom: '1px solid rgba(255, 107, 135, 0.45)',
        color: '#ffd5dd',
        fontSize: fontSm,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ flex: '1 1 200px', lineHeight: 1.35 }}>
        <strong style={{ letterSpacing: '0.06em' }}>{headline}</strong>
        {assessment.messages[0] ? (
          <span style={{ display: 'block', marginTop: 4, color: '#ffb8c8', opacity: 0.95 }}>
            {assessment.messages[0]}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={openSetup}
          style={{
            borderRadius: 6,
            border: '1px solid rgba(125, 255, 138, 0.5)',
            background: 'rgba(125, 255, 138, 0.14)',
            color: '#d8f8dd',
            fontWeight: 700,
            letterSpacing: '0.06em',
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: fontSm,
          }}
        >
          OPEN SETUP
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.setItem('tactical_setup_banner_dismissed_v1', '1')
            } catch {
              /* ignore */
            }
            setDismissed(true)
          }}
          style={{
            borderRadius: 6,
            border: '1px solid rgba(199, 206, 198, 0.35)',
            background: 'transparent',
            color: '#c7d4c8',
            fontWeight: 600,
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: fontSm,
          }}
        >
          DISMISS
        </button>
      </div>
    </div>
  )
}
