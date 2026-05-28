import { describe, expect, it } from 'vitest'
import {
  collapseSpelledWakeWord,
  formatVoicePhraseForDisplay,
  hasWakeWordPrefix,
  normalizeForWakeGate,
  normalizeVoiceTranscript,
  sliceFromFirstWakeToken,
  stripRepeatedWakePrefix,
  stripWakeAckEchoFromContinuation,
} from './normalizeVoiceTranscript'

describe('normalizeVoiceTranscript', () => {
  it('collapses spelled wake word h-u-d to hud', () => {
    expect(normalizeVoiceTranscript('H U D')).toBe('hud')
    expect(normalizeVoiceTranscript('h u d center')).toBe('hud center')
    expect(normalizeVoiceTranscript('  h   u   d   weather  ')).toBe('hud weather')
  })

  it('leaves normal hud token unchanged', () => {
    expect(normalizeVoiceTranscript('HUD center')).toBe('hud center')
    expect(normalizeVoiceTranscript('hud')).toBe('hud')
  })

  it('does not collapse unrelated words', () => {
    expect(collapseSpelledWakeWord('huge umbrella day')).toBe('huge umbrella day')
  })

  it('formats display with HUD token not h u d', () => {
    expect(formatVoicePhraseForDisplay('h u d weather')).toBe('HUD weather')
  })

  it('strips repeated hud prefixes from command tail', () => {
    expect(stripRepeatedWakePrefix('hud weather')).toBe('weather')
    expect(stripRepeatedWakePrefix('hud hud center')).toBe('center')
  })

  it('maps common SR homophones at utterance start to hud', () => {
    expect(normalizeForWakeGate('hood weather')).toBe('hud weather')
    expect(normalizeForWakeGate('hi weather')).toBe('hud weather')
    expect(hasWakeWordPrefix(normalizeForWakeGate('hood'))).toBe(true)
    expect(hasWakeWordPrefix(normalizeForWakeGate('hi'))).toBe(true)
  })

  it('does not treat "high" as wake homophone', () => {
    expect(normalizeForWakeGate('high terrain')).toBe('high terrain')
    expect(sliceFromFirstWakeToken('high terrain')).toBeNull()
  })

  it('slices wake gate from first hud token when SR adds leading junk', () => {
    expect(sliceFromFirstWakeToken('what they were on the corner hud')).toBe('hud')
    expect(sliceFromFirstWakeToken('what hi weather')).toBe('hud weather')
    expect(sliceFromFirstWakeToken('hud weather')).toBe('hud weather')
    expect(sliceFromFirstWakeToken('weather')).toBeNull()
  })

  it('strips wake-ack TTS echo from continuation phrases', () => {
    expect(stripWakeAckEchoFromContinuation('yes weather')).toBe('weather')
    expect(stripWakeAckEchoFromContinuation('yes status')).toBe('status')
    expect(stripWakeAckEchoFromContinuation('yes')).toBe('')
  })
})
