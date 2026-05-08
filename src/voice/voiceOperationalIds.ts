/** Command ids permitted when `dispatch(cmd, 'voice', …)` runs. */
export const VOICE_OPERATIONAL_COMMAND_IDS = new Set<string>([
  'drop waypoint',
  'check in',
  'weather',
  'flashlight on',
  'flashlight off',
  'flashlight toggle',
  'start beacon',
  'stop beacon',
  'clear trail',
  'sos confirm',
  'help',
])

export function isVoiceOperationalCommandId(id: string): boolean {
  return VOICE_OPERATIONAL_COMMAND_IDS.has(id)
}
