/**
 * Voice transcript normalization — shared by VoicePanel and command dispatch.
 * Collapses speech-recognizer spelled wake word ("h u d") to the token "hud".
 */

/** "h u d", "H U D", "h  u  d" → "hud" (word boundaries only). */
export function collapseSpelledWakeWord(text: string): string {
  return text.replace(/\bh\s+u\s+d\b/gi, 'hud')
}

/** SR homophones for the wake token — wake gate only (not general command text). */
const WAKE_HOMOPHONE_RE = /\b(hud|hi|hood|hut|had|hot)\b/

/** Web Speech often hears "hi" / "hood" / "hut" instead of "hud" — wake gate only. */
export function normalizeWakeHomophones(text: string): string {
  let s = text.trim()
  if (!s) return s
  s = s.replace(/^hi\b/, 'hud')
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
  const m = WAKE_HOMOPHONE_RE.exec(norm)
  if (!m || m.index === undefined) return null
  const tail = norm.slice(m.index + m[0].length)
  return tail ? `${wakeWord}${tail}` : wakeWord
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

/**
 * Clean up SR contamination: repeated trailing fragments like "flashlight on flashlight".
 * Removes repeated word sequences at the end of transcript.
 */
export function stripTrailingFragmentRepetition(phrase: string): string {
  const trimmed = phrase.trim()
  if (!trimmed) return trimmed

  const words = trimmed.split(/\s+/)
  if (words.length < 3) return trimmed

  // Pattern 1: "A B C A B" (first N words repeated at end)
  for (let repeatLen = 2; repeatLen <= Math.floor(words.length / 2); repeatLen++) {
    const prefix = words.slice(0, repeatLen).join(' ')
    const suffix = words.slice(-repeatLen).join(' ')
    if (prefix === suffix) {
      return words.slice(0, words.length - repeatLen).join(' ').trim()
    }
  }

  // Pattern 2: "A B A" (single word repeated at end - common SR stutter)
  if (words.length >= 3 && words[0] === words[words.length - 1]) {
    return words.slice(0, -1).join(' ').trim()
  }

  // Pattern 3: "A B C B" (last word matches second word)
  if (words.length === 4 && words[1] === words[3]) {
    return words.slice(0, -1).join(' ').trim()
  }

  return trimmed
}

/**
 * Clean up command phrase: remove leading/trailing junk, fix spacing.
 */
export function cleanCommandPhrase(phrase: string): string {
  return phrase
    .replace(/\s+/g, ' ')
    .trim()
}
