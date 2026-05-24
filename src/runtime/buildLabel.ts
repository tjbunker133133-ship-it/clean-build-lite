/** Human-readable build label for StatusRail / diagnostics. */
export function formatBuildLabel(raw: string): string {
  const id = (raw ?? '').trim()
  if (!id) return 'unknown'
  if (id.includes('T') && id.length >= 16) {
    return id.replace('T', ' ').slice(0, 16)
  }
  if (id.length > 12) return id.slice(0, 12)
  return id
}
