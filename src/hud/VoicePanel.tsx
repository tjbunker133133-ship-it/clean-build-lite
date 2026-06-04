import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import HudPanel from './HudPanel'
import { requestMicrophonePermission } from '../lib/devicePermissions'
import { useHudCommands, type CommandSource } from '../hooks/useHudCommands'
import { useMissionSync } from '../context/MissionSyncContext'
import { listLinkedFieldCallsigns } from '../lib/missionSync/teamComms'
import { tryHandleMissionCommsVoice } from '../lib/missionSync/missionCommsVoiceBridge'
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
  touchFontMd as touchFontMdFn,
  touchGapMd as touchGapMdFn,
  touchGapSm as touchGapSmFn,
  touchMinTarget as touchMinTargetFn,
} from './tokens'
import {
  formatVoicePhraseForDisplay,
  hasWakeWordPrefix,
  normalizeForWakeGate,
  normalizeVoiceTranscript,
  sliceFromFirstWakeToken,
  stripRepeatedWakePrefix,
  stripWakeAckEchoFromContinuation,
} from '../lib/voice/normalizeVoiceTranscript'
import {
  getVoiceListenProfile,
  type VoiceListenMode,
} from '../lib/voice/voiceListenProfile'
import { useLongPressVoiceArm, useVolumeUpVoiceArm } from '../hooks/useVolumeUpVoiceArm'
import {
  armRecognitionIgnoreUntil,
  isRecognitionOutputHeld,
  setRecognitionOutputHold,
  shouldBlockSpeechRecognition,
  speechRecognitionBlockRemainingMs,
  speakHudPhrase,
  stopVoiceOutputOnly,
} from '../runtime/voiceAudioArbitration'
import { setVoicePanelCommandHandlers } from '../runtime/voicePanelCommandBridge'

type VoiceState = 'sleeping' | 'listening' | 'processing' | 'success' | 'failure'

// SYSTEM RULE: HUD is the ONLY valid activation token.
// No aliases, no fuzzy matching, no fallback activation allowed.
// This constant is the single source of truth for the wake word and is the
// only string that can authorize voice command execution.
const WAKE_WORD = 'hud' as const

// Cross-platform utterance continuity window: after a bare "HUD"
// finalization the runtime keeps a one-shot 5s window during which a
// short, simple follow-up transcript ("weather", "center map") is
// treated as if it had "HUD " prefixed. This is NOT conversational mode
// — the window is one-shot, deterministic, auto-clears on consume /
// timeout / disarm / SR teardown, and does NOT bypass DEPE wake-word
// policy (the gate is reported 'enable' both for direct wake-word
// utterances and for continuation consumption).
const WAKE_CONTINUATION_MS = 7000
const WAKE_ACK_SPOKEN = 'Yes.'
// Final-transcript sanity bounds. Reject empty/whitespace/single-char
// finals (common Android Chrome partial-flush garbage) and refuse to
// consume the continuation window with long, multi-clause speech that
// almost certainly is not a HUD command.
const SANITY_MIN_FINAL_LEN = 2
const SANITY_MAX_CONTINUATION_WORDS = 6
const SANITY_MAX_CONTINUATION_CHARS = 60

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

/** Former voice stubs — now wired to live handlers in useHudCommands. */
const VOICE_STUB_COMMAND_IDS = new Set<string>()

