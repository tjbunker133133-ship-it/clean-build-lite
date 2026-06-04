import { describe, expect, it, vi } from 'vitest'
import { buildOverlayVoiceCommands } from './overlayVoiceCommands'

describe('overlay voice commands', () => {
  it('registers show fire map and map layers panel', () => {
    const setEnabled = vi.fn().mockReturnValue({ applied: true })
    const cmds = buildOverlayVoiceCommands({
      setEnabled,
      raiseLayersPanel: vi.fn(),
    })
    const fireOn = cmds.find((c) => c.id === 'overlay fire_firms on')
    expect(fireOn?.aliases).toContain('show fire map')
    const panel = cmds.find((c) => c.id === 'map layers panel')
    expect(panel?.aliases).toContain('layers panel')
  })

  it('fire on reports FIRMS key error from setEnabled', async () => {
    const setEnabled = vi.fn().mockReturnValue({
      applied: false,
      error: 'FIRMS MAP_KEY not in this build — add VITE_FIRMS_MAP_KEY to .env.local, sync Vercel, redeploy',
    })
    const cmds = buildOverlayVoiceCommands({
      setEnabled,
      raiseLayersPanel: vi.fn(),
    })
    const fireOn = cmds.find((c) => c.id === 'overlay fire_firms on')!
    const result = await fireOn.run({ source: 'voice' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('FIRMS')
    expect(setEnabled).toHaveBeenCalledWith('fire_firms', true)
  })
})
