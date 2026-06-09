import { useEffect, useState } from 'react'
import {
  hudConfirm,
  resolveHudConfirm,
  subscribeHudConfirm,
  type HudConfirmRequest,
} from '../lib/hudConfirm'
import { ModePortal } from '../lib/presentationIsolation'
import { layerZ } from '../lib/presentationIsolation/zIndexLayers'

/** Global confirm modal — captures focus, blocks click-through. */
export default function HudConfirmHost() {
  const [request, setRequest] = useState<HudConfirmRequest | null>(null)

  useEffect(() => subscribeHudConfirm(setRequest), [])

  if (!request) return null

  return (
    <ModePortal portalId="hud-confirm" owner="global">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hud-confirm-title"
      data-testid="hud-confirm-dialog"
      data-portal-owner="global"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: layerZ('OVERLAY'),
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(4px)',
        padding: 24,
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.stopPropagation()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          padding: '20px 22px',
          borderRadius: 14,
          background: 'rgba(28, 28, 30, 0.98)',
          border: '1px solid rgba(120, 120, 128, 0.35)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
          fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI, system-ui, sans-serif',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id="hud-confirm-title"
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.95)',
            marginBottom: 8,
          }}
        >
          {request.title}
        </div>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.45,
            color: 'rgba(255,255,255,0.7)',
            margin: '0 0 20px',
          }}
        >
          {request.message}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="hud-confirm-cancel"
            onClick={() => resolveHudConfirm(false)}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid rgba(120,120,128,0.4)',
              background: 'transparent',
              color: 'rgba(255,255,255,0.85)',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            data-testid="hud-confirm-ok"
            autoFocus
            onClick={() => resolveHudConfirm(true)}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: 'none',
              background: request.destructive ? '#ff453a' : '#0a84ff',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {request.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
    </ModePortal>
  )
}

export { hudConfirm }