const BASE_QUICK_COMMAND_GROUPS: Array<{
  group: string
  priority?: boolean
  items: Array<{ label: string; cmd: string }>
}> = [
  {
    group: 'Safety',
    priority: true,
    items: [
      { label: 'Deadman Status', cmd: 'deadman' },
      { label: 'Open Deadman', cmd: 'deadman panel' },
    ],
  },
  {
    group: 'Environmental',
    items: [
      { label: 'Fire Brief', cmd: 'fire' },
      { label: 'Water Brief', cmd: 'water' },
      { label: 'Foraging Tip', cmd: 'forage' },
    ],
  },
  {
    group: 'Comms',
    items: [
      { label: 'Check-In Panel', cmd: 'check in panel' },
      { label: 'Mission Link', cmd: 'mission panel' },
      { label: 'Team Check-In', cmd: 'team check in' },
    ],
  },
  {
    group: 'SOS FAST ACCESS',
    priority: true,
    items: [
      { label: 'Morse Toggle', cmd: 'morse toggle' },
      { label: 'Flashlight On', cmd: 'flashlight on' },
      { label: 'Flashlight Off', cmd: 'flashlight off' },
    ],
  },
  {
    group: 'Navigation',
    items: [
      { label: 'Center GPS', cmd: 'center' },
      { label: 'Zoom In', cmd: 'zoom in' },
      { label: 'Zoom Out', cmd: 'zoom out' },
      { label: 'Status', cmd: 'status' },
      { label: 'Read Situation', cmd: 'situation' },
    ],
  },
  {
    group: 'Route',
    items: [
      { label: 'Add Pin', cmd: 'add pin' },
      { label: 'Next Waypoint', cmd: 'next waypoint' },
      { label: 'Route Stats', cmd: 'route stats' },
      { label: 'Reset Layout', cmd: 'reset' },
    ],
  },
  {
    group: 'Map baselayers',
    items: [
      { label: 'Streets', cmd: 'streets map' },
      { label: 'Topo', cmd: 'topo map' },
      { label: 'Outdoor', cmd: 'outdoor map' },
      { label: 'Satellite', cmd: 'satellite map' },
    ],
  },
  {
    group: 'Situational overlays',
    items: [
      { label: 'Map panel', cmd: 'map layers panel' },
      { label: 'Fire map on', cmd: 'show fire map' },
      { label: 'Fire map off', cmd: 'hide fire map' },
      { label: 'Bike paths on', cmd: 'bike paths on' },
      { label: 'All overlays off', cmd: 'hide all overlays' },
    ],
  },
  {
    group: 'Display & Weather',
    items: [
      { label: 'Weather', cmd: 'weather' },
      { label: 'Refresh Weather', cmd: 'weather refresh' },
      { label: 'Night Mode', cmd: 'night' },
      { label: 'Low Light', cmd: 'low light' },
      { label: 'Bright', cmd: 'bright' },
    ],
  },
]

