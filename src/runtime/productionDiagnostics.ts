/**
 * Phase 8 production diagnostics — aggregates boot, lifecycle, field, and PWA surfaces.
 */

import { collectPhase7Diagnostics } from './phase7Diagnostics'
import { collectBootHealth } from './bootValidation'
import { getLifecycleRecoveryStats } from './lifecycleRecovery'
import { getRafLifecycleStats } from '../perception/motion/rafLifecycle'
import { getRuntimeActivityLevel } from './runtimeActivityPolicy'
import { getRuntimeSnapshot } from './runtimeSnapshot'
import { getFieldPowerSnapshot } from './fieldPowerProfile'
import { collectFieldSoakSnapshot } from './fieldSoakDiagnostics'

export type ProductionDiagnosticSnapshot = {
  timestamp: number
  boot: ReturnType<typeof collectBootHealth>
  lifecycle: ReturnType<typeof getLifecycleRecoveryStats>
  spatial: ReturnType<typeof collectPhase7Diagnostics>
  power: ReturnType<typeof getFieldPowerSnapshot>
  soak: ReturnType<typeof collectFieldSoakSnapshot>
  performance: {
    raf: ReturnType<typeof getRafLifecycleStats>
    activityLevel: ReturnType<typeof getRuntimeActivityLevel>
    swStatus: string
    buildId: string
  }
}

export function collectProductionDiagnostics(): ProductionDiagnosticSnapshot {
  const snap = getRuntimeSnapshot()
  return {
    timestamp: Date.now(),
    boot: collectBootHealth(),
    lifecycle: getLifecycleRecoveryStats(),
    spatial: collectPhase7Diagnostics(),
    power: getFieldPowerSnapshot(),
    soak: collectFieldSoakSnapshot(),
    performance: {
      raf: getRafLifecycleStats(),
      activityLevel: getRuntimeActivityLevel(),
      swStatus: snap.serviceWorker.status,
      buildId: snap.buildId,
    },
  }
}

export function publishProductionDiagnostics(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & {
    __hudProductionDiagnostics?: () => ProductionDiagnosticSnapshot
  }
  w.__hudProductionDiagnostics = collectProductionDiagnostics
}
