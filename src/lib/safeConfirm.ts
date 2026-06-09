/** Prevent re-entrant / ghost-tap auto-accept on native confirm dialogs. */
let confirmInFlight = false

/**
 * Show window.confirm after the triggering pointer event completes.
 * Returns a promise so callers can await without blocking the event stack.
 */
export function safeConfirm(message: string, delayMs = 120): Promise<boolean> {
  if (confirmInFlight) return Promise.resolve(false)
  confirmInFlight = true
  return new Promise((resolve) => {
    window.setTimeout(() => {
      try {
        resolve(window.confirm(message))
      } catch {
        resolve(false)
      } finally {
        confirmInFlight = false
      }
    }, delayMs)
  })
}
