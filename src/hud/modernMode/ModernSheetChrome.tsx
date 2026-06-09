/**
 * Shared Modern sheet chrome — close affordance + drag handle.
 * Ensures 44px touch targets and consistent spatial emergence.
 */

import React from 'react'
import { MODERN_SHEET } from './modernVisualTokens'

type ModernSheetCloseButtonProps = {
  onClose: () => void
  label?: string
}

export function ModernSheetCloseButton({ onClose, label = 'Close' }: ModernSheetCloseButtonProps) {
  const size = MODERN_SHEET.closeSize
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        background: 'rgba(255, 255, 255, 0.1)',
        color: 'rgba(255, 255, 255, 0.88)',
        fontSize: 22,
        lineHeight: 1,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
        zIndex: 2,
        touchAction: 'manipulation',
      }}
    >
      ×
    </button>
  )
}

type ModernSheetDragHandleProps = {
  onDismiss?: () => void
}

export function ModernSheetDragHandle({ onDismiss }: ModernSheetDragHandleProps) {
  return (
    <button
      type="button"
      aria-label={onDismiss ? 'Dismiss sheet' : 'Sheet handle'}
      onClick={onDismiss}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        padding: '10px 0 6px',
        border: 'none',
        background: 'transparent',
        cursor: onDismiss ? 'pointer' : 'default',
        touchAction: 'manipulation',
      }}
    >
      <span
        style={{
          width: 40,
          height: 4,
          borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.22)',
          display: 'block',
        }}
      />
    </button>
  )
}
