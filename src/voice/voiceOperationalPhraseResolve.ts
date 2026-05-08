/**
 * Voice-only intent resolution: operational commands, tighter fuzzy gates,
 * no panel-open synonyms.
 */

import type { CommandDescriptor } from '../hooks/useHudCommands'

export type VoiceOperationalIntent = {
  command: string | null
  confidence: number
  reason: 'exact' | 'synonym' | 'fuzzy' | 'unknown'
  suggestion: string | null
}

/** Fuzzy scores at or above this execute without clarification. */
const VOICE_FUZZY_EXECUTE_MIN = 0.78
/** Below execute min but at or above this → "Did you mean …?" instead of guessing. */
const VOICE_FUZZY_CLARIFY_MIN = 0.52
/** SR confidence floor: combined with fuzzy intent confidence. */
const VOICE_SR_EFFECTIVE_MIN = 0.45

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function normalizeTranscript(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,!?;:'"`~@#$%^&*()_+=\-[\]{}\\/|<>]/g, ' ')
    .replace(/\b(please|uh|um|like|okay|ok|hey|now|just)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinDistance(a: string, b: string): number {
  const aa = a.trim()
  const bb = b.trim()
  if (aa === bb) return 0
  if (!aa) return bb.length
  if (!bb) return aa.length
  const dp = Array.from({ length: aa.length + 1 }, () => new Array<number>(bb.length + 1).fill(0))
  for (let i = 0; i <= aa.length; i += 1) dp[i][0] = i
  for (let j = 0; j <= bb.length; j += 1) dp[0][j] = j
  for (let i = 1; i <= aa.length; i += 1) {
    for (let j = 1; j <= bb.length; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[aa.length][bb.length]
}

function similarityScore(a: string, b: string): number {
  const aa = normalize(a)
  const bb = normalize(b)
  if (!aa || !bb) return 0
  if (aa === bb) return 1
  const maxLen = Math.max(aa.length, bb.length)
  if (maxLen === 0) return 1
  const dist = levenshteinDistance(aa, bb)
  return Math.max(0, 1 - dist / maxLen)
}

/** Map free text → canonical command id (must exist on filtered descriptors). */
const OPERATIONAL_SYNONYM_TO_ID: Record<string, string> = {
  'drop waypoint': 'drop waypoint',
  waypoint: 'drop waypoint',
  'drop pin': 'drop waypoint',
  'drop a pin': 'drop waypoint',
  'mark waypoint': 'drop waypoint',
  'place waypoint': 'drop waypoint',

  'check in': 'check in',
  checkin: 'check in',
  'check-in': 'check in',
  beacon: 'check in',
  'routine check in': 'check in',
  'routine check-in': 'check in',
  'send check in': 'check in',
  'send check-in': 'check in',

  weather: 'weather',
  forecast: 'weather',
  'show weather': 'weather',
  'weather report': 'weather',

  'flashlight on': 'flashlight on',
  'flashlight off': 'flashlight off',
  'flashlight toggle': 'flashlight toggle',
  'torch on': 'flashlight on',
  'torch off': 'flashlight off',
  'torch toggle': 'flashlight toggle',
  'light on': 'flashlight on',
  'light off': 'flashlight off',
  'lights on': 'flashlight on',
  'lights off': 'flashlight off',
  'enable flashlight': 'flashlight on',
  'disable flashlight': 'flashlight off',
  'turn on flashlight': 'flashlight on',
  'turn off flashlight': 'flashlight off',

  'start beacon': 'start beacon',
  'beacon on': 'start beacon',
  'enable beacon': 'start beacon',
  'beacon start': 'start beacon',

  'stop beacon': 'stop beacon',
  'beacon off': 'stop beacon',
  'disable beacon': 'stop beacon',
  'beacon stop': 'stop beacon',

  'clear trail': 'clear trail',
  'clear breadcrumb': 'clear trail',
  'clear breadcrumbs': 'clear trail',
  'breadcrumb clear': 'clear trail',
  'reset trail': 'clear trail',

  sos: 'sos',
  emergency: 'sos',
  rescue: 'sos',

  help: 'help',
  commands: 'help',
}

/** Includes `sos confirm` for exact registry match only (no cold synonym). */
const VOICE_RESOLVER_COMMAND_IDS = new Set<string>([
  ...new Set(Object.values(OPERATIONAL_SYNONYM_TO_ID)),
  'sos confirm',
])

function descriptorCoversId(cmds: CommandDescriptor[], id: string): boolean {
  return cmds.some((c) => c.id === id)
}

function filterOperationalDescriptors(cmds: CommandDescriptor[]): CommandDescriptor[] {
  return cmds.filter((c) => VOICE_RESOLVER_COMMAND_IDS.has(c.id))
}

/**
 * @param srConfidence Web Speech final confidence in [0,1], or null/undefined if unknown (treated as neutral).
 */
export function resolveVoiceOperationalIntent(
  phrase: string,
  commands: CommandDescriptor[],
  srConfidence?: number | null,
): VoiceOperationalIntent {
  const filtered = filterOperationalDescriptors(commands)
  const normalized = normalizeTranscript(phrase)
  if (!normalized) return { command: null, confidence: 0, reason: 'unknown', suggestion: null }

  const synId = OPERATIONAL_SYNONYM_TO_ID[normalized]
  if (synId && descriptorCoversId(filtered, synId)) {
    return { command: synId, confidence: 0.95, reason: 'synonym', suggestion: null }
  }

  for (const c of filtered) {
    if (normalize(c.id) === normalized) {
      return { command: c.id, confidence: 1, reason: 'exact', suggestion: null }
    }
    const alias = (c.aliases ?? []).find((a) => normalize(a) === normalized)
    if (alias) {
      return { command: c.id, confidence: 0.98, reason: 'exact', suggestion: null }
    }
  }

  const candidates: Array<{ cmd: string; score: number }> = []
  for (const c of filtered) {
    candidates.push({ cmd: c.id, score: similarityScore(normalized, c.id) })
    for (const a of c.aliases ?? []) candidates.push({ cmd: c.id, score: similarityScore(normalized, a) })
  }
  candidates.sort((a, b) => b.score - a.score)
  const top = candidates[0]
  const second = candidates[1]

  const sr =
    srConfidence != null && Number.isFinite(srConfidence) ? Math.max(0, Math.min(1, srConfidence)) : 1
  const fuzzyIntent = top?.score ?? 0
  const effective = top == null ? 0 : Math.min(sr, fuzzyIntent)

  if (!top || top.score < VOICE_FUZZY_CLARIFY_MIN) {
    return { command: null, confidence: effective, reason: 'unknown', suggestion: null }
  }

  const ambiguousPair =
    second != null &&
    top.score < 0.72 &&
    second.score >= VOICE_FUZZY_CLARIFY_MIN &&
    top.score - second.score < 0.06

  if (ambiguousPair) {
    return { command: null, confidence: effective, reason: 'fuzzy', suggestion: top.cmd }
  }

  if (top.score < VOICE_FUZZY_EXECUTE_MIN) {
    return {
      command: null,
      confidence: effective,
      reason: 'fuzzy',
      suggestion: top.cmd,
    }
  }

  if (sr < VOICE_SR_EFFECTIVE_MIN && top.score < 0.92) {
    return {
      command: null,
      confidence: effective,
      reason: 'fuzzy',
      suggestion: top.cmd,
    }
  }

  return { command: top.cmd, confidence: effective, reason: 'fuzzy', suggestion: null }
}
