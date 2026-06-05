import { installDcrlDiagnostics } from '../lib/wearables/dcrl/store'
import { startDcrlDynamicSync } from '../lib/wearables/dcrl/sync'

let installed = false

/** Boot DCRL — registry, diagnostics beacon, and dynamic state sync. */
export function installDcrlRuntime(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  installDcrlDiagnostics()
  startDcrlDynamicSync()
}

export function _resetDcrlRuntimeForTests(): void {
  installed = false
}
