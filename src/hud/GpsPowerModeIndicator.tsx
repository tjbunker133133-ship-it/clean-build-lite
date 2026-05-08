import { useGPS } from '../hooks/useGPS'
import type { GpsPowerMode } from '../lib/gpsAdaptivePolicy'

const LABEL: Record<GpsPowerMode, string> = {
  active_navigation: 'GPS · Active',
  stable_tracking: 'GPS · Stable',
  stationary_low: 'GPS · Low power',
}

/**
 * Subtle operator hint for adaptive GPS sampling (not a mission panel).
 */
export default function GpsPowerModeIndicator() {
  const mode = useGPS().gpsPowerMode ?? 'active_navigation'
  return (
    <div
      style={{
        position: 'fixed',
        left: 10,
        bottom: 10,
        zIndex: 60,
        pointerEvents: 'none',
        opacity: 0.62,
        fontSize: 10,
        letterSpacing: 0.04,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        color: '#6b7d8c',
        textShadow: '0 1px 2px rgba(0,0,0,0.75)',
      }}
      aria-live="polite"
    >
      {LABEL[mode]}
    </div>
  )
}
