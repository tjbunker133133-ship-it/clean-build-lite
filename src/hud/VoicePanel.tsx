import { useEffect, useMemo, useRef, useState } from 'react'
import HudPanel from './HudPanel'
import { requestMicrophonePermission } from '../lib/devicePermissions'
import { useHudCommands, type CommandSource } from '../hooks/useHudCommands'
import {
  recordWakeWordGatePassed,
  updatePermission,
  updateVoiceArmed,
  updateVoiceMeta,
  updateVoiceState,
  updateVoiceRecoveryState,
  updateVoiceRegistryReport,
} from '../runtime/runtimeSnapshot'
import { enforcePolicyAttempt, reportPolicyAttempt } from '../runtime/devicePolicy'
import { validateVoiceRegistry, type VoiceDirectoryItem } from '../runtime/voiceRegistry'
import { logInfo, logWarn } from '../runtime/logger'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { shouldAttemptVoiceRecovery, shouldTreatOnEndAsLifecycleSuspend } from '../runtime/voiceRecovery'
import { traceAction } from '../runtime/actionTrace'
import {
  touchFontSm as touchFontSmFn,
  touchGapMd as touchGapMdFn,
  touchGapSm as touchGapSmFn,
  touchMinTarget as touchMinTargetFn,
} from './tokens'
import { resolveVoiceOperationalIntent } from '../voice/voiceOperationalPhraseResolve'

/** SR / parser debug only — keeps transcripts and intent objects out of production consoles. */
function voiceDevLog(...args: unknown[]) {
  if (import.meta.env.DEV) console.log(...args)
}

type VoiceState = 'sleeping' | 'listening' | 'processing' | 'success' | 'failure'

// SYSTEM RULE: HUD is the ONLY valid activation token.
// No aliases, no fuzzy matching, no fallback activation allowed.
// This constant is the single source of truth for the wake word and is the
// only string that can authorize voice command execution.
const WAKE_WORD = 'hud' as const

// Cross-platform utterance continuity window: after a bare "HUD"
// finalization the runtime keeps a one-shot 2500ms window during which a
// short, simple follow-up transcript ("weather", "center map") is
// treated as if it had "HUD " prefixed. This is NOT conversational mode
// — the window is one-shot, deterministic, auto-clears on consume /
// timeout / disarm / SR teardown, and does NOT bypass DEPE wake-word
// policy (the gate is reported 'enable' both for direct wake-word
// utterances and for continuation consumption).
const WAKE_CONTINUATION_MS = 2500
const DUPLICATE_TRANSCRIPT_SUPPRESS_MS = 2200
const DUPLICATE_COMMAND_SUPPRESS_MS = 1400
const WAKE_ACK_COOLDOWN_MS = 1200
/** Ignore identical wake+command finals within this window (stops “HUD HUD” re-entry churn). */
const WAKE_PROCESS_DEBOUNCE_MS = 1100
/**
 * Intent matcher: execution-first. Fuzzy matches at or above this score run without
 * clarification; below this we treat as unknown (optional “Did you mean” only when a
 * single weak suggestion exists — see resolveIntentFromPhrase).
 */
const FUZZY_EXECUTE_MIN_SCORE = 0.5
/** Only ask “Did you mean …?” when best fuzzy score is in this ambiguous band and a suggestion exists. */
const CLARIFICATION_FUZZY_MAX = 0.52
/** Brief on-screen preview before executing a voice command (ms). */
const VOICE_COMMAND_PREVIEW_MS = 420
// Final-transcript sanity bounds. Reject empty/whitespace/single-char
// finals (common Android Chrome partial-flush garbage) and refuse to
// consume the continuation window with long, multi-clause speech that
// almost certainly is not a HUD command.
const SANITY_MIN_FINAL_LEN = 2
const SANITY_MAX_CONTINUATION_WORDS = 6
const SANITY_MAX_CONTINUATION_CHARS = 60

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  try {
    if (sessionStorage.getItem('hud_voice_muted') === '1') return
  } catch {
    // ignore storage errors
  }
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}

