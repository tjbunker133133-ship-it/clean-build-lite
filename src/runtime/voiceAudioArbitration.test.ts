import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  armRecognitionIgnoreUntil,
  isHudSpeechActive,
  registerHudAudioStopListener,
  setRecognitionOutputHold,
  shouldBlockSpeechRecognition,
  speechRecognitionBlockRemainingMs,
  stopAllHudAudio,
} from './voiceAudioArbitration'

describe('voiceAudioArbitration', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', { now: () => 1000 })
  })

  afterEach(() => {
    stopAllHudAudio('test-reset')
    vi.unstubAllGlobals()
  })

  it('blocks recognition while speech or hold is active', () => {
    expect(shouldBlockSpeechRecognition()).toBe(false)
    setRecognitionOutputHold(true)
    expect(shouldBlockSpeechRecognition()).toBe(true)
    expect(speechRecognitionBlockRemainingMs()).toBeGreaterThan(0)
    setRecognitionOutputHold(false)
    armRecognitionIgnoreUntil(5000)
    expect(shouldBlockSpeechRecognition()).toBe(true)
    expect(speechRecognitionBlockRemainingMs()).toBeGreaterThan(0)
  })

  it('stopAll invokes registered listeners and clears speech gate', () => {
    const stop = vi.fn()
    const unregister = registerHudAudioStopListener(stop)
    stopAllHudAudio('unit-test')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(isHudSpeechActive()).toBe(false)
    expect(shouldBlockSpeechRecognition()).toBe(false)
    unregister()
  })
})
