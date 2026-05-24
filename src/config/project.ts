import meta from '../../projects/hud-v1/project.json'

export const HUD_PROJECT = {
  displayName: meta.displayName,
  shortName: meta.shortName,
  slug: meta.slug,
  version: meta.version,
  canonicalVercelProject: meta.canonicalVercelProject,
  productionBranch: meta.productionBranch,
  legacyVercelProjects: meta.legacyVercelProjects as readonly string[],
} as const

export function hudDisplayName(): string {
  return HUD_PROJECT.displayName
}
