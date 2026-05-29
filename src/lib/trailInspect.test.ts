import { describe, expect, it } from 'vitest'
import {
  buildTrailInspectLinks,
  openTrailInspectLink,
  trailLabelsFromProperties,
} from './trailInspect'

describe('trailInspect', () => {
  it('reads name and ref from OSM-style properties', () => {
    const labels = trailLabelsFromProperties(
      { name: 'North Fork Trail', ref: '1309', class: 'hiking' },
      'hiking',
    )
    expect(labels.name).toBe('North Fork Trail')
    expect(labels.ref).toBe('1309')
  })

  it('builds only allowlisted https links', () => {
    const links = buildTrailInspectLinks('North Fork Trail', '1309', 39.55, -105.78)
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const link of links) {
      expect(link.url.startsWith('https://')).toBe(true)
      expect(link.url).toMatch(/recreation\.gov|fs\.usda\.gov|openstreetmap\.org/)
    }
  })

  it('rejects non-allowlisted openTrailInspectLink', () => {
    const ok = openTrailInspectLink('https://evil.example/trail')
    expect(ok).toBe(false)
  })
})
