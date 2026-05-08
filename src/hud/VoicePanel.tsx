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
// Final-transcript sanity bounds. Reject empty/whitespace/single-char
// finals (common Android Chrome partial-flush garbage) and refuse to
// consume the continuation window with long, multi-clause speech that
// almost certainly is not a HUD command.
const SANITY_MIN_FINAL_LEN = 2
const SANITY_MAX_CONTINUATION_WORDS = 6
const SANITY_MAX_CONTINUATION_CHARS = 60

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
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

const QUICK_COMMAND_GROUPS: Array<{
  group: string
  priority?: boolean
  items: Array<{ label: string; cmd: string }>
}> = [
  {
    group: 'SOS FAST ACCESS',
    priority: true,
    items: [
      { label: 'Morse Toggle', cmd: 'morse toggle' },
      { label: 'Torch Toggle', cmd: 'torch toggle' },
      { label: 'Torch On', cmd: 'torch on' },
      { label: 'Torch Off', cmd: 'torch off' },
    ],
  },
  {
    group: 'Navigation',
    items: [
      { label: 'Center GPS', cmd: 'center' },
      { label: 'Zoom In', cmd: 'zoom in' },
      { label: 'Zoom Out', cmd: 'zoom out' },
      { label: 'Status', cmd: 'status' },
    ],
  },
  {
    group: 'Route',
    items: [
      { label: 'Add Pin', cmd: 'add pin' },
      { label: 'Route Stats', cmd: 'route stats' },
      { label: 'Reset Layout', cmd: 'reset' },
    ],
  },
  {
    group: 'Display & Weather',
    items: [
      { label: 'Weather', cmd: 'weather' },
      { label: 'Night Mode', cmd: 'night' },
      { label: 'Low Light', cmd: 'low light' },
      { label: 'Bright', cmd: 'bright' },
    ],
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
  /** Utterance continuity window expiry (`performance.now()` epoch). null
   *  when no bare-wake-word ack is pending. Single-shot: cleared on
   *  consume, timeout, disarm, or SR teardown. */
  const pendingWakeUntilRef = useRef<number | null>(null)
  armedRef.current = armed
  const parseAndRunRef = useRef<(text: string) => Promise<void>>(async () => {})
  const supportsRec =
    typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

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

  const parseAndRun = async (text: string) => {
    const norm = normalize(text)
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

    const effective = consumedContinuation ? `${WAKE_WORD} ${norm}` : norm

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
      traceAction('wake_word_activation', 'guard_reject', { reason: 'missing_wake_word' })
      return
    }

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
    pulseWake()
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
      // Compose a stable `heard` value per part: "HUD <part>" — preserves
      // the wake word in the structured log even when multiple commands
      // are chained via "then".
      await dispatchAndReport(p, 'voice', `${WAKE_WORD} ${p}`)
    }
    if (armedRef.current) updateVoiceState('listening')
  }
  parseAndRunRef.current = parseAndRun

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
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const txt = result?.[0]?.transcript ?? ''
        if (result?.isFinal) finalText += ` ${txt}`
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
        // Final-transcript sanity filter is enforced inside the result
        // handler so SR-emitted single-char / whitespace finalizations
        // (common Android Chrome partial-flush garbage) cannot consume
        // the continuation window or trigger the parser.
        void parseAndRunRef.current(finalText)
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
        rec.stop()
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
          rec.stop()
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
        rec.stop()
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

  return (
    <HudPanel
      panelId="voice"
      title="Voice Directory"
      initialPos={{ x: 1240, y: 280 }}
      initialWidth={330}
      minHeight={130}
      accent={voiceState === 'failure' ? '#ff3b4d' : undefined}
    >
      <div style={{ display: 'grid', gap: touchGapMd }}>
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
                onClick={() => parseAndRun(typed)}
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
              Wake word: <strong>HUD</strong>. Example: <code>HUD status</code>. Last: {lastHeard || '—'}
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
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div>
              <strong>TIER 1</strong> Navigation: center, zoom in/out, north/south/east/west.
            </div>
            <div>
              <strong>TIER 1</strong> GPS pin: attach, detach, recenter, distance.
            </div>
            <div>
              <strong>TIER 1</strong> Compass: bearing, direction, calibrate.
            </div>
            <div>
              <strong>TIER 1</strong> Route: add pin, delete last, clear route, save route, reverse route, route stats.
            </div>
            <div>
              <strong>TIER 1</strong> Status: status, time, battery, signal, elevation.
            </div>
            <div>
              <strong>TIER 1</strong> SOS: sos, emergency, rescue, morse yes/no/toggle, torch on/off/toggle.
            </div>
            <div>
              <strong>TIER 1</strong> Corridor: corridor, corridor status.
            </div>
            <div>
              <strong>TIER 1</strong> Display: night, low light, bright, reset.
            </div>
            <div>
              <strong>TIER 2</strong>: weather (live when configured).
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
