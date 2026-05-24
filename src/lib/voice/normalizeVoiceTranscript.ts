/**
 * Voice transcript normalization — shared by VoicePanel and command dispatch.
 * Collapses speech-recognizer spelled wake word ("h u d") to the token "hud".
 */

/** "h u d", "H U D", "h  u  d" → "hud" (word boundaries only). */
export function collapseSpelledWakeWord(text: string): string {
  return text.replace(/\bh\s+u\s+d\b/gi, 'hud')
}

/** Web Speech often hears "hood" / "hut" instead of "hud" — wake gate only. */
export function normalizeWakeHomophones(text: string): string {
  let s = text.trim()
  if (!s) return s
  s = s.replace(/^hood\b/, 'hud')
  s = s.replace(/^hut\b/, 'hud')
  s = s.replace(/^had\b/, 'hud')
  s = s.replace(/^hot\b/, 'hud')
  return s
}

export function normalizeVoiceTranscript(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return collapseSpelledWakeWord(base)
}

/** Full normalize for wake-word gate (spelled + homophones). */
export function normalizeForWakeGate(input: string): string {
  return normalizeWakeHomophones(normalizeVoiceTranscript(input))
}

export function hasWakeWordPrefix(norm: string, wakeWord = 'hud'): boolean {
  return norm === wakeWord || norm.startsWith(`${wakeWord} `)
}

/** SR often prefixes unrelated words before/after "HUD"; gate from first wake token. */
export function sliceFromFirstWakeToken(norm: string, wakeWord = 'hud'): string | null {
  const re = new RegExp(`\\b${wakeWord}\\b`)
  const m = re.exec(norm)
  if (!m || m.index === undefined) return null
  return norm.slice(m.index)
}

/** UI / status line — never show letter-spelled wake word to the operator. */
export function formatVoicePhraseForDisplay(input: string): string {
  const norm = normalizeVoiceTranscript(input)
  if (!norm) return ''
  return norm.replace(/\bhud\b/g, 'HUD')
}

/** SR picks up wake-ack TTS ("Yes.") into the follow-up phrase — strip before dispatch. */
export function stripWakeAckEchoFromContinuation(phrase: string): string {
  let s = phrase.trim()
  if (!s) return s
  while (/^yes\.?\s+/i.test(s)) {
    s = s.replace(/^yes\.?\s+/i, '').trim()
  }
  if (s === 'yes' || s === 'yes.') return ''
  return s.replace(/\byes\.?\b/gi, ' ').replace(/\s+/g, ' ').trim()
}

/** After wake strip, SR often emits duplicate "hud" tokens ("hud hud weather"). */
export function stripRepeatedWakePrefix(commandPart: string, wakeWord = 'hud'): string {
  let rest = commandPart.trim()
  while (rest === wakeWord || rest.startsWith(`${wakeWord} `)) {
    rest = rest === wakeWord ? '' : rest.slice(wakeWord.length + 1).trim()
  }
  return rest
}
