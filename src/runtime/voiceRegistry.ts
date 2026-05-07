/**
 * VOICE COMMAND REGISTRY — validator + structured parser observability.
 *
 * Single-source-of-truth for answering:
 *   "What commands actually exist and are actually executable right now?"
 *
 * This module is BEHAVIORALLY INERT. It does not register commands, alter
 * dispatch, or change wake-word semantics. It only:
 *   1. Inspects the live registry (`CommandDescriptor[]` from
 *      `useHudCommands`) plus the voice-directory UI declaration and
 *      computes a `VoiceRegistryReport`.
 *   2. Provides `recordVoiceParserEvent()` which emits a structured
 *      `[VOICE]` log line and records the event into the rolling
 *      `voiceEvents` buffer in `runtimeSnapshot`.
 *
 * Reason codes (`VoiceParserResult.reason`):
 *   - executed             : handler returned ok
 *   - empty                : transcript was blank after normalization
 *   - unknown              : no id/alias matched
 *   - handler-fail         : handler returned ok=false (capability/state)
 *   - error                : handler threw
 *
 * `validateVoiceRegistry()` is intended to be called once per registry
 * change. The result is mirrored into `runtimeSnapshot.voiceRegistry` and
 * surfaced in the runtime debug overlay.
 */

export interface VoiceCommandLike {
  id: string
  label: string
  aliases?: string[]
  paletteVisible?: boolean
  group?: string
}

export interface VoiceDirectoryItem {
  group: string
  cmd: string
  label: string
}

export interface VoiceRegistryReport {
  totalCommands: number
  totalAliases: number
  paletteVisible: number
  /** Aliases (or ids) that resolve to more than one command. */
  duplicateAliases: { phrase: string; commandIds: string[] }[]
  /** Voice-directory `cmd` values that don't resolve to a registered id/alias. */
  ghostDirectoryItems: { group: string; cmd: string; label: string }[]
  /** Voice-directory items where the displayed label diverges from the registry label. */
  labelMismatches: { cmd: string; uiLabel: string; registryLabel: string }[]
  /** Commands that are not in the palette and not in the voice directory.
   *  These are voice-only / stub commands; not necessarily a defect. */
  hiddenVoiceOnly: string[]
  /** Commands that are referenced from the directory and resolved cleanly. */
  resolvedDirectoryItems: number
  /** Phrase → matched command id index (alias map). */
  aliasIndex: Record<string, string>
  /** Time the report was computed. */
  computedAt: number
}

export const EMPTY_VOICE_REGISTRY_REPORT: VoiceRegistryReport = {
  totalCommands: 0,
  totalAliases: 0,
  paletteVisible: 0,
  duplicateAliases: [],
  ghostDirectoryItems: [],
  labelMismatches: [],
  hiddenVoiceOnly: [],
  resolvedDirectoryItems: 0,
  aliasIndex: {},
  computedAt: 0,
}

/**
 * Use the same normalization the dispatcher uses so the validator and
 * the runtime parser cannot disagree.
 */
export function normalizeVoicePhrase(input: string): string {
  return input.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function validateVoiceRegistry(
  commands: VoiceCommandLike[],
  directory: VoiceDirectoryItem[] = [],
): VoiceRegistryReport {
  const aliasOwners = new Map<string, string[]>()
  const aliasIndex: Record<string, string> = {}
  let totalAliases = 0
  let paletteVisible = 0

  for (const c of commands) {
    if (c.paletteVisible) paletteVisible += 1
    const phrases = [c.id, ...(c.aliases ?? [])]
      .map((p) => normalizeVoicePhrase(p))
      .filter((p) => p.length > 0)
    for (const phrase of phrases) {
      totalAliases += 1
      const owners = aliasOwners.get(phrase) ?? []
      owners.push(c.id)
      aliasOwners.set(phrase, owners)
      // First-write wins for the alias index (matches dispatcher's `Array.find`).
      if (!(phrase in aliasIndex)) aliasIndex[phrase] = c.id
    }
  }

  const duplicateAliases: VoiceRegistryReport['duplicateAliases'] = []
  for (const [phrase, owners] of aliasOwners.entries()) {
    if (owners.length > 1) duplicateAliases.push({ phrase, commandIds: owners })
  }

  const directoryCmdIds = new Set<string>()
  const ghostDirectoryItems: VoiceRegistryReport['ghostDirectoryItems'] = []
  const labelMismatches: VoiceRegistryReport['labelMismatches'] = []
  let resolvedDirectoryItems = 0

  for (const item of directory) {
    const norm = normalizeVoicePhrase(item.cmd)
    const ownerId = aliasIndex[norm]
    if (!ownerId) {
      ghostDirectoryItems.push({ group: item.group, cmd: item.cmd, label: item.label })
      continue
    }
    resolvedDirectoryItems += 1
    directoryCmdIds.add(ownerId)
    const owner = commands.find((c) => c.id === ownerId)
    if (owner && owner.label && item.label && owner.label !== item.label) {
      labelMismatches.push({ cmd: item.cmd, uiLabel: item.label, registryLabel: owner.label })
    }
  }

  const hiddenVoiceOnly: string[] = []
  for (const c of commands) {
    if (c.paletteVisible) continue
    if (directoryCmdIds.has(c.id)) continue
    hiddenVoiceOnly.push(c.id)
  }

  return {
    totalCommands: commands.length,
    totalAliases,
    paletteVisible,
    duplicateAliases,
    ghostDirectoryItems,
    labelMismatches,
    hiddenVoiceOnly,
    resolvedDirectoryItems,
    aliasIndex,
    computedAt: Date.now(),
  }
}

// ---------- structured parser observability ----------

export type VoiceParserResultCode =
  | 'executed'
  | 'rejected'

export type VoiceParserReasonCode =
  | 'ok'
  | 'empty'
  | 'unknown'
  | 'handler-fail'
  | 'error'
  | 'wake-word-missing'

export interface VoiceParserEvent {
  ts: number
  /** The raw transcript heard from SR (trimmed only). */
  heard: string
  /** Normalized form (after wake-word strip + lowercase + punctuation). */
  normalized: string
  /** The phrase that matched a registry id/alias, if any. */
  matchedAlias: string | null
  /** Resolved canonical command id, if any. */
  commandId: string | null
  /** Dispatch source. */
  source: 'voice' | 'ui' | 'kbd'
  result: VoiceParserResultCode
  reason: VoiceParserReasonCode
  /** Optional human message (last handler message; truncated). */
  message?: string
}

/**
 * Format a parser event into a single grep-friendly `[VOICE]` line.
 * Pure formatter, no side effects. Used by `runtimeSnapshot.recordVoiceParserEvent`.
 */
export function formatVoiceParserLine(ev: VoiceParserEvent): string {
  const tag = ev.result === 'executed' ? 'executed' : `rejected:${ev.reason}`
  return (
    `heard="${ev.heard.slice(0, 60)}" ` +
    `norm="${ev.normalized.slice(0, 60)}" ` +
    `match=${ev.matchedAlias ?? '∅'} ` +
    `cmd=${ev.commandId ?? '∅'} ` +
    `src=${ev.source} ` +
    `result=${tag}`
  )
}
