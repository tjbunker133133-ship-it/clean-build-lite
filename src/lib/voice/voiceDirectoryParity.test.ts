import { describe, expect, it } from 'vitest'
import { validateVoiceRegistry } from '../../runtime/voiceRegistry'

/** Voice panel quick-access buttons — must resolve in the command registry. */
const VOICE_DIRECTORY_CMDS = [
  'morse toggle',
  'torch toggle',
  'torch on',
  'torch off',
  'center',
  'zoom in',
  'zoom out',
  'status',
  'add pin',
  'route stats',
  'reset',
  'weather',
  'night',
  'low light',
  'bright',
] as const

const STUB_COMMANDS = VOICE_DIRECTORY_CMDS.map((cmd) => ({
  id: cmd,
  label: cmd,
  aliases: [] as string[],
}))

describe('voice directory parity', () => {
  it('every quick-access button cmd resolves in the registry alias index', () => {
    const report = validateVoiceRegistry(
      STUB_COMMANDS,
      VOICE_DIRECTORY_CMDS.map((cmd) => ({ group: 'test', cmd, label: cmd })),
    )
    expect(report.ghostDirectoryItems).toEqual([])
    expect(report.resolvedDirectoryItems).toBe(VOICE_DIRECTORY_CMDS.length)
  })
})
