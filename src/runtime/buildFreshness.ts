export type BuildFreshnessDiag = {
  changedSinceLastBoot: boolean
  runtimeMismatch: boolean
  staleRuntimeSuspected: boolean
}

/**
 * Pure diagnostic classifier used by DEV-only build freshness logging.
 * No side effects and no reload behavior.
 */
export function classifyBuildFreshness(args: {
  currentBuildId: string
  runtimeBuildId: string | null | undefined
  lastSeenBuildId: string | null | undefined
}): BuildFreshnessDiag {
  const current = (args.currentBuildId ?? '').trim()
  const runtime = (args.runtimeBuildId ?? '').trim()
  const lastSeen = (args.lastSeenBuildId ?? '').trim()
  const changedSinceLastBoot = lastSeen.length > 0 && lastSeen !== current
  const runtimeMismatch = runtime.length > 0 && runtime !== current
  return {
    changedSinceLastBoot,
    runtimeMismatch,
    staleRuntimeSuspected: changedSinceLastBoot || runtimeMismatch,
  }
}
