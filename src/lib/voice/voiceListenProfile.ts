import { getDeviceProfile } from '../../runtime/deviceProfile'

export type VoiceListenMode = 'off' | 'powerSave' | 'hardListen'

/** Mic / TTS policy for the Web Speech stack (field HUD). */
export type VoiceListenProfile = {
  mode: VoiceListenMode
  powerSave: boolean
  continuous: boolean
  interimResults: boolean
  minRestartGapMs: number
  outputCooldownMs: number
  chimeOnWake: boolean
  pauseSrDuringTts: boolean
  maxRestartAttempts: number
  wakeContinuationMs: number
}

function desktopProfile(): VoiceListenProfile {
  return {
    mode: 'hardListen',
    powerSave: false,
    continuous: true,
    interimResults: false,
    minRestartGapMs: 400,
    outputCooldownMs: 1200,
    chimeOnWake: true,
    pauseSrDuringTts: true,
    maxRestartAttempts: 6,
    wakeContinuationMs: 7000,
  }
}

function mobilePowerSaveProfile(): VoiceListenProfile {
  const p = getDeviceProfile()
  return {
    mode: 'powerSave',
    powerSave: true,
    continuous: false,
    interimResults: false,
    minRestartGapMs: p.type === 'tablet' ? 14_000 : 10_000,
    outputCooldownMs: 2200,
    chimeOnWake: p.isIOS,
    pauseSrDuringTts: true,
    maxRestartAttempts: 4,
    wakeContinuationMs: 9000,
  }
}

function mobileHardListenProfile(): VoiceListenProfile {
  const p = getDeviceProfile()
  return {
    mode: 'hardListen',
    powerSave: false,
    continuous: true,
    interimResults: p.isAndroid,
    minRestartGapMs: p.type === 'tablet' ? 900 : 700,
    outputCooldownMs: 2000,
    chimeOnWake: p.isIOS,
    pauseSrDuringTts: true,
    maxRestartAttempts: 8,
    wakeContinuationMs: 12_000,
  }
}

export function getVoiceListenProfile(mode: VoiceListenMode = 'off'): VoiceListenProfile {
  if (mode === 'off') return mobilePowerSaveProfile()
  const p = getDeviceProfile()
  if (p.interactionMode !== 'mobile') {
    return mode === 'powerSave'
      ? { ...desktopProfile(), mode: 'powerSave', powerSave: true, pauseSrDuringTts: true }
      : desktopProfile()
  }
  if (mode === 'powerSave') return mobilePowerSaveProfile()
  return mobileHardListenProfile()
}
