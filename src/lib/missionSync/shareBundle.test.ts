import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { copyMissionBundle, shareMissionBundle } from './shareBundle'

describe('shareBundle', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      share: undefined,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('copies non-empty bundle text', async () => {
    const ok = await copyMissionBundle('HUDMS1:abc')
    expect(ok).toBe(true)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('HUDMS1:abc')
  })

  it('returns failed for empty bundle', async () => {
    expect(await shareMissionBundle('')).toBe('failed')
  })

  it('falls back to copy when share unavailable', async () => {
    const result = await shareMissionBundle('HUDMS1:test', { title: 'Join' })
    expect(result).toBe('copied')
  })
})
