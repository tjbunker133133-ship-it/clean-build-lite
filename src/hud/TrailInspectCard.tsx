import React from 'react'
import type { TrailInspectResult } from '../lib/trailInspect'
import { openTrailInspectLink } from '../lib/trailInspect'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchMinTarget } from './tokens'

type Props = {
  result: TrailInspectResult
  onDismiss: () => void
}

export default function TrailInspectCard({ result, onDismiss }: Props) {
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const title = result.name ?? (result.ref ? `Trail ${result.ref}` : 'Trail')
  const refLine =
    result.ref && result.name
      ? `#${result.ref.replace(/^#/, '')}`
      : result.ref
        ? `#${result.ref.replace(/^#/, '')}`
        : null

  return (
    <div
      role="dialog"
      aria-label="Trail information"
      style={{
        position: 'absolute',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 218,
        pointerEvents: 'auto',
        width: 'min(92vw, 380px)',
        padding: '12px 14px',
        borderRadius: 12,
        background: 'rgba(8, 16, 22, 0.96)',
        border: '1px solid rgba(94, 234, 212, 0.45)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: fontSm,
              fontWeight: 800,
              color: '#ccfbf1',
              letterSpacing: '0.04em',
            }}
          >
            {title}
          </div>
          {refLine && (
            <div style={{ fontSize: fontSm, color: '#5eead4', marginTop: 2 }}>{refLine}</div>
          )}
          {result.trailClass && (
            <div style={{ fontSize: '0.85em', color: '#94a3b8', marginTop: 4 }}>
              {result.trailClass}
              <span style={{ marginLeft: 8, color: '#64748b' }}>
                ~{Math.round(result.distanceMeters)} m from tap
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close trail info"
          style={{
            minWidth: tapMin,
            minHeight: tapMin,
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px solid rgba(148, 163, 184, 0.5)',
            background: 'transparent',
            color: '#cbd5e1',
            fontWeight: 700,
            fontSize: fontSm,
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      <p
        style={{
          margin: '0 0 10px',
          fontSize: '0.8em',
          color: '#94a3b8',
          lineHeight: 1.35,
        }}
      >
        {result.disclaimer}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {result.links.map((link) => (
          <button
            key={link.label}
            type="button"
            onClick={() => openTrailInspectLink(link.url)}
            style={{
              minHeight: tapMin,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(94, 234, 212, 0.35)',
              background: 'rgba(15, 45, 55, 0.6)',
              color: '#e0f2fe',
              fontWeight: 700,
              fontSize: fontSm,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Open {link.label} ↗
          </button>
        ))}
      </div>
    </div>
  )
}
