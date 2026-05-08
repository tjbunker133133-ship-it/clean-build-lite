/**
 * Same-tab session guard: after a successful deadman rescue POST for a given
 * `expiresAt`, suppress duplicate POSTs if the panel remounts or the page
 * reloads while `trailmap_deadman_v1` still describes the same expired episode.
 * Cross-tab behavior unchanged (sessionStorage is per tab).
 *
 * OPERATIONAL RUNBOOK
 * -------------------
 * Why keyed by `expiresAt`:
 *   The lock value is the literal `expiresAt` that was successfully
 *   dispatched. A new episode (operator renews → new `expiresAt`) produces
 *   a fresh key and cannot be silently suppressed. This is the contract
 *   that makes the lock both safe (no replay) and live (no permanent block).
 *
 * Why `sessionStorage` (not `localStorage`):
 *   - Per-tab scope matches the operator mental model: each open HUD tab is
 *     an independent operator session.
 *   - Cleared on tab close → no permanent lock can be carried across true
 *     restarts.
 *
 * Reload semantics (what happens after F5 mid-episode):
 *   - If the rescue ALREADY POSTed successfully before reload, the lock
 *     persists and `shouldSkipDeadmanDispatch(expiresAt)` returns true →
 *     panel shows "RESCUE ALREADY DISPATCHED (THIS TAB)".
 *   - If reload happened BEFORE a successful POST, the lock is absent and
 *     the panel re-arms the renew window normally.
 *
 * Why no SOS equivalent:
 *   SOS is operator-initiated (slide-to-arm). Re-arming after a failed POST
 *   is an explicit operator decision and must be allowed. Deadman is the
 *   opposite: auto-expiry is involuntary and a remount-induced replay would
 *   silently double-send. Do NOT generalize this lock to the SOS path.
 *
 * Failure mode behavior:
 *   All three helpers swallow exceptions (private mode, quota, locked-down
 *   browsers). A degraded sessionStorage falls back to "no lock", which is
 *   the SAFE default — the in-memory `sentRef` in `DeadManPanel` still
 *   prevents same-mount duplicates.
 */

export const DEADMAN_DISPATCH_LOCK_KEY = 'hud:deadman:rescue_dispatch_expiry'

export function shouldSkipDeadmanDispatch(expiresAt: number): boolean {
  try {
    const v = sessionStorage.getItem(DEADMAN_DISPATCH_LOCK_KEY)
    return v !== null && v === String(expiresAt)
  } catch {
    return false
  }
}

export function recordDeadmanDispatchSuccess(expiresAt: number): void {
  try {
    sessionStorage.setItem(DEADMAN_DISPATCH_LOCK_KEY, String(expiresAt))
  } catch {
    /* private mode / quota */
  }
}

export function clearDeadmanDispatchLock(): void {
  try {
    sessionStorage.removeItem(DEADMAN_DISPATCH_LOCK_KEY)
  } catch {
    /* ignore */
  }
}
