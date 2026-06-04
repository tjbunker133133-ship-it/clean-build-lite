/**
 * Bridge from central command registry → VoicePanel listen lifecycle.
 * VoicePanel registers handlers on mount; commands invoke without importing UI.
 */

export type VoicePanelCommandHandlers = {
  sleep: () => void
  enableContinuous: () => Promise<void>
}

let handlers: VoicePanelCommandHandlers | null = null

export function setVoicePanelCommandHandlers(next: VoicePanelCommandHandlers | null): void {
  handlers = next
}

export function invokeVoiceSleep(): boolean {
  if (!handlers) return false
  handlers.sleep()
  return true
}

export async function invokeVoiceContinuous(): Promise<boolean> {
  if (!handlers) return false
  await handlers.enableContinuous()
  return true
}
