import { classifyBuildFreshness } from './buildFreshness'

export const FORCE_UPDATE_META_KEY = 'hud_force_update_meta_v1'
export const SW_DEFERRED_RELOAD_KEY = 'hud_sw_deferred_reload_v1'

export type ForceUpdateMeta = {
  requestedAt: number
  requestBuildId: string
  controllerChangeObserved: boolean
  reloadRequested: boolean
  reloadRequestedAt?: number
  controllerChangeAt?: number
  controllerUrl?: string | null
}

export type StaleRuntimeReason =
  | 'none'
  | 'runtime_mismatch'
  | 'build_changed_since_last_boot'
  | 'runtime_mismatch_and_build_changed'
  | 'runtime_missing'

export function createForceUpdateMeta(input: {
  requestedAt: number
  requestBuildId: string
}): ForceUpdateMeta {
  return {
    requestedAt: input.requestedAt,
    requestBuildId: input.requestBuildId,
    controllerChangeObserved: false,
    reloadRequested: false,
  }
}

export function mergeForceUpdateMeta(
  previous: Record<string, unknown> | null | undefined,
  patch: Partial<ForceUpdateMeta>,
): ForceUpdateMeta {
  const base = isForceUpdateMeta(previous)
    ? previous
    : createForceUpdateMeta({
        requestedAt: Date.now(),
        requestBuildId: '',
      })
  return { ...base, ...patch }
}

export function classifyStaleRuntimeReason(input: {
  currentBuildId: string
  runtimeBuildId: string | null | undefined
  lastSeenBuildId: string | null | undefined
}): { staleRuntimeSuspected: boolean; reason: StaleRuntimeReason } {
  const runtime = (input.runtimeBuildId ?? '').trim()
  if (runtime.length === 0) {
    return { staleRuntimeSuspected: true, reason: 'runtime_missing' }
  }
  const freshness = classifyBuildFreshness(input)
  if (freshness.runtimeMismatch && freshness.changedSinceLastBoot) {
    return { staleRuntimeSuspected: true, reason: 'runtime_mismatch_and_build_changed' }
  }
  if (freshness.runtimeMismatch) {
    return { staleRuntimeSuspected: true, reason: 'runtime_mismatch' }
  }
  if (freshness.changedSinceLastBoot) {
    return { staleRuntimeSuspected: true, reason: 'build_changed_since_last_boot' }
  }
  return { staleRuntimeSuspected: false, reason: 'none' }
}

function isForceUpdateMeta(value: unknown): value is ForceUpdateMeta {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.requestedAt === 'number' &&
    typeof v.requestBuildId === 'string' &&
    typeof v.controllerChangeObserved === 'boolean' &&
    typeof v.reloadRequested === 'boolean'
  )
}
