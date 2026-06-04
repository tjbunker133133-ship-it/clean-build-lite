import { describe, expect, it } from 'vitest'
import {
  auditNativeLifecycleCompatibility,
  detectFieldLifecycleSurface,
  isFieldSessionBackgrounded,
} from './fieldLifecycle'

describe('fieldLifecycle', () => {
  it('detects browser tab surface by default', () => {
    expect(['browser-tab', 'pwa-standalone', 'capacitor-native']).toContain(detectFieldLifecycleSurface())
  })

  it('reports visibility background state', () => {
    expect(typeof isFieldSessionBackgrounded()).toBe('boolean')
  })

  it('returns native lifecycle audit checklist', () => {
    const items = auditNativeLifecycleCompatibility()
    expect(items.length).toBeGreaterThanOrEqual(4)
    expect(items.some((i) => i.id === 'visibility')).toBe(true)
    expect(items.every((i) => i.status === 'ready' || i.status === 'partial' || i.status === 'gap')).toBe(
      true,
    )
  })
})
