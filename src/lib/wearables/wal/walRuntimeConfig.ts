/**
 * WAL production runtime tuning — battery-safe defaults.
 */

/** Escalation countdown tick — 1s only while escalation_pending (runtime gates this). */
export const WAL_ESCALATION_TICK_MS = 1_000

/** Health Connect / biometric poll when foreground — lazy, low frequency. */
export const WAL_HEALTH_POLL_MS = 60_000

/** Background: suspend biometric polls entirely. */
export const WAL_BACKGROUND_POLL_MS = 0

/** Min gap between identical signal type + source ingestions. */
export const WAL_SIGNAL_THROTTLE_MS: Record<string, number> = {
  heart_rate: 30_000,
  motion: 60_000,
  sleep: 120_000,
  stress: 60_000,
  battery: 300_000,
  notification_ack: 10_000,
  inactivity: 120_000,
}

/** Critical signals bypass throttle. */
export const WAL_SIGNAL_BYPASS_THROTTLE = new Set(['fall', 'user_emergency'])

/** Watch notification projection — min gap unless state changes. */
export const WAL_PROJECTION_DEBOUNCE_MS = 5_000

/** UI snapshot refresh when monitoring — only during active escalation. */
export const WAL_UI_REFRESH_PENDING_MS = 1_000

/** UI snapshot refresh when idle monitoring. */
export const WAL_UI_REFRESH_IDLE_MS = 5_000

export const WAL_CONNECTION_STORAGE_KEY = 'signal-one-wal-connection-v1'
