function readViteEnv(name: string): string {
  return (
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name] ?? ''
  ).trim()
}

function parseBool(raw: string, defaultValue: boolean): boolean {
  if (raw === '') return defaultValue
  const v = raw.toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return defaultValue
}

export type SnapFeatureFlags = {
  pipelineEnabled: boolean
  validationEnabled: boolean
  diagnosticsEnabled: boolean
}

/** Env-gated snap pipeline integration (Phase 1b). */
export function readSnapFeatureFlags(): SnapFeatureFlags {
  return {
    pipelineEnabled: parseBool(readViteEnv('VITE_ENABLE_SNAP_PIPELINE'), false),
    validationEnabled: parseBool(readViteEnv('VITE_ENABLE_SNAP_VALIDATION'), true),
    diagnosticsEnabled: parseBool(readViteEnv('VITE_ENABLE_SNAP_DIAGNOSTICS'), true),
  }
}

let cached: SnapFeatureFlags | null = null

export function getSnapFeatureFlags(): SnapFeatureFlags {
  if (!cached) cached = readSnapFeatureFlags()
  return cached
}

/** Test-only: clear memoized flags after vi.stubEnv. */
export function resetSnapFeatureFlagsCacheForTests(): void {
  cached = null
}

/** Test-only: Vite bakes import.meta.env — unit-test parsing in isolation. */
export function parseSnapEnvBoolForTests(raw: string, defaultValue: boolean): boolean {
  return parseBool(raw, defaultValue)
}