function playChime() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 800
    gain.gain.value = 0.05
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    window.setTimeout(() => {
      osc.stop()
      void ctx.close()
    }, 200)
  } catch {
    // ignore audio errors
  }
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeTranscript(input: string): string {
  const stripped = input
    .toLowerCase()
    .replace(/[.,!?;:'"`~@#$%^&*()_+=\-[\]{}\\/|<>]/g, ' ')
    .replace(/\b(please|uh|um|like|okay|ok|hey|now|just)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped
}

function stripWakeWordPrefix(input: string): { commandPart: string; wakeDetected: boolean } {
  const s = normalizeTranscript(input)
  const m = s.match(/^(hud(?:\s+hud)*)\b/)
  if (!m) return { commandPart: s, wakeDetected: false }
  const rest = s.slice(m[0].length).trim()
  return { commandPart: rest, wakeDetected: true }
}

/** Strip any repeated “hud ” prefixes SR may leave inside the command phrase. */
function stripLeadingHudTokens(phrase: string): string {
  let p = phrase.trim()
  let prev = ''
  while (p !== prev) {
    prev = p
    p = p.replace(/^(hud)\s+/i, '').trim()
  }
  return p
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

type IntentResolution = {
  command: string | null
  confidence: number
  reason: 'exact' | 'synonym' | 'fuzzy' | 'unknown'
  suggestion: string | null
}

function resolveIntentFromPhrase(
  phrase: string,
  commands: Array<{ id: string; aliases?: string[] }>,
): IntentResolution {
  const normalized = normalizeTranscript(phrase)
  if (!normalized) return { command: null, confidence: 0, reason: 'unknown', suggestion: null }

  const synonymToIntent: Record<string, string> = {
    bright: 'bright',
    'bright mode': 'bright',
    'day mode': 'bright',
    'normal mode': 'bright',
    'daylight mode': 'bright',
    gps: 'center',
    'center gps': 'center',
    'center map': 'center',
    recenter: 'center',
    'recenter gps': 'center',
    'recenter map': 'center',
    locate: 'center',
    'locate me': 'center',
    'where am i': 'center',
    'where am i on the map': 'center',
    'show my location': 'center',
    'go to my location': 'center',
    'find me': 'center',
    'my location': 'center',
    'night mode': 'night',
    'low light mode': 'low light',
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
    'turn on the flashlight': 'flashlight on',
    'turn off the flashlight': 'flashlight off',
    status: 'status',
    'system status': 'status',
    'hud status': 'status',
    'what is the status': 'status',
    'add pin': 'add pin',
    'drop pin': 'add pin',
    'drop a pin': 'add pin',
    'pin location': 'add pin',
    'mark location': 'add pin',
    'mark my location': 'add pin',
    'add a pin': 'add pin',
    'place pin': 'add pin',
    weather: 'weather',
    forecast: 'weather',
    'show weather': 'weather',
    'weather report': 'weather',
  }
  const synonym = synonymToIntent[normalized]
  if (synonym) return { command: synonym, confidence: 0.95, reason: 'synonym', suggestion: null }

  for (const c of commands) {
    if (normalize(c.id) === normalized) {
      return { command: c.id, confidence: 1, reason: 'exact', suggestion: null }
    }
    const alias = (c.aliases ?? []).find((a) => normalize(a) === normalized)
    if (alias) {
      return { command: c.id, confidence: 0.98, reason: 'exact', suggestion: null }
    }
  }

  const candidates: Array<{ cmd: string; score: number }> = []
  for (const c of commands) {
    candidates.push({ cmd: c.id, score: similarityScore(normalized, c.id) })
    for (const a of c.aliases ?? []) candidates.push({ cmd: c.id, score: similarityScore(normalized, a) })
  }
  candidates.sort((a, b) => b.score - a.score)
  const top = candidates[0]
  const second = candidates[1]
  if (!top || top.score < FUZZY_EXECUTE_MIN_SCORE) {
    return { command: null, confidence: top?.score ?? 0, reason: 'unknown', suggestion: null }
  }
  const ambiguousPair =
    second != null &&
    top.score < 0.72 &&
    second.score >= FUZZY_EXECUTE_MIN_SCORE &&
    top.score - second.score < 0.06
  if (ambiguousPair) {
    return {
      command: null,
      confidence: top.score,
      reason: 'fuzzy',
      suggestion: top.cmd,
    }
  }
  if (top.score < CLARIFICATION_FUZZY_MAX) {
    return { command: top.cmd, confidence: top.score, reason: 'fuzzy', suggestion: null }
  }
  return { command: top.cmd, confidence: top.score, reason: 'fuzzy', suggestion: null }
}

function isAffirmativeVoiceFollowUp(phrase: string): boolean {
  const t = normalizeTranscript(phrase)
  return (
    /^(yes|yeah|yep|yup|correct|right|confirm|confirmed|proceed|arm|ok|okay|do it|go)$/i.test(t) ||
    t === 'confirm sos'
  )
}

function isNegativeVoiceFollowUp(phrase: string): boolean {
  const t = normalizeTranscript(phrase)
  return /^(no|nope|nah|cancel|stop|never mind|nevermind|ignore)$/i.test(t)
}

const QUICK_COMMAND_GROUPS: Array<{
  group: string
  priority?: boolean
  items: Array<{ label: string; cmd: string }>
}> = [
  {
    group: 'Safety',
    priority: true,
    items: [
      { label: 'Flashlight On', cmd: 'flashlight on' },
      { label: 'Flashlight Off', cmd: 'flashlight off' },
      { label: 'Flashlight Toggle', cmd: 'flashlight toggle' },
    ],
  },
  {
    group: 'Field ops',
    items: [
      { label: 'Drop waypoint', cmd: 'drop waypoint' },
      { label: 'Check-in send', cmd: 'check in' },
      { label: 'Show weather', cmd: 'weather' },
      { label: 'Start beacon', cmd: 'start beacon' },
      { label: 'Stop beacon', cmd: 'stop beacon' },
      { label: 'Clear trail', cmd: 'clear trail' },
    ],
  },
  {
    group: 'Voice help',
    items: [{ label: 'Voice command help', cmd: 'help' }],
  },
]

export default function VoicePanel() {
  const { commands, dispatch } = useHudCommands()
  const isMobileHud = getDeviceProfile().interactionMode === 'mobile'
  const touchGapMd = touchGapMdFn(isMobileHud)
  const touchGapSm = touchGapSmFn(isMobileHud)
  const tapMin = touchMinTargetFn(isMobileHud)
  const btnMin = (px: number) => Math.max(tapMin, px)
  const labelPx = (px: number) => Math.max(touchFontSmFn(isMobileHud), px)

  // Flatten the voice directory definition into the validator's expected
  // shape. This lets us answer "are any directory items missing from the
  // registry?" and surface ghost items + label drift in the runtime
  // overlay. Source of truth for what a button does is still the registry
  // descriptor; this UI is a curated subset of that registry.
  const directoryItems = useMemo<VoiceDirectoryItem[]>(
    () =>
      QUICK_COMMAND_GROUPS.flatMap((g) =>
        g.items.map((it) => ({ group: g.group, cmd: it.cmd, label: it.label })),
      ),
    [],
  )

  useEffect(() => {
    const report = validateVoiceRegistry(commands, directoryItems)
    updateVoiceRegistryReport(report)
  }, [commands, directoryItems])

  const [voiceState, setVoiceState] = useState<VoiceState>('sleeping')
  const [expanded, setExpanded] = useState(false)
  // SYSTEM RULE: `armed` IS the SR lifecycle master.
  // - true  → SpeechRecognition is constructed, started, and listens for "HUD"
  // - false → SR is fully torn down (rec.stop + listener removal). No background streams.
  // The "CONTINUOUS ON/OFF" UI button mirrors this single flag.
  const [armed, setArmed] = useState(false)
  const [typed, setTyped] = useState('')
  const [lastHeard, setLastHeard] = useState('')
  // Single SR ownership: the mic button is the ONE control for the SR
  // lifecycle. Label clarifies "tap to start" rather than "tap to wake"
  // so it does not imply a second tap-to-wake mode that competes with
  // continuous mode. The button toggles the same `armed` flag whether
  // continuous mode is on or off.
  const [statusText, setStatusText] = useState('🎤 HUD (tap to start)')
  /** Strong visual ack that the wake word passed (independent of chime cooldown). */
  const [wakeHudAck, setWakeHudAck] = useState(false)
  const wakeHudTimerRef = useRef<number | null>(null)
  /** Shown briefly before a voice command runs. */
  const [commandEcho, setCommandEcho] = useState<string | null>(null)
  const [flashlightCapability, setFlashlightCapability] = useState<{
    supportState: 'unknown' | 'supported' | 'unsupported'
    permission: 'unknown' | 'granted' | 'denied'
  }>({ supportState: 'unknown', permission: 'unknown' })
  const [recoveryNonce, setRecoveryNonce] = useState(0)
  const recognitionRef = useRef<any>(null)
  const armedRef = useRef(false)
  const recoveryAttemptedRef = useRef(false)
  const suspendedByLifecycleRef = useRef(false)
  const restartAttemptsRef = useRef(0)
  const restartTimerRef = useRef<number | null>(null)
  const restartStormRef = useRef<{ windowStart: number; count: number; lastLogAt: number }>({
    windowStart: 0,
    count: 0,
    lastLogAt: 0,
  })
  const uiResetTimerRef = useRef<number | null>(null)
  const lastRecognitionAtRef = useRef<number | null>(null)
  const lastWakeAckAtRef = useRef<number>(0)
  const lastFinalTranscriptRef = useRef<{ norm: string; ts: number }>({ norm: '', ts: 0 })
  const lastDispatchedCommandRef = useRef<{ cmd: string; ts: number }>({ cmd: '', ts: 0 })
  /** Utterance continuity window expiry (`performance.now()` epoch). null
   *  when no bare-wake-word ack is pending. Single-shot: cleared on
   *  consume, timeout, disarm, or SR teardown. */
  const pendingWakeUntilRef = useRef<number | null>(null)
  const lastWakeProcessRef = useRef<{ key: string; ts: number }>({ key: '', ts: 0 })
  armedRef.current = armed
  const parseAndRunRef = useRef<
    (text: string, confidence?: number, transcriptSource?: CommandSource) => Promise<void>
  >(async () => {})
  const sosVoicePendingRef = useRef(false)
  const voiceClarifyCmdRef = useRef<string | null>(null)
  const supportsRec =
    typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  useEffect(() => {
    const onFlashlightCapability = (
      ev: Event,
    ) => {
      const detail = (ev as CustomEvent<{
        supportState?: 'unknown' | 'supported' | 'unsupported'
        permission?: 'unknown' | 'granted' | 'denied'
      }>).detail
      setFlashlightCapability({
        supportState: detail?.supportState ?? 'unknown',
        permission: detail?.permission ?? 'unknown',
      })
    }
    window.addEventListener('hud:flashlight-capability', onFlashlightCapability)
    return () => window.removeEventListener('hud:flashlight-capability', onFlashlightCapability)
  }, [])

  // Mirror support flag into runtime snapshot once on mount.
  useEffect(() => {
    updateVoiceMeta({ supported: supportsRec })
    if (!supportsRec) updateVoiceState('unavailable', { lastError: 'SpeechRecognition unsupported' })
  }, [supportsRec])

  // Mirror armed flag into runtime snapshot + DEPE.
  useEffect(() => {
    updateVoiceArmed(armed)
    if (!armed) {
      restartAttemptsRef.current = 0
      // Disarm clears any pending utterance-continuity window so a fresh
      // arm cycle never inherits a stale bare-wake state.
      pendingWakeUntilRef.current = null
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      updateVoiceMeta({ restartAttempts: 0 })
    }
    // DEPE: SR running while disarmed is forbidden in every mode.
    // We announce the listener's actual state ('enable' when armed, 'disable'
    // when teardown). The engine surfaces a violation if a future change
    // ever leaves a listener running while armed=false.
    reportPolicyAttempt(
      'voice.continuousListening',
      armed ? 'enable' : 'disable',
      'VoicePanel.armed-effect',
    )
    reportPolicyAttempt(
      'voice.backgroundListenerWhenDisarmed',
      armed ? 'disable' : 'disable',
      'VoicePanel.armed-effect',
    )
  }, [armed])

  /** Transient acknowledgement: centralized snapshot signal → CockpitHudShell CSS pulse.
   * Haptic is dispatched by `recordWakeWordGatePassed` via the centralized
   * runtime broker (capability-checked, throttled, mobile-only). SR/parser/
   * dispatch unchanged. */
  const pulseWake = () => {
    recordWakeWordGatePassed()
    playChime()
  }

  const flashWakeHudAck = () => {
    setWakeHudAck(true)
    if (wakeHudTimerRef.current != null) {
      window.clearTimeout(wakeHudTimerRef.current)
    }
    wakeHudTimerRef.current = window.setTimeout(() => {
      wakeHudTimerRef.current = null
      setWakeHudAck(false)
    }, 900)
  }

  /** Status hint without TTS (avoids mic feedback loops on soft errors). */
  const reportSubtle = (text: string) => {
    setStatusText(text)
    setVoiceState('failure')
    if (uiResetTimerRef.current != null) {
      window.clearTimeout(uiResetTimerRef.current)
    }
    uiResetTimerRef.current = window.setTimeout(() => {
      uiResetTimerRef.current = null
      setVoiceState(armedRef.current ? 'listening' : 'sleeping')
    }, 1400)
  }

  const report = (text: string, ok = true) => {
    setStatusText(text)
    setVoiceState(ok ? 'success' : 'failure')
    // Voice continuity hardening: suppress non-critical TTS while SR is
    // actively listening. Synthesis pollutes the open mic and triggers
    // spurious partials that fragment the user's next utterance.
    // Critical failures (`ok === false`) still speak so the operator
    // hears errors regardless of recognizer state.
    const shouldSpeak = !armedRef.current || !ok
    if (shouldSpeak) {
      speak(text)
    } else {
      logInfo(
        'VOICE',
        `tts.suppressed-during-active-listening text="${text.slice(0, 40)}"`,
      )
    }
    if (uiResetTimerRef.current != null) {
      window.clearTimeout(uiResetTimerRef.current)
    }
    uiResetTimerRef.current = window.setTimeout(() => {
      uiResetTimerRef.current = null
      setVoiceState(armedRef.current ? 'listening' : 'sleeping')
    }, 650)
  }

  /**
   * Voice → command-id → central dispatcher → speech feedback.
   * The voice layer never mutates app/cockpit/map state directly.
   *
   * `rawTranscript` carries the original full transcript (including the
   * "HUD" wake word) so the structured `[VOICE]` log records the
   * user-facing phrase in `heard`, while `cmd` carries the post-wake-word
   * normalized form used for dispatch matching.
   */
  const dispatchAndReport = async (
    rawCmd: string,
    source: CommandSource,
    rawTranscript?: string,
  ) => {
    const cmd = normalize(rawCmd)
    if (!cmd) return
    setVoiceState('processing')
    setLastHeard(`HUD ${cmd}`)
    const res = await dispatch(cmd, source, rawTranscript ?? `HUD ${cmd}`)
    if (cmd === 'voice continuous') {
      // Already armed if we're hearing this command, but the alias is preserved
      // for parity with the legacy directory.
      report('Continuous listening enabled. Say HUD sleep to stop.')
      return
    }
    if (cmd === 'sleep' || cmd === 'voice sleep') {
      // HARD STOP: tearing down SR is gated on armed===false; the effect
      // cleanup runs rec.stop() and removes pagehide/visibility listeners.
      setArmed(false)
      report('Continuous listening disabled.')
      return
    }
    report(res.message, res.ok)
  }

  const parseAndRun = async (
    text: string,
    confidence = 1,
    transcriptSource: CommandSource = 'voice',
  ) => {
    const isVoice = transcriptSource === 'voice'
    voiceDevLog('[VOICE RAW]', text)
    const norm = normalizeTranscript(text)
    voiceDevLog('[VOICE NORMALIZED]', norm)
    voiceDevLog('[VOICE CONFIDENCE]', confidence)
    if (!norm) return

    // Utterance continuity window: a recent bare "HUD" finalization left
    // a one-shot 2500ms continuation window open. A short, simple
    // follow-up transcript ("weather", "center map") that would normally
    // fail the wake-word gate is treated as if it had been spoken with
    // "HUD " prefix. Sanity bounds (≤6 words, ≤60 chars) prevent the
    // window from being consumed by long unrelated speech. The window is
    // one-shot — consumption clears it.
    let consumedContinuation = false
    if (pendingWakeUntilRef.current != null) {
      if (performance.now() <= pendingWakeUntilRef.current) {
        const directlyHasWake =
          norm === WAKE_WORD || norm.startsWith(`${WAKE_WORD} `)
        if (!directlyHasWake) {
          const wordCount = norm.split(/\s+/).length
          const sane =
            norm.length <= SANITY_MAX_CONTINUATION_CHARS &&
            wordCount <= SANITY_MAX_CONTINUATION_WORDS
          if (sane) {
            consumedContinuation = true
            pendingWakeUntilRef.current = null
            logInfo('VOICE', `wake-window.consume phrase="${norm.slice(0, 60)}"`)
          }
        }
      } else {
        pendingWakeUntilRef.current = null
        logInfo('VOICE', 'wake-window.expire')
      }
    }

    const wakeSplit = stripWakeWordPrefix(norm)
    const effective = consumedContinuation
      ? `${WAKE_WORD} ${norm}`
      : wakeSplit.wakeDetected
        ? `${WAKE_WORD} ${wakeSplit.commandPart}`.trim()
        : norm

    // SYSTEM RULE: HUD is the ONLY valid activation token.
    // No aliases, no fuzzy matching, no fallback activation allowed.
    //
    // The transcript MUST start with the literal token "hud" (case-insensitive
    // via `normalize`). The check is exact-equality OR exact-prefix `"hud "`.
    // The continuation-window branch above synthesizes a leading "hud "
    // when (and only when) a bare wake-word was recently confirmed AND
    // the follow-up phrase passes sanity bounds — wake-word policy is
    // never bypassed for arbitrary utterances.
    if (effective !== WAKE_WORD && !effective.startsWith(`${WAKE_WORD} `)) {
      reportPolicyAttempt('voice.wakeWordRequired', 'disable', 'parseAndRun.missing-wake-word')
      voiceDevLog('[VOICE COMMAND]', '')
      voiceDevLog('[VOICE PARSE REJECT]', 'missing_wake_word')
      traceAction('wake_word_activation', 'guard_reject', { reason: 'missing_wake_word' })
      return
    }

    const wakeDebounceKey = normalize(effective)
    const wakeNow = Date.now()
    if (
      wakeDebounceKey.length > 0 &&
      wakeDebounceKey === lastWakeProcessRef.current.key &&
      wakeNow - lastWakeProcessRef.current.ts < WAKE_PROCESS_DEBOUNCE_MS
    ) {
      voiceDevLog('[VOICE WAKE]', { raw: text, processed: effective, ignoredDuplicate: true })
      return
    }
    lastWakeProcessRef.current = { key: wakeDebounceKey, ts: wakeNow }
    voiceDevLog('[VOICE WAKE]', { raw: text, processed: effective, ignoredDuplicate: false })

    // Direct wake-word utterance invalidates any prior bare-wake window
    // (the user re-asserted intent explicitly).
    if (!consumedContinuation) {
      pendingWakeUntilRef.current = null
    }

    // DEPE: wake-word gate is REQUIRED in every mode. We report 'enable' when
    // the gate is honored (we just passed it). A future code path that bypassed
    // this check would never call this report, and the engine's required-vs-
    // active periodic validator would catch the silent absence.
    reportPolicyAttempt(
      'voice.wakeWordRequired',
      'enable',
      consumedContinuation
        ? 'parseAndRun.continuation-window'
        : 'parseAndRun.gate-passed',
    )
    logInfo('VOICE', `wake-word.detected phrase="${effective.slice(0, 80)}"`)
    traceAction('wake_word_activation', 'state_result', { detected: true, viaContinuation: consumedContinuation })
    flashWakeHudAck()
    const now = Date.now()
    if (now - lastWakeAckAtRef.current > WAKE_ACK_COOLDOWN_MS) {
      pulseWake()
      lastWakeAckAtRef.current = now
    } else {
      logInfo('VOICE', 'wake-ack-suppressed cooldown')
    }
    setVoiceState('listening')
    updateVoiceState('processing')
    const commandsPart =
      effective === WAKE_WORD ? '' : effective.slice(WAKE_WORD.length + 1).trim()
    const parts = commandsPart.split(/\bthen\b/).map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) {
      // Bare wake-word: visual-only acknowledgement. NO TTS — synthesis
      // would contaminate the open mic and break the user's natural
      // follow-up cadence. Visual + chime (via pulseWake) and runtime
      // pulse already confirmed the wake on this turn. We open the
      // utterance continuity window so that "HUD" + short pause +
      // "weather" is interpreted as one intent.
      setStatusText('🎤 HUD ready')
      setVoiceState('success')
      pendingWakeUntilRef.current = performance.now() + WAKE_CONTINUATION_MS
      logInfo('VOICE', `wake-window.open ms=${WAKE_CONTINUATION_MS}`)
      logInfo('VOICE', 'wake-word.only-detected')
      if (uiResetTimerRef.current != null) {
        window.clearTimeout(uiResetTimerRef.current)
      }
      uiResetTimerRef.current = window.setTimeout(() => {
        uiResetTimerRef.current = null
        setVoiceState(armedRef.current ? 'listening' : 'sleeping')
      }, 650)
      updateVoiceState('listening')
      return
    }
    for (const p of parts) {
      const part = stripLeadingHudTokens(p)
      if (!part) continue

      if (isVoice && sosVoicePendingRef.current) {
        if (isAffirmativeVoiceFollowUp(part)) {
          sosVoicePendingRef.current = false
          voiceClarifyCmdRef.current = null
          const cmd = 'sos confirm'
          setCommandEcho(cmd)
          await new Promise<void>((r) => {
            window.setTimeout(r, VOICE_COMMAND_PREVIEW_MS)
          })
          setCommandEcho(null)
          await dispatchAndReport(cmd, 'voice', `${WAKE_WORD} ${part}`)
          continue
        }
        if (isNegativeVoiceFollowUp(part)) {
          sosVoicePendingRef.current = false
          reportSubtle('SOS arm cancelled.')
          continue
        }
      }

      if (isVoice && voiceClarifyCmdRef.current) {
        if (isAffirmativeVoiceFollowUp(part)) {
          const cmd = voiceClarifyCmdRef.current
          voiceClarifyCmdRef.current = null
          setCommandEcho(cmd)
          await new Promise<void>((r) => {
            window.setTimeout(r, VOICE_COMMAND_PREVIEW_MS)
          })
          setCommandEcho(null)
          await dispatchAndReport(cmd, 'voice', `${WAKE_WORD} ${part}`)
          continue
        }
        if (isNegativeVoiceFollowUp(part)) {
          voiceClarifyCmdRef.current = null
          reportSubtle('Cancelled.')
          continue
        }
      }

      const intent = isVoice
        ? resolveVoiceOperationalIntent(part, commands, confidence)
        : resolveIntentFromPhrase(part, commands)
      voiceDevLog('[VOICE COMMAND]', intent.command ?? '')
      voiceDevLog('[VOICE INTENT]', intent)

      if (isVoice && sosVoicePendingRef.current && intent.command && intent.command !== 'sos') {
        sosVoicePendingRef.current = false
      }
      if (isVoice && voiceClarifyCmdRef.current && intent.command && intent.command !== voiceClarifyCmdRef.current) {
        voiceClarifyCmdRef.current = null
      }

      if (isVoice && intent.command === 'sos confirm' && !sosVoicePendingRef.current) {
        reportSubtle('Say HUD SOS first, then confirm.')
        continue
      }

      if (isVoice && intent.command === 'sos') {
        sosVoicePendingRef.current = true
        voiceClarifyCmdRef.current = null
        reportSubtle('Arm emergency SOS? Say CONFIRM or YES.')
        continue
      }

      if (!intent.command) {
        if (isVoice) {
          if (intent.reason === 'fuzzy' && intent.suggestion) {
            sosVoicePendingRef.current = false
            voiceClarifyCmdRef.current = intent.suggestion
            reportSubtle(`Did you mean "${intent.suggestion}"? Say yes or no.`)
          } else {
            sosVoicePendingRef.current = false
            voiceClarifyCmdRef.current = null
            reportSubtle('Command not recognized.')
          }
        } else {
          const reason =
            intent.reason === 'fuzzy' && intent.suggestion
              ? `Did you mean ${intent.suggestion}?`
              : 'Unknown command. Try weather, bright mode, center gps, or night mode.'
          voiceDevLog('[VOICE PARSE REJECT]', reason)
          report(reason, false)
        }
        continue
      }

      const dedupeNow = Date.now()
      if (
        lastDispatchedCommandRef.current.cmd === intent.command &&
        dedupeNow - lastDispatchedCommandRef.current.ts < DUPLICATE_COMMAND_SUPPRESS_MS
      ) {
        voiceDevLog('[VOICE DUPLICATE SUPPRESSED]', intent.command)
        continue
      }
      lastDispatchedCommandRef.current = { cmd: intent.command, ts: dedupeNow }

      if (isVoice) {
        setCommandEcho(intent.command)
        await new Promise<void>((r) => {
          window.setTimeout(r, VOICE_COMMAND_PREVIEW_MS)
        })
        setCommandEcho(null)
      }

      await dispatchAndReport(intent.command, transcriptSource, `${WAKE_WORD} ${part}`)
    }
    if (armedRef.current) updateVoiceState('listening')
  }
  parseAndRunRef.current = parseAndRun

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const samples = [
      ['HUD drop waypoint', 'drop waypoint'],
      ['HUD check in', 'check in'],
      ['HUD show weather', 'weather'],
      ['HUD flashlight on', 'flashlight on'],
      ['HUD start beacon', 'start beacon'],
      ['HUD clear trail', 'clear trail'],
    ] as const
    const rows = samples.map(([s, expected]) => {
      const stripped = stripWakeWordPrefix(s)
      const intent = resolveVoiceOperationalIntent(stripped.commandPart, commands, 1)
      return {
        sample: s,
        wakeDetected: stripped.wakeDetected,
        intent: intent.command ?? 'none',
        confidence: Number(intent.confidence.toFixed(3)),
        matchedAction: intent.command ?? intent.suggestion ?? 'none',
        pass: intent.command === expected,
      }
    })
    console.table(rows)
  }, [commands])

  useEffect(() => {
    if (!armed || !supportsRec) return
    if (recognitionRef.current) {
      // Single SR ownership invariant: a previous recognizer is still attached.
      // We refuse to construct a second instance — the existing one keeps
      // ownership of the SR lifecycle. DEPE surfaces this as a violation
      // because two start() owners would create overlapping restart loops.
      reportPolicyAttempt('voice.backgroundListenerWhenDisarmed', 'enable', 'duplicate-recognition-instance')
      logWarn('VOICE', 'duplicate-ownership-prevented existing recognizer retained')
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = 'en-US'
    rec.continuous = true
    // Android Chrome reliability win: interim results allow SR to surface
    // partial transcripts in ~200-500ms instead of the ~1500ms end-of-
    // utterance pause. Dispatch is still strictly gated on `isFinal`
    // below so partial commands cannot misfire.
    rec.interimResults = true

    let startedOnce = false
    const MAX_RESTART_ATTEMPTS = 6
    // Faster first-restart: Android Chrome auto-ends SR after ~5s of silence
    // even when continuous=true. Treat this as benign rotation, not error,
    // so the recovery gap is barely noticeable.
    const BASE_BACKOFF_MS = 250
    const MAX_BACKOFF_MS = 8000
    let watchdog: number | null = null

    /** Detach all handlers from a recognizer instance so any deferred
     *  events the browser has queued cannot mutate component state after
     *  we've handed ownership back. Used by both lifecycle suspension and
     *  cleanup paths. */
    const detachHandlers = (target: any) => {
      try {
        target.onstart = null
        target.onresult = null
        target.onerror = null
        target.onend = null
      } catch {
        // ignore
      }
    }

    const armWatchdog = () => {
      if (watchdog != null) window.clearTimeout(watchdog)
      // If `onstart` does not fire within 1500 ms after rec.start(), declare dead.
      watchdog = window.setTimeout(() => {
        if (!startedOnce && armedRef.current) {
          updateVoiceState('dead', { lastError: 'recognizer onstart timeout' })
          // DEPE: silent dead-state is forbidden — surface as a violation so
          // it shows up in the overlay and console.
          reportPolicyAttempt('voice.silentDeadState', 'enable', 'watchdog-timeout-1500ms')
          logWarn('VOICE', 'watchdog dead-state timeout=1500ms onstart never fired')
          setVoiceState('failure')
          setStatusText('🎤 Voice unresponsive — tap to retry')
          setArmed(false)
        }
      }, 1500)
    }

    rec.onstart = () => {
      startedOnce = true
      restartAttemptsRef.current = 0
      updateVoiceMeta({ restartAttempts: 0, lastSrStartAt: Date.now(), lastInterruptionReason: null })
      recoveryAttemptedRef.current = false
      if (watchdog != null) {
        window.clearTimeout(watchdog)
        watchdog = null
      }
      setVoiceState('listening')
      setStatusText('🎤 HUD listening')
      updateVoiceState('listening')
      logInfo('VOICE', 'sr.onstart listening')
      if (suspendedByLifecycleRef.current) {
        updateVoiceRecoveryState('resumed')
        suspendedByLifecycleRef.current = false
      } else {
        updateVoiceRecoveryState('idle')
      }
    }
    rec.onresult = (e: any) => {
      // Partition the new chunk into final vs interim text so we can:
      //   1. dispatch only on final (no partial-command misfires)
      //   2. reset restart-attempt counter on any progress (interim
      //      counts as proof the recognizer is alive — we should not
      //      escalate backoff after a real chunk arrived)
      let finalText = ''
      let interimText = ''
      let finalConfidence: number | null = null
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const txt = result?.[0]?.transcript ?? ''
        if (result?.isFinal) {
          finalText += ` ${txt}`
          const conf = typeof result?.[0]?.confidence === 'number' ? Number(result[0].confidence) : null
          if (conf != null && Number.isFinite(conf)) {
            finalConfidence = finalConfidence == null ? conf : Math.max(finalConfidence, conf)
          }
        }
        else interimText += ` ${txt}`
      }
      finalText = finalText.trim()
      interimText = interimText.trim()
      const anyProgress = finalText.length > 0 || interimText.length > 0
      if (anyProgress) {
        lastRecognitionAtRef.current = Date.now()
        // Treat progress as health: clear the restart-attempt counter so a
        // subsequent natural onend (silence rotation) starts fresh on the
        // backoff curve instead of escalating.
        if (restartAttemptsRef.current !== 0) {
          restartAttemptsRef.current = 0
        }
        updateVoiceMeta({
          lastTranscript: (finalText || interimText).slice(0, 200),
          lastRecognitionAt: lastRecognitionAtRef.current,
          restartAttempts: 0,
        })
      }
      if (finalText.length >= SANITY_MIN_FINAL_LEN) {
        const finalNorm = normalizeTranscript(finalText)
        const now = Date.now()
        const duplicate =
          finalNorm.length > 0 &&
          finalNorm === lastFinalTranscriptRef.current.norm &&
          now - lastFinalTranscriptRef.current.ts < DUPLICATE_TRANSCRIPT_SUPPRESS_MS
        if (duplicate) {
          voiceDevLog('[VOICE DUPLICATE SUPPRESSED]', {
            transcript: finalNorm,
            windowMs: DUPLICATE_TRANSCRIPT_SUPPRESS_MS,
          })
          return
        }
        lastFinalTranscriptRef.current = { norm: finalNorm, ts: now }
        // Final-transcript sanity filter is enforced inside the result
        // handler so SR-emitted single-char / whitespace finalizations
        // (common Android Chrome partial-flush garbage) cannot consume
        // the continuation window or trigger the parser.
        void parseAndRunRef.current(finalText, finalConfidence ?? 1, 'voice')
      }
    }
    // Safety: any recognition error (incl. permission denial mid-session)
    // immediately disarms and stops listening — no auto-restart loop.
    rec.onerror = (e: any) => {
      const code = String(e?.error ?? 'unknown')
      const denied = code === 'not-allowed' || code === 'service-not-allowed'
      setVoiceState('failure')
      setStatusText(denied ? '🎤 Microphone permission denied' : '🎤 Voice recognition error')
      updateVoiceMeta({ lastInterruptionReason: `error:${code}` })
      setArmed(false)
      updateVoiceState(denied ? 'blocked' : 'degraded', { lastError: code })
      if (denied) updatePermission('microphone', 'denied')
      updateVoiceRecoveryState('failed')
      logWarn('VOICE', `sr.onerror code=${code}${denied ? ' permission-denied' : ''}`)
    }
    rec.onend = () => {
      if (!armedRef.current) {
        updateVoiceState('inactive_clean')
        updateVoiceRecoveryState('idle')
        logInfo('VOICE', 'sr.onend disarmed-clean')
        return
      }
      if (
        shouldTreatOnEndAsLifecycleSuspend({
          armed: armedRef.current,
          visibilityState: document.visibilityState,
        })
      ) {
        suspendedByLifecycleRef.current = true
        updateVoiceRecoveryState('suspended')
        updateVoiceState('inactive_clean', { lastError: 'interrupted: hidden-onend' })
        logInfo('VOICE', 'sr.onend hidden-suspend')
        return
      }
      // Bounded recovery strategy: exponential backoff, capped attempts.
      restartAttemptsRef.current += 1
      if (import.meta.env.DEV) {
        const now = Date.now()
        const storm = restartStormRef.current
        if (storm.windowStart === 0 || now - storm.windowStart > 30_000) {
          storm.windowStart = now
          storm.count = 1
        } else {
          storm.count += 1
          if (storm.count >= 5 && now - storm.lastLogAt > 15_000) {
            storm.lastLogAt = now
            logWarn('VOICE', `restart-storm suspected attemptsIn30s=${storm.count}`)
          }
        }
      }
      updateVoiceMeta({ restartAttempts: restartAttemptsRef.current, lastInterruptionReason: 'onend' })
      updateVoiceRecoveryState('recovering')
      updateVoiceState('recovering')

      if (restartAttemptsRef.current > MAX_RESTART_ATTEMPTS) {
        updateVoiceState('degraded', { lastError: 'recovery attempts exceeded' })
        setVoiceState('failure')
        setStatusText('🎤 Voice degraded — tap to re-arm')
        setArmed(false)
        updateVoiceRecoveryState('failed')
        logWarn('VOICE', `sr.onend recovery-exhausted attempts=${restartAttemptsRef.current}`)
        return
      }

      const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, restartAttemptsRef.current - 1))
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      logInfo('VOICE', `sr.onend restart attempt=${restartAttemptsRef.current} backoff=${backoff}ms`)
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null
        if (!armedRef.current) return
        try {
          startedOnce = false
          rec.start()
          armWatchdog()
          logInfo('VOICE', `sr.start restart attempt=${restartAttemptsRef.current}`)
        } catch (err) {
          updateVoiceMeta({
            lastInterruptionReason: `restart-throw:${(err as Error)?.message ?? 'unknown'}`,
          })
          updateVoiceState('degraded', { lastError: 'restart threw' })
          setVoiceState('failure')
          setStatusText('🎤 Voice degraded — tap to re-arm')
          setArmed(false)
          updateVoiceRecoveryState('failed')
          logWarn('VOICE', `sr.start restart-threw error=${(err as Error)?.message ?? 'unknown'}`)
        }
      }, backoff)
    }

    try {
      updateVoiceState('recovering', { lastSrStartAt: Date.now() })
      rec.start()
      armWatchdog()
      logInfo('VOICE', 'sr.start initial-arm')
    } catch (err) {
      updateVoiceState('degraded', {
        lastError: `start threw: ${(err as Error)?.message ?? 'unknown'}`,
      })
      setVoiceState('failure')
      setStatusText('🎤 Voice unresponsive — tap to retry')
      setArmed(false)
      updateVoiceRecoveryState('failed')
      logWarn('VOICE', `sr.start initial-threw error=${(err as Error)?.message ?? 'unknown'}`)
      return
    }

    // Field continuity: lifecycle interruption does not cancel user intent.
    // Detach handlers BEFORE relinquishing the ref so any deferred event
    // queued by the platform during teardown cannot fire on a stale rec.
    const onPageHide = () => {
      suspendedByLifecycleRef.current = true
      updateVoiceRecoveryState('suspended')
      updateVoiceState('inactive_clean', { lastError: 'interrupted: pagehide' })
      detachHandlers(rec)
      try {
        rec.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
      logInfo('VOICE', 'sr.suspend pagehide')
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        suspendedByLifecycleRef.current = true
        updateVoiceRecoveryState('suspended')
        updateVoiceState('inactive_clean', { lastError: 'interrupted: hidden' })
        detachHandlers(rec)
        try {
          rec.abort()
        } catch {
          // ignore
        }
        recognitionRef.current = null
        logInfo('VOICE', 'sr.suspend visibility-hidden')
        return
      }
      // One-shot recovery on resume while preserving armed intent.
      if (
        shouldAttemptVoiceRecovery({
          armed: armedRef.current,
          suspendedByLifecycle: suspendedByLifecycleRef.current,
          recoveryAttempted: recoveryAttemptedRef.current,
        })
      ) {
        recoveryAttemptedRef.current = true
        updateVoiceRecoveryState('recovering')
        setRecoveryNonce((n) => n + 1)
        logInfo('VOICE', 'sr.recover visibility-resumed')
      } else if (import.meta.env.DEV) {
        logInfo('VOICE', 'sr.recover visibility-skipped')
      }
    }
    const onPageShow = () => {
      // iOS/WebKit BFCache can skip normal visibility transition ordering.
      // Preserve armed intent, but avoid duplicate recovery triggers.
      if (
        shouldAttemptVoiceRecovery({
          armed: armedRef.current,
          suspendedByLifecycle: suspendedByLifecycleRef.current,
          recoveryAttempted: recoveryAttemptedRef.current,
        })
      ) {
        recoveryAttemptedRef.current = true
        updateVoiceRecoveryState('recovering')
        setRecoveryNonce((n) => n + 1)
        logInfo('VOICE', 'sr.recover pageshow-resumed')
      } else if (import.meta.env.DEV) {
        logInfo('VOICE', 'sr.recover pageshow-skipped')
      }
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibility)
      if (watchdog != null) {
        window.clearTimeout(watchdog)
        watchdog = null
      }
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      if (uiResetTimerRef.current != null) {
        window.clearTimeout(uiResetTimerRef.current)
        uiResetTimerRef.current = null
      }
      // SR teardown clears the continuity window — page transitions,
      // recovery cycles, and effect re-runs must never resume into a
      // stale bare-wake state.
      pendingWakeUntilRef.current = null
      detachHandlers(rec)
      try {
        rec.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
      logInfo('VOICE', 'sr.cleanup effect-teardown')
      // Reflect the user's intent: arm=false → clean inactive; otherwise we
      // were torn down externally and do not change state here.
      if (!armedRef.current) updateVoiceState('inactive_clean')
    }
  }, [armed, supportsRec, recoveryNonce])

  useEffect(() => {
    return () => {
      if (wakeHudTimerRef.current != null) {
        window.clearTimeout(wakeHudTimerRef.current)
        wakeHudTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (armed) return
    const rec = recognitionRef.current
    if (!rec) return
    // Critical DEPE correction: disarmed state must never leave SR running.
    enforcePolicyAttempt(
      'voice.backgroundListenerWhenDisarmed',
      'enable',
      'VoicePanel.disarmed-sr-detected',
      () => {
        try {
          rec.onstart = null
          rec.onresult = null
          rec.onerror = null
          rec.onend = null
          rec.stop?.()
        } catch {
          // ignore
        } finally {
          recognitionRef.current = null
        }
        logWarn('VOICE', 'disarmed-sr-corrected leftover-recognizer-torn-down')
      },
    )
  }, [armed])

  // Single SR lifecycle toggle. Used by both the primary mic button and the
  // CONTINUOUS ON/OFF button so they cannot disagree.
  // Pre-condition for ON: mic permission must be granted.
  // Post-condition for OFF: SR effect cleanup runs (rec.stop + listener
  // removal) — no background listener remains.
  const toggleVoiceLifecycle = async () => {
    traceAction('voice_continuous_toggle', 'handler_enter', { armed })
    if (!armed) {
      updateVoiceState('arming')
      traceAction('voice_continuous_toggle', 'async_start', { step: 'request_microphone_permission' })
      const mic = await requestMicrophonePermission()
      const permState =
        mic === 'granted'
          ? 'granted'
          : mic === 'denied'
            ? 'denied'
            : mic === 'unsupported'
              ? 'unsupported'
              : 'prompt'
      updatePermission('microphone', permState)
      updateVoiceMeta({ permission: permState })
      if (mic !== 'granted') {
        setVoiceState('failure')
        setStatusText('🎤 Microphone permission needed')
        updateVoiceState(mic === 'unsupported' ? 'unavailable' : 'blocked', {
          lastError: `mic permission: ${mic}`,
        })
        traceAction('voice_continuous_toggle', 'guard_reject', {
          reason: 'mic_not_granted',
          permission: mic,
        })
        return
      }
    } else {
      updateVoiceState('inactive_clean')
    }
    traceAction('voice_continuous_toggle', 'state_result', { nextArmed: !armed })
    setArmed((v) => !v)
    setVoiceState((s) => (s === 'sleeping' ? 'listening' : 'sleeping'))
    setStatusText((t) => (t.includes('listening') ? '🎤 HUD (tap to start)' : '🎤 HUD listening'))
  }

  const getCommandAvailability = (cmd: string): string => {
    if (cmd.startsWith('flashlight')) {
      if (flashlightCapability.permission === 'denied') return 'permission required'
      if (flashlightCapability.supportState === 'unsupported') return 'unsupported'
      if (flashlightCapability.supportState === 'supported') return 'available'
      return 'inactive'
    }
    const registered = commands.some((c) => c.id === cmd || (c.aliases ?? []).includes(cmd))
    return registered ? 'available' : 'partially wired'
  }

  return (
    <HudPanel
      panelId="voice"
      title="Voice Directory"
      initialPos={{ x: 1240, y: 280 }}
      initialWidth={330}
      minHeight={130}
      accent={voiceState === 'failure' ? '#ff3b4d' : undefined}
    >
      <div style={{ position: 'relative', display: 'grid', gap: touchGapMd }}>
        {(wakeHudAck || commandEcho) && (
          <div
            aria-live="polite"
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              left: 4,
              right: 4,
              top: 0,
              zIndex: 6,
              display: 'grid',
              gap: 6,
            }}
          >
            {wakeHudAck && (
              <div
                style={{
                  alignSelf: 'start',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: labelPx(10),
                  letterSpacing: '0.06em',
                  background: 'rgba(125,255,138,0.22)',
                  border: '1px solid rgba(125,255,138,0.55)',
                  color: '#c8ffd0',
                }}
              >
                Wake recognized · HUD
              </div>
            )}
            {commandEcho && (
              <div
                style={{
                  alignSelf: 'start',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: labelPx(10),
                  letterSpacing: '0.06em',
                  background: 'rgba(90,180,255,0.2)',
                  border: '1px solid rgba(120,200,255,0.45)',
                  color: '#d0e8ff',
                }}
              >
                Heard: {commandEcho}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          data-no-drag
          onClick={toggleVoiceLifecycle}
          style={{
            minHeight: btnMin(40),
            borderRadius: 8,
            border: '1px solid rgba(125,255,138,0.5)',
            background: armed ? 'rgba(125,255,138,0.18)' : 'rgba(10,12,13,0.8)',
            color: armed ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
            boxShadow: armed ? '0 0 10px rgba(125,255,138,0.35)' : 'none',
            cursor: 'pointer',
            fontSize: labelPx(11),
            letterSpacing: '0.1em',
          }}
        >
          {expanded ? '🎤 HUD (tap to start)' : statusText}
        </button>

        <div style={{ display: 'flex', gap: touchGapMd }}>
          <button
            type="button"
            data-no-drag
            onClick={() => setExpanded((v) => !v)}
            style={{
              flex: 1,
              minHeight: btnMin(34),
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.28)',
              background: 'rgba(10,12,13,0.8)',
              color: 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: labelPx(10),
              letterSpacing: '0.08em',
            }}
          >
            {expanded ? 'HIDE COMMANDS' : 'SHOW COMMAND LIST'}
          </button>
          <button
            type="button"
            data-no-drag
            onClick={toggleVoiceLifecycle}
            aria-label={armed ? 'Voice lifecycle on, tap to turn off' : 'Voice lifecycle off, tap to turn on'}
            style={{
              minHeight: btnMin(34),
              borderRadius: 8,
              border: armed
                ? '1px solid rgba(125,255,138,0.6)'
                : '1px solid rgba(199,206,198,0.28)',
              background: armed ? 'rgba(125,255,138,0.16)' : 'rgba(10,12,13,0.8)',
              color: armed ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: labelPx(10),
              letterSpacing: '0.08em',
            }}
          >
            {armed ? 'CONTINUOUS ON' : 'CONTINUOUS OFF'}
          </button>
        </div>

        {!supportsRec && (
          <div style={{ display: 'grid', gap: touchGapSm }}>
            <div style={{ fontSize: labelPx(10), color: 'var(--cockpit-panel-subtle)' }}>No speech recognition. Type command:</div>
            <div style={{ display: 'flex', gap: touchGapMd }}>
              <input
                data-no-drag
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="HUD status"
                style={{
                  flex: 1,
                  minHeight: btnMin(34),
                  borderRadius: 8,
                  border: '1px solid rgba(199,206,198,0.24)',
                  background: 'rgba(10,12,13,0.8)',
                  color: '#d3dad3',
                  padding: '0 10px',
                }}
              />
              <button
                type="button"
                data-no-drag
                onClick={() => void parseAndRun(typed, 1, 'ui')}
                style={{
                  minHeight: btnMin(34),
                  borderRadius: 8,
                  border: '1px solid rgba(199,206,198,0.3)',
                  background: 'rgba(199,206,198,0.14)',
                  color: '#d3dad3',
                  cursor: 'pointer',
                }}
              >
                Send
              </button>
            </div>
          </div>
        )}

        {expanded && (
          <div style={{ fontSize: labelPx(10), color: 'var(--cockpit-panel-subtle)', lineHeight: 1.5, display: 'grid', gap: touchGapMd }}>
            <div>
              Wake word: <strong>HUD</strong>. Voice runs field actions only (waypoint, check-in, weather, flashlight,
              beacon, trail, SOS+confirm). Example: <code>HUD drop waypoint</code>. Last: {lastHeard || '—'}
            </div>
            <div style={{ fontSize: labelPx(10), letterSpacing: '0.08em', color: 'var(--cockpit-panel-subtle)' }}>
              ONE-TAP COMMANDS (MOBILE READY)
            </div>
            <div
              data-no-drag
              style={{
                maxHeight: 180,
                overflowY: 'auto',
                border: '1px solid rgba(199,206,198,0.2)',
                borderRadius: 8,
                background: 'rgba(10,12,13,0.65)',
                padding: touchGapSm,
                display: 'grid',
                gap: touchGapSm,
              }}
            >
              {QUICK_COMMAND_GROUPS.map((group) => (
                <div key={group.group} style={{ display: 'grid', gap: touchGapSm }}>
                  <div
                    style={{
                      fontSize: labelPx(9),
                      letterSpacing: '0.1em',
                      color: group.priority ? '#ffb8c6' : 'var(--cockpit-panel-subtle)',
                      fontWeight: 700,
                    }}
                  >
                    {group.group}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={`${group.group}-${item.cmd}`}
                      type="button"
                      data-no-drag
                      onClick={() => void dispatchAndReport(item.cmd, 'ui')}
                      style={{
                        width: '100%',
                        minHeight: btnMin(34),
                        textAlign: 'left',
                        borderRadius: 6,
                        border: group.priority ? '1px solid rgba(255,127,151,0.35)' : '1px solid rgba(199,206,198,0.26)',
                        background: group.priority ? 'rgba(255,75,112,0.18)' : 'rgba(199,206,198,0.12)',
                        color: '#d3dad3',
                        padding: '0 10px',
                        cursor: 'pointer',
                        fontSize: labelPx(11),
                        letterSpacing: '0.04em',
                      }}
                    >
                      {item.label} - {getCommandAvailability(item.cmd)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div>
              <strong>Command palette</strong> (keyboard) still exposes navigation, pins, panels, and display modes.
            </div>
            <div>
              <strong>TIER 2 (stub)</strong>: fire, water, deadman.
            </div>
            <div>
              <strong>TIER 3 (stub)</strong>: ai route, biometric, forage, lidar, ar, voice continuous.
            </div>
          </div>
        )}
      </div>
    </HudPanel>
  )
}
