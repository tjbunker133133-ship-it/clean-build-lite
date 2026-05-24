/** Human-readable build label for diagnostics. */
export function formatBuildLabel(raw: string): string {
  const id = (raw ?? '').trim()
  if (!id) return 'unknown'
  if (id.includes('T') && id.length >= 16) {
    return id.replace('T', ' ').slice(0, 16)
  }
  if (id.length > 12) return id.slice(0, 12)
  return id
}

/** Compile-time build stamp injected by Vite (`__BUILD_ID__` / `VITE_BUILD_STAMP`). */
export function resolveBuildLabel(): string {
  const env = import.meta.env as {
    VITE_BUILD_STAMP?: string
    VITE_GIT_COMMIT?: string
  }
  const raw =
    typeof __BUILD_ID__ === 'string' && __BUILD_ID__.length > 0
      ? __BUILD_ID__
      : typeof env.VITE_BUILD_STAMP === 'string' && env.VITE_BUILD_STAMP.length > 0
        ? env.VITE_BUILD_STAMP
        : typeof env.VITE_GIT_COMMIT === 'string' && env.VITE_GIT_COMMIT.length > 0
          ? env.VITE_GIT_COMMIT
          : ''
  return formatBuildLabel(raw)
}