export default function VoicePanel() {
  const { commands, dispatch } = useHudCommands()
  const missionSync = useMissionSync()
  const isMobileHud = getDeviceProfile().interactionMode === 'mobile'

  const quickCommandGroups = useMemo(() => {
    const meshItems: Array<{ label: string; cmd: string }> = [
      { label: 'Message whole team…', cmd: 'team message' },
      { label: 'Who is linked', cmd: 'team roster' },
    ]
    for (const cs of listLinkedFieldCallsigns(missionSync.peers, missionSync.deviceId)) {
      meshItems.push({
        label: `Message ${cs}`,
        cmd: `message ${cs.toLowerCase()}`,
      })
    }
    const out = [...BASE_QUICK_COMMAND_GROUPS]
    const commsIdx = out.findIndex((g) => g.group === 'Comms')
    out.splice(commsIdx + 1, 0, { group: 'Mission mesh (live)', items: meshItems })
    return out
  }, [missionSync.peers, missionSync.deviceId])

  const touchGapMd = touchGapMdFn(isMobileHud)
  const touchGapSm = touchGapSmFn(isMobileHud)
  const tapMin = touchMinTargetFn(isMobileHud)
  const btnMin = (px: number) => Math.max(tapMin, px)
  const labelPx = (px: number) => Math.max(touchFontSmFn(isMobileHud), px)
  const bodyPx = touchFontMdFn(isMobileHud)

  // Flatten the voice directory definition into the validator's expected
  // shape. This lets us answer "are any directory items missing from the
  // registry?" and surface ghost items + label drift in the runtime
  // overlay. Source of truth for what a button does is still the registry
  // descriptor; this UI is a curated subset of that registry.
  const directoryItems = useMemo<VoiceDirectoryItem[]>(
    () =>
      quickCommandGroups.flatMap((g) =>
        g.items.map((it) => ({ group: g.group, cmd: it.cmd, label: it.label })),
      ),
    [quickCommandGroups],
  )

  /** Full registry catalog for the expanded command reference (no stubs). */
  const voiceCommandCatalog = useMemo(() => {
    const byGroup = new Map<string, typeof commands>()
    for (const c of commands) {
      if (VOICE_STUB_COMMAND_IDS.has(c.id)) continue
      const g = c.group ?? 'Other'
      const list = byGroup.get(g) ?? []
      list.push(c)
      byGroup.set(g, list)
    }
    for (const list of byGroup.values()) {
      list.sort((a, b) => a.id.localeCompare(b.id))
    }
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [commands])

  useEffect(() => {
    const report = validateVoiceRegistry(commands, directoryItems)
    updateVoiceRegistryReport(report)
  }, [commands, directoryItems])

  const [voiceState, setVoiceState] = useState<VoiceState>('sleeping')
  const [expanded, setExpanded] = useState(false)
  // SR lifecycle: `off` = mic fully torn down; powerSave / hardListen = armed profiles.
  const [listenMode, setListenMode] = useState<VoiceListenMode>('off')
  const armed = listenMode !== 'off'
  const [typed, setTyped] = useState('')
  const [lastHeard, setLastHeard] = useState('')
  // Single SR ownership: the mic button is the ONE control for the SR
  // lifecycle. Label clarifies "tap to start" rather than "tap to wake"
  // so it does not imply a second tap-to-wake mode that competes with
  // continuous mode. The button toggles the same `armed` flag whether
  // continuous mode is on or off.
  const [statusText, setStatusText] = useState('🔇 Voice OFF — choose a listen mode')
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
  /** Drop SR finals briefly after command TTS so speaker echo cannot re-trigger parse. */
  const ignoreSrUntilRef = useRef(0)
  const lastMicStartAtRef = useRef(0)
  const lastWakePulseAtRef = useRef(0)
  const scheduleMicRestartRef = useRef<(delayMs?: number) => void>(() => {})
  const listenModeRef = useRef<VoiceListenMode>('off')
  const lastParsedFinalRef = useRef({ key: '', at: 0 })
  const lastBareHudAtRef = useRef(0)
  armedRef.current = armed
  listenModeRef.current = listenMode
  const listenProfile = useMemo(() => getVoiceListenProfile(listenMode), [listenMode])
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
      ignoreSrUntilRef.current = 0
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
  }, [armed, listenMode])

  const hardDisarm = useCallback(() => {
    stopVoiceOutputOnly('hard-disarm')
    listenModeRef.current = 'off'
    setListenMode('off')
    setVoiceState('sleeping')
    setStatusText('🔇 Voice OFF')
    pendingWakeUntilRef.current = null
    ignoreSrUntilRef.current = 0
    setRecognitionOutputHold(false)
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    if (uiResetTimerRef.current != null) {
      window.clearTimeout(uiResetTimerRef.current)
      uiResetTimerRef.current = null
    }
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.onstart = null
        rec.onresult = null
        rec.onerror = null
        rec.onend = null
        rec.stop?.()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
    updateVoiceState('inactive_clean')
    logInfo('VOICE', 'hard-disarm')
  }, [])

  const requestMicGranted = useCallback(async (): Promise<boolean> => {
    updateVoiceState('arming')
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
      return false
    }
    return true
  }, [])

  const armListenMode = useCallback(
    async (mode: 'powerSave' | 'hardListen') => {
      if (listenMode === mode) return
      const ok = await requestMicGranted()
      if (!ok) return
      listenModeRef.current = mode
      setListenMode(mode)
      setRecoveryNonce((n) => n + 1)
      setVoiceState('listening')
      setStatusText(
        mode === 'powerSave'
          ? '🎤 Power save — say HUD, then command'
          : '🎤 Hard listen — say HUD weather (one phrase OK)',
      )
      logInfo('VOICE', `arm mode=${mode}`)
    },
    [listenMode, requestMicGranted],
  )

  useEffect(() => {
    setVoicePanelCommandHandlers({
      sleep: hardDisarm,
      enableContinuous: () => armListenMode('hardListen'),
    })
    return () => setVoicePanelCommandHandlers(null)
  }, [hardDisarm, armListenMode])

  /** Transient acknowledgement: centralized snapshot signal → CockpitHudShell CSS pulse.
   * Haptic is dispatched by `recordWakeWordGatePassed` via the centralized
   * runtime broker (capability-checked, throttled, mobile-only). SR/parser/
   * dispatch unchanged. */
  const pulseWake = () => {
    const now = Date.now()
    if (now - lastWakePulseAtRef.current < 1500) return
    lastWakePulseAtRef.current = now
    recordWakeWordGatePassed()
    if (listenProfile.chimeOnWake) playChime()
  }

  const speakHandsFree = async (
    text: string,
    opts?: { pauseRecognition?: boolean },
  ) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const pauseRecognition =
      opts?.pauseRecognition !== undefined
        ? opts.pauseRecognition
        : listenProfile.pauseSrDuringTts
    const rec = recognitionRef.current
    if (pauseRecognition && rec && armedRef.current) {
      setRecognitionOutputHold(true)
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      try {
        rec.stop()
      } catch {
        // onend may fire; output hold blocks immediate mic restart
      }
    }
    const rate = getDeviceProfile().isIOS ? 0.92 : 0.95
    try {
      await speakHudPhrase(trimmed, rate)
    } finally {
      if (pauseRecognition) {
        setRecognitionOutputHold(false)
        const cooldownUntil = performance.now() + listenProfile.outputCooldownMs
        ignoreSrUntilRef.current = cooldownUntil
        armRecognitionIgnoreUntil(cooldownUntil)
        if (armedRef.current) {
          scheduleMicRestartRef.current(listenProfile.outputCooldownMs + 300)
        }
      }
    }
  }

  const report = (text: string, ok = true) => {
    setStatusText(text)
    setVoiceState(ok ? 'success' : 'failure')
    if (text.trim()) {
      void speakHandsFree(text)
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
    const cmd = normalizeVoiceTranscript(rawCmd)
    if (!cmd) return
    setVoiceState('processing')
    setLastHeard(formatVoicePhraseForDisplay(rawTranscript ?? `hud ${cmd}`))
    const res = await dispatch(cmd, source, rawTranscript ?? `HUD ${cmd}`)
    report(res.message, res.ok)
  }

  const parseAndRun = async (text: string) => {
    const normWake = normalizeForWakeGate(text)
    const norm = normalizeVoiceTranscript(text)
    if (!normWake) return
    if (shouldBlockSpeechRecognition()) {
      return
    }
    if (performance.now() < ignoreSrUntilRef.current) {
      return
    }
    const nowMs = Date.now()
    if (normWake === lastParsedFinalRef.current.key && nowMs - lastParsedFinalRef.current.at < 2000) {
      return
    }
    lastParsedFinalRef.current = { key: normWake, at: nowMs }
    const activeProfile = getVoiceListenProfile(listenModeRef.current)

    // Utterance continuity window: a recent bare "HUD" finalization left
    // a one-shot 2500ms continuation window open. A short, simple
    // follow-up transcript ("weather", "center map") that would normally
    // fail the wake-word gate is treated as if it had been spoken with
    // "HUD " prefix. Sanity bounds (≤6 words, ≤60 chars) prevent the
    // window from being consumed by long unrelated speech. The window is
    // one-shot — consumption clears it.
    let consumedContinuation = false
    let continuationCmd = norm
    if (pendingWakeUntilRef.current != null) {
      if (performance.now() <= pendingWakeUntilRef.current) {
        const directlyHasWake = hasWakeWordPrefix(normWake)
        if (!directlyHasWake) {
          continuationCmd = stripWakeAckEchoFromContinuation(norm)
          const wordCount = continuationCmd.split(/\s+/).filter(Boolean).length
          const sane =
            continuationCmd.length >= SANITY_MIN_FINAL_LEN &&
            continuationCmd.length <= SANITY_MAX_CONTINUATION_CHARS &&
            wordCount <= SANITY_MAX_CONTINUATION_WORDS
          if (sane) {
            consumedContinuation = true
            pendingWakeUntilRef.current = null
            logInfo('VOICE', `wake-window.consume phrase="${continuationCmd.slice(0, 60)}"`)
          }
        }
      } else {
        pendingWakeUntilRef.current = null
        logInfo('VOICE', 'wake-window.expire')
      }
    }

    const wakeScoped = consumedContinuation
      ? `${WAKE_WORD} ${continuationCmd}`
      : (sliceFromFirstWakeToken(normWake) ?? normWake)
    const effective = wakeScoped

    // SYSTEM RULE: HUD is the ONLY valid activation token.
    // No aliases, no fuzzy matching, no fallback activation allowed.
    //
    // The transcript MUST start with the literal token "hud" (case-insensitive
    // via `normalize`). The check is exact-equality OR exact-prefix `"hud "`.
    // The continuation-window branch above synthesizes a leading "hud "
    // when (and only when) a bare wake-word was recently confirmed AND
    // the follow-up phrase passes sanity bounds — wake-word policy is
    // never bypassed for arbitrary utterances.
    if (!hasWakeWordPrefix(effective)) {
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
    const commandsPart = stripRepeatedWakePrefix(
      effective === WAKE_WORD ? '' : effective.slice(WAKE_WORD.length + 1).trim(),
    )
    const parts = commandsPart.split(/\bthen\b/).map((s) => s.trim()).filter(Boolean)

    if (parts.length === 0) {
      if (nowMs - lastBareHudAtRef.current < 1500) return
      if (pendingWakeUntilRef.current != null && performance.now() <= pendingWakeUntilRef.current) {
        return
      }
      lastBareHudAtRef.current = nowMs
      if (!consumedContinuation) pulseWake()
      setStatusText('🎤 Yes? — say your command')
      setVoiceState('success')
      logInfo('VOICE', 'wake-word.only-detected')
      await speakHandsFree(WAKE_ACK_SPOKEN)
      pendingWakeUntilRef.current = performance.now() + activeProfile.wakeContinuationMs
      logInfo('VOICE', `wake-window.open ms=${activeProfile.wakeContinuationMs}`)
      updateVoiceState('listening')
      return
    }

    if (!consumedContinuation) pulseWake()
    if (!consumedContinuation) {
      await speakHandsFree(WAKE_ACK_SPOKEN)
    }
    pendingWakeUntilRef.current = performance.now() + activeProfile.wakeContinuationMs
    for (const p of parts) {
      const mission = await tryHandleMissionCommsVoice(p)
      if (mission) {
        report(mission.feedback, mission.ok)
        continue
      }
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
    const listen = getVoiceListenProfile(listenModeRef.current)
    rec.continuous = listen.continuous
    rec.interimResults = listen.interimResults

    let startedOnce = false
    const MAX_RESTART_ATTEMPTS = listen.maxRestartAttempts
    const BASE_BACKOFF_MS = listen.powerSave ? listen.minRestartGapMs : 400
    const MAX_BACKOFF_MS = listen.powerSave ? listen.minRestartGapMs : 8000
    let watchdog: number | null = null

    const tryStartRecognition = () => {
      if (!armedRef.current) return
      if (shouldBlockSpeechRecognition()) {
        scheduleMicRestart(speechRecognitionBlockRemainingMs() + 150)
        return
      }
      try {
        startedOnce = false
        rec.start()
        lastMicStartAtRef.current = Date.now()
        armWatchdog()
        logInfo('VOICE', 'sr.start')
      } catch (err) {
        updateVoiceMeta({
          lastInterruptionReason: `restart-throw:${(err as Error)?.message ?? 'unknown'}`,
        })
        updateVoiceState('degraded', { lastError: 'restart threw' })
        setVoiceState('failure')
        setStatusText('🎤 Voice degraded — tap to re-arm')
        hardDisarm()
        updateVoiceRecoveryState('failed')
        logWarn('VOICE', `sr.start threw error=${(err as Error)?.message ?? 'unknown'}`)
      }
    }

    const scheduleMicRestart = (requestedDelay = listen.minRestartGapMs) => {
      if (!armedRef.current) return
      const blockRemaining = speechRecognitionBlockRemainingMs()
      if (performance.now() < ignoreSrUntilRef.current) {
        const wait = ignoreSrUntilRef.current - performance.now() + 200
        requestedDelay = Math.max(requestedDelay, wait)
      }
      requestedDelay = Math.max(requestedDelay, blockRemaining + 150)
      const elapsed = Date.now() - lastMicStartAtRef.current
      const delay = Math.max(0, requestedDelay - elapsed)
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null
        if (!armedRef.current) return
        tryStartRecognition()
      }, delay)
    }
    scheduleMicRestartRef.current = scheduleMicRestart

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
          hardDisarm()
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
      setStatusText(
        listen.mode === 'powerSave'
          ? '🎤 Power save — say HUD, then command'
          : '🎤 Hard listen — say HUD + command',
      )
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
        if (finalText.length > 0) {
          const heard = formatVoicePhraseForDisplay(finalText)
          if (heard) setLastHeard(heard)
        }
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
      hardDisarm()
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
      if (isRecognitionOutputHeld() || shouldBlockSpeechRecognition()) {
        logInfo('VOICE', 'sr.onend deferred-output-hold')
        scheduleMicRestart(listen.outputCooldownMs)
        return
      }
      restartAttemptsRef.current += 1
      updateVoiceMeta({ restartAttempts: restartAttemptsRef.current, lastInterruptionReason: 'onend' })
      updateVoiceRecoveryState('recovering')
      updateVoiceState('recovering')

      if (restartAttemptsRef.current > MAX_RESTART_ATTEMPTS) {
        updateVoiceState('degraded', { lastError: 'recovery attempts exceeded' })
        setVoiceState('failure')
        setStatusText('🎤 Voice degraded — tap to re-arm')
        hardDisarm()
        updateVoiceRecoveryState('failed')
        logWarn('VOICE', `sr.onend recovery-exhausted attempts=${restartAttemptsRef.current}`)
        return
      }

      const backoff = listen.powerSave
        ? listen.minRestartGapMs
        : Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, restartAttemptsRef.current - 1))
      logInfo('VOICE', `sr.onend restart attempt=${restartAttemptsRef.current} backoff=${backoff}ms`)
      scheduleMicRestart(backoff)
    }

    try {
      updateVoiceState('recovering', { lastSrStartAt: Date.now() })
      tryStartRecognition()
      logInfo('VOICE', 'sr.start initial-arm')
    } catch (err) {
      updateVoiceState('degraded', {
        lastError: `start threw: ${(err as Error)?.message ?? 'unknown'}`,
      })
      setVoiceState('failure')
      setStatusText('🎤 Voice unresponsive — tap to retry')
      hardDisarm()
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
      scheduleMicRestartRef.current = () => {}
      setRecognitionOutputHold(false)
      stopVoiceOutputOnly('sr-cleanup')
      logInfo('VOICE', 'sr.cleanup effect-teardown')
      // Reflect the user's intent: arm=false → clean inactive; otherwise we
      // were torn down externally and do not change state here.
      if (!armedRef.current) updateVoiceState('inactive_clean')
    }
  }, [armed, listenMode, supportsRec, recoveryNonce, hardDisarm])

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
  const armFromHardwareShortcut = useCallback(async () => {
    traceAction('voice_hardware_hold', 'handler_enter', { mode: listenModeRef.current })
    if (!supportsRec) return
    const ok = await requestMicGranted()
    if (!ok) return
    listenModeRef.current = 'hardListen'
    setListenMode('hardListen')
    setRecoveryNonce((n) => n + 1)
    await speakHandsFree(WAKE_ACK_SPOKEN)
    pendingWakeUntilRef.current =
      performance.now() + getVoiceListenProfile('hardListen').wakeContinuationMs
    setStatusText('🎤 Yes? — say your command')
    logInfo('VOICE', 'hardware-hold.armed-hardListen')
  }, [supportsRec, requestMicGranted])

  useVolumeUpVoiceArm(() => {
    void armFromHardwareShortcut()
  }, { enabled: isMobileHud && supportsRec })

  const longPressArm = useLongPressVoiceArm(() => {
    void armFromHardwareShortcut()
  })

  return (
    <HudPanel
      panelId="voice"
      title="Voice Directory"
      initialPos={{ x: 1240, y: 280 }}
      initialWidth={isMobileHud ? 340 : 380}
      minHeight={150}
      accent={voiceState === 'failure' ? '#ff3b4d' : undefined}
    >
      <div style={{ display: 'grid', gap: touchGapMd }}>
        <div
          style={{
            minHeight: btnMin(36),
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${armed ? 'rgba(125,255,138,0.45)' : 'rgba(199,206,198,0.22)'}`,
            background: 'rgba(10,12,13,0.8)',
            color: armed ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
            fontSize: labelPx(11),
            letterSpacing: '0.06em',
            lineHeight: 1.45,
          }}
        >
          {statusText}
        </div>

        <div style={{ display: 'flex', gap: touchGapSm, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-no-drag
            onClick={hardDisarm}
            style={{
              flex: '1 1 30%',
              minHeight: btnMin(40),
              borderRadius: 8,
              border: '1px solid rgba(255,80,90,0.55)',
              background: listenMode === 'off' ? 'rgba(255,80,90,0.2)' : 'rgba(10,12,13,0.85)',
              color: '#ff8a92',
              cursor: 'pointer',
              fontSize: labelPx(10),
              fontWeight: 700,
              letterSpacing: '0.08em',
            }}
          >
            HARD OFF
          </button>
          <button
            type="button"
            data-no-drag
            onClick={() => void armListenMode('powerSave')}
            style={{
              flex: '1 1 30%',
              minHeight: btnMin(40),
              borderRadius: 8,
              border:
                listenMode === 'powerSave'
                  ? '1px solid rgba(125,255,138,0.65)'
                  : '1px solid rgba(199,206,198,0.28)',
              background:
                listenMode === 'powerSave' ? 'rgba(125,255,138,0.16)' : 'rgba(10,12,13,0.8)',
              color: listenMode === 'powerSave' ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: labelPx(10),
              fontWeight: 700,
              letterSpacing: '0.08em',
            }}
          >
            POWER SAVE
          </button>
          <button
            type="button"
            data-no-drag
            onClick={() => void armListenMode('hardListen')}
            style={{
              flex: '1 1 30%',
              minHeight: btnMin(40),
              borderRadius: 8,
              border:
                listenMode === 'hardListen'
                  ? '1px solid rgba(125,255,138,0.65)'
                  : '1px solid rgba(199,206,198,0.28)',
              background:
                listenMode === 'hardListen' ? 'rgba(125,255,138,0.16)' : 'rgba(10,12,13,0.8)',
              color: listenMode === 'hardListen' ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: labelPx(10),
              fontWeight: 700,
              letterSpacing: '0.08em',
            }}
          >
            HARD LISTEN
          </button>
        </div>

        {isMobileHud && supportsRec ? (
          <button
            type="button"
            data-no-drag
            {...longPressArm}
            style={{
              minHeight: btnMin(40),
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.35)',
              background: 'rgba(10,12,13,0.85)',
              color: '#c5cdc5',
              cursor: 'pointer',
              fontSize: labelPx(10),
              letterSpacing: '0.08em',
              touchAction: 'none',
            }}
          >
            Hold 3s here → Hard listen + &quot;Yes?&quot;
          </button>
        ) : null}

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
          <div
            style={{
              fontSize: labelPx(11),
              color: '#c5cdc5',
              lineHeight: 1.55,
              display: 'grid',
              gap: touchGapMd,
            }}
          >
            <div style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(10,12,13,0.55)' }}>
              <div style={{ marginBottom: 6, color: '#aeb8ae' }}>
                <strong style={{ color: '#e2eae2' }}>HARD OFF</strong> stops the mic completely.{' '}
                <strong style={{ color: '#e2eae2' }}>POWER SAVE</strong> rests the mic between phrases.{' '}
                <strong style={{ color: '#e2eae2' }}>HARD LISTEN</strong> keeps the mic ready for hands-free
                (&quot;HUD weather&quot; in one phrase is OK).
              </div>
              Wake word: <strong style={{ color: '#e2eae2' }}>HUD</strong>. Example one breath:{' '}
              <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#e2eae2' }}>HUD weather</span>
              — or <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#e2eae2' }}>HUD</span> → Yes? →{' '}
              <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#e2eae2' }}>weather</span>.
              Volume-up 3s rarely works in mobile browsers — use the hold button above.
              <div style={{ marginTop: 6, fontSize: labelPx(10), color: 'var(--cockpit-panel-subtle)' }}>
                Last heard: {lastHeard || '—'}
              </div>
            </div>
            <div
              style={{
                fontSize: labelPx(11),
                letterSpacing: '0.08em',
                fontWeight: 700,
                color: '#aeb8ae',
              }}
            >
              ONE-TAP COMMANDS
            </div>
            <div
              data-no-drag
              style={{
                maxHeight: isMobileHud ? 240 : 220,
                overflowY: 'auto',
                border: '1px solid rgba(199,206,198,0.28)',
                borderRadius: 8,
                background: 'rgba(10,12,13,0.72)',
                padding: touchGapMd,
                display: 'grid',
                gap: touchGapMd,
              }}
            >
              {quickCommandGroups.map((group) => (
                <div key={group.group} style={{ display: 'grid', gap: touchGapSm }}>
                  <div
                    style={{
                      fontSize: labelPx(11),
                      letterSpacing: '0.08em',
                      color: group.priority ? '#ffb8c6' : '#aeb8ae',
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
                        minHeight: btnMin(40),
                        textAlign: 'left',
                        borderRadius: 6,
                        border: group.priority ? '1px solid rgba(255,127,151,0.35)' : '1px solid rgba(199,206,198,0.3)',
                        background: group.priority ? 'rgba(255,75,112,0.18)' : 'rgba(199,206,198,0.14)',
                        color: '#e2eae2',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: bodyPx,
                        lineHeight: 1.35,
                        letterSpacing: '0.02em',
                      }}
                    >
                      <span style={{ display: 'block', fontWeight: 600 }}>{item.label}</span>
                      <span
                        style={{
                          display: 'block',
                          marginTop: 2,
                          fontSize: labelPx(10),
                          fontFamily: 'var(--font-mono, monospace)',
                          color: '#9aa89a',
                        }}
                      >
                        HUD {item.cmd}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div
              style={{
                fontSize: labelPx(11),
                letterSpacing: '0.08em',
                fontWeight: 700,
                color: '#aeb8ae',
              }}
            >
              FULL VOICE COMMAND LIST (prefix with HUD)
            </div>
            <div
              data-no-drag
              style={{
                maxHeight: isMobileHud ? 300 : 280,
                overflowY: 'auto',
                border: '1px solid rgba(199,206,198,0.24)',
                borderRadius: 8,
                background: 'rgba(10,12,13,0.62)',
                padding: touchGapMd,
                display: 'grid',
                gap: touchGapMd,
                fontSize: bodyPx,
                lineHeight: 1.5,
                color: '#d0dad0',
              }}
            >
              {voiceCommandCatalog.map(([group, cmds]) => (
                <div key={group} style={{ display: 'grid', gap: 6 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: labelPx(11),
                      letterSpacing: '0.08em',
                      color: '#aeb8ae',
                      borderBottom: '1px solid rgba(199,206,198,0.16)',
                      paddingBottom: 4,
                    }}
                  >
                    {group}
                  </div>
                  {cmds.map((c) => (
                    <div key={c.id} style={{ display: 'grid', gap: 2 }}>
                      <div style={{ color: '#e8efe8', fontWeight: 600 }}>{c.label}</div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono, monospace)',
                          fontSize: labelPx(10),
                          color: '#c5cdc5',
                        }}
                      >
                        HUD {c.id}
                      </div>
                      {c.aliases && c.aliases.length > 0 ? (
                        <div style={{ fontSize: labelPx(10), color: '#8f9b8f', lineHeight: 1.4 }}>
                          Also: {c.aliases.slice(0, 8).join(', ')}
                          {c.aliases.length > 8 ? ', …' : ''}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ fontSize: labelPx(10), color: 'var(--cockpit-panel-subtle)', lineHeight: 1.45 }}>
              Fire and water briefs use live weather. AI route, LiDAR, AR, and biometrics report build limits honestly.
            </div>
          </div>
        )}
      </div>
    </HudPanel>
  )
}
