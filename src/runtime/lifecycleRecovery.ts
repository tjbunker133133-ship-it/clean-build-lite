/**
 * Lifecycle recovery coordinator — resume integrity without new spatial authority.
 * Wires existing resume reconciliation + map viewport nudge on foreground return.
 */

import { getResumeReconciliationEngine } from '../lib/resumeReconciliationEngine'
import { getOperationalGraphSnapshot } from '../lib/operationalStateGraph'
import { fieldEngineActive, resolveFieldLayerMode } from '../field/fieldLayerPolicy'
import { getSpatialFieldSnapshot, startSpatialFieldEngine } from '../field/SpatialFieldEngine'
import { nudgeMapViewport, isFieldSessionBackgrounded } from './fieldLifecycle'
import { collectBootHealth } from './bootValidation'

export type LifecycleRecoveryStats = {
  resumeCount: number
  lastResumeAt: number | null
  lastIntegrityCheckAt: number | null
  integrityOk: boolean
  integrityIssues: string[]
  reconciliationPending: boolean
  backgrounded: boolean
}

let resumeCount = 0
let lastResumeAt: number | null = null
let lastIntegrityCheckAt: number | null = null
let integrityIssues: string[] = []
let installed = false

function runIntegrityCheck(): boolean {
  const issues: string[] = []
  try {
    const osg = getOperationalGraphSnapshot()
    if (!osg || typeof osg.mode !== 'string') issues.push('osg_unreadable')
  } catch {
    issues.push('osg_throw')
  }

  if (fieldEngineActive(resolveFieldLayerMode())) {
    try {
      getSpatialFieldSnapshot()
    } catch {
      issues.push('field_throw')
    }
  }

  const boot = collectBootHealth()
  if (!boot.runtimeReady) issues.push('runtime_missing')
  if (boot.recentErrors.some((e) => e.startsWith('FATAL:'))) issues.push('fatal_boot_error')

  integrityIssues = issues
  lastIntegrityCheckAt = Date.now()
  return issues.length === 0
}

function onForegroundResume(): void {
  resumeCount++
  lastResumeAt = Date.now()
  getResumeReconciliationEngine().onResume(lastResumeAt)
  nudgeMapViewport()

  if (fieldEngineActive(resolveFieldLayerMode())) {
    startSpatialFieldEngine()
  }

  runIntegrityCheck()
}

export function installLifecycleRecovery(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      onForegroundResume()
    }
  })

  window.addEventListener('pageshow', (ev) => {
    if ((ev as PageTransitionEvent).persisted) {
      onForegroundResume()
    }
  })

  window.addEventListener('online', () => {
    runIntegrityCheck()
  })
}

export function getLifecycleRecoveryStats(): LifecycleRecoveryStats {
  const recon = getResumeReconciliationEngine().getState()
  return {
    resumeCount,
    lastResumeAt,
    lastIntegrityCheckAt,
    integrityOk: integrityIssues.length === 0,
    integrityIssues: [...integrityIssues],
    reconciliationPending: recon.isPending,
    backgrounded: isFieldSessionBackgrounded(),
  }
}

export function publishLifecycleRecovery(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & {
    __hudLifecycleRecovery?: () => LifecycleRecoveryStats
    __hudSimulateForegroundResume?: () => void
  }
  w.__hudLifecycleRecovery = getLifecycleRecoveryStats
  w.__hudSimulateForegroundResume = onForegroundResume
}

export function __resetLifecycleRecoveryForTests(): void {
  resumeCount = 0
  lastResumeAt = null
  lastIntegrityCheckAt = null
  integrityIssues = []
  installed = false
}
