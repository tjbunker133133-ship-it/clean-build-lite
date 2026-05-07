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

type VoiceState = 'sleeping' | 'listening' | 'processing' | 'success' | 'failure'

// SYSTEM RULE: HUD is the ONLY valid activation token.
// No aliases, no fuzzy matching, no fallback activation allowed.
// This constant is the single source of truth for the wake word and is the
// only string that can authorize voice command execution.
const WAKE_WORD = 'hud' as const

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
  const [statusText, setStatusText] = useState('🎤 HUD (tap to wake)')
  const [recoveryNonce, setRecoveryNonce] = useState(0)
  const recognitionRef = useRef<any>(null)
  const armedRef = useRef(false)
  const recoveryAttemptedRef = useRef(false)
  const suspendedByLifecycleRef = useRef(false)
  const restartAttemptsRef = useRef(0)
  const restartTimerRef = useRef<number | null>(null)
  const lastRecognitionAtRef = useRef<number | null>(null)
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
    speak(text)
    window.setTimeout(() => setVoiceState(armedRef.current ? 'listening' : 'sleeping'), 650)
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

    // SYSTEM RULE: HUD is the ONLY valid activation token.
    // No aliases, no fuzzy matching, no fallback activation allowed.
    //
    // The transcript MUST start with the literal token "hud" (case-insensitive
    // via `normalize`). The check is exact-equality OR exact-prefix `"hud "`.
    // Any other input is silently ignored — no error UI, no fallback modal,
    // no continuous-mode bypass, no rolling wake window. This gate is the only
    // entry path for free-text transcripts (voice + typed-input fallback).
    if (norm !== WAKE_WORD && !norm.startsWith(`${WAKE_WORD} `)) {
      // Critical DEPE guard: wake-word bypass attempt detected and blocked.
      reportPolicyAttempt('voice.wakeWordRequired', 'disable', 'parseAndRun.missing-wake-word')
      return
    }

    // DEPE: wake-word gate is REQUIRED in every mode. We report 'enable' when
    // the gate is honored (we just passed it). A future code path that bypassed
    // this check would never call this report, and the engine's required-vs-
    // active periodic validator would catch the silent absence.
    reportPolicyAttempt('voice.wakeWordRequired', 'enable', 'parseAndRun.gate-passed')
    pulseWake()
    setVoiceState('listening')
    updateVoiceState('processing')
    const commandsPart =
      norm === WAKE_WORD ? '' : norm.slice(WAKE_WORD.length + 1).trim()
    const parts = commandsPart.split(/\bthen\b/).map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) {
      report('Ready. Say HUD plus command.', true)
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
      reportPolicyAttempt('voice.backgroundListenerWhenDisarmed', 'enable', 'duplicate-recognition-instance')
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = false

    let startedOnce = false
    const MAX_RESTART_ATTEMPTS = 6
    const BASE_BACKOFF_MS = 400
    const MAX_BACKOFF_MS = 8000
    let watchdog: number | null = null

    const armWatchdog = () => {
      if (watchdog != null) window.clearTimeout(watchdog)
      // If `onstart` does not fire within 1500 ms after rec.start(), declare dead.
      watchdog = window.setTimeout(() => {
        if (!startedOnce && armedRef.current) {
          updateVoiceState('dead', { lastError: 'recognizer onstart timeout' })
          // DEPE: silent dead-state is forbidden — surface as a violation so
          // it shows up in the overlay and console.
          reportPolicyAttempt('voice.silentDeadState', 'enable', 'watchdog-timeout-1500ms')
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
      if (suspendedByLifecycleRef.current) {
        updateVoiceRecoveryState('resumed')
        suspendedByLifecycleRef.current = false
      } else {
        updateVoiceRecoveryState('idle')
      }
    }
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results)
        .slice(e.resultIndex)
        .map((r: any) => r[0]?.transcript ?? '')
        .join(' ')
      lastRecognitionAtRef.current = Date.now()
      updateVoiceMeta({ lastTranscript: transcript.slice(0, 200), lastRecognitionAt: lastRecognitionAtRef.current })
      void parseAndRunRef.current(transcript)
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
    }
    rec.onend = () => {
      if (!armedRef.current) {
        updateVoiceState('inactive_clean')
        updateVoiceRecoveryState('idle')
        return
      }
      // Bounded recovery strategy: exponential backoff, capped attempts.
      restartAttemptsRef.current += 1
      updateVoiceMeta({ restartAttempts: restartAttemptsRef.current, lastInterruptionReason: 'onend' })
      updateVoiceRecoveryState('recovering')
      updateVoiceState('recovering')

      if (restartAttemptsRef.current > MAX_RESTART_ATTEMPTS) {
        updateVoiceState('degraded', { lastError: 'recovery attempts exceeded' })
        setVoiceState('failure')
        setStatusText('🎤 Voice degraded — tap to re-arm')
        setArmed(false)
        updateVoiceRecoveryState('failed')
        return
      }

      const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, restartAttemptsRef.current - 1))
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null
        if (!armedRef.current) return
        try {
          startedOnce = false
          rec.start()
          armWatchdog()
        } catch (err) {
          updateVoiceMeta({
            lastInterruptionReason: `restart-throw:${(err as Error)?.message ?? 'unknown'}`,
          })
          updateVoiceState('degraded', { lastError: 'restart threw' })
          setVoiceState('failure')
          setStatusText('🎤 Voice degraded — tap to re-arm')
          setArmed(false)
          updateVoiceRecoveryState('failed')
        }
      }, backoff)
    }

    try {
      updateVoiceState('recovering', { lastSrStartAt: Date.now() })
      rec.start()
      armWatchdog()
    } catch (err) {
      updateVoiceState('degraded', {
        lastError: `start threw: ${(err as Error)?.message ?? 'unknown'}`,
      })
      setVoiceState('failure')
      setStatusText('🎤 Voice unresponsive — tap to retry')
      setArmed(false)
      updateVoiceRecoveryState('failed')
      return
    }

    // Field continuity: lifecycle interruption does not cancel user intent.
    const onPageHide = () => {
      suspendedByLifecycleRef.current = true
      updateVoiceRecoveryState('suspended')
      updateVoiceState('inactive_clean', { lastError: 'interrupted: pagehide' })
      try {
        rec.stop()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        suspendedByLifecycleRef.current = true
        updateVoiceRecoveryState('suspended')
        updateVoiceState('inactive_clean', { lastError: 'interrupted: hidden' })
        try {
          rec.stop()
        } catch {
          // ignore
        }
        recognitionRef.current = null
        return
      }
      // One-shot recovery on resume while preserving armed intent.
      if (armedRef.current && suspendedByLifecycleRef.current && !recoveryAttemptedRef.current) {
        recoveryAttemptedRef.current = true
        updateVoiceRecoveryState('recovering')
        setRecoveryNonce((n) => n + 1)
      }
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
      if (watchdog != null) {
        window.clearTimeout(watchdog)
        watchdog = null
      }
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      try {
        rec.stop()
      } catch {
        // ignore
      }
      recognitionRef.current = null
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
      },
    )
  }, [armed])

  // Single SR lifecycle toggle. Used by both the primary mic button and the
  // CONTINUOUS ON/OFF button so they cannot disagree.
  // Pre-condition for ON: mic permission must be granted.
  // Post-condition for OFF: SR effect cleanup runs (rec.stop + listener
  // removal) — no background listener remains.
  const toggleVoiceLifecycle = async () => {
    if (!armed) {
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
        return
      }
    } else {
      updateVoiceState('inactive_clean')
    }
    setArmed((v) => !v)
    setVoiceState((s) => (s === 'sleeping' ? 'listening' : 'sleeping'))
    setStatusText((t) => (t.includes('listening') ? '🎤 HUD (tap to wake)' : '🎤 HUD listening'))
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
      <div style={{ display: 'grid', gap: 8 }}>
        <button
          type="button"
          data-no-drag
          onClick={toggleVoiceLifecycle}
          style={{
            minHeight: 40,
            borderRadius: 8,
            border: '1px solid rgba(125,255,138,0.5)',
            background: armed ? 'rgba(125,255,138,0.18)' : 'rgba(10,12,13,0.8)',
            color: armed ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
            boxShadow: armed ? '0 0 10px rgba(125,255,138,0.35)' : 'none',
            cursor: 'pointer',
            fontSize: 11,
            letterSpacing: '0.1em',
          }}
        >
          {expanded ? '🎤 HUD (tap to wake)' : statusText}
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-no-drag
            onClick={() => setExpanded((v) => !v)}
            style={{
              flex: 1,
              minHeight: 34,
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.28)',
              background: 'rgba(10,12,13,0.8)',
              color: 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: 10,
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
              minHeight: 34,
              borderRadius: 8,
              border: armed
                ? '1px solid rgba(125,255,138,0.6)'
                : '1px solid rgba(199,206,198,0.28)',
              background: armed ? 'rgba(125,255,138,0.16)' : 'rgba(10,12,13,0.8)',
              color: armed ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: 10,
              letterSpacing: '0.08em',
            }}
          >
            {armed ? 'CONTINUOUS ON' : 'CONTINUOUS OFF'}
          </button>
        </div>

        {!supportsRec && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)' }}>No speech recognition. Type command:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                data-no-drag
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="HUD status"
                style={{
                  flex: 1,
                  minHeight: 34,
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
                  minHeight: 34,
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
          <div style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)', lineHeight: 1.5, display: 'grid', gap: 8 }}>
            <div>
              Wake word: <strong>HUD</strong>. Example: <code>HUD status</code>. Last: {lastHeard || '—'}
            </div>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--cockpit-panel-subtle)' }}>
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
                padding: 6,
                display: 'grid',
                gap: 6,
              }}
            >
              {QUICK_COMMAND_GROUPS.map((group) => (
                <div key={group.group} style={{ display: 'grid', gap: 6 }}>
                  <div
                    style={{
                      fontSize: 9,
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
                        minHeight: 34,
                        textAlign: 'left',
                        borderRadius: 6,
                        border: group.priority ? '1px solid rgba(255,127,151,0.35)' : '1px solid rgba(199,206,198,0.26)',
                        background: group.priority ? 'rgba(255,75,112,0.18)' : 'rgba(199,206,198,0.12)',
                        color: '#d3dad3',
                        padding: '0 10px',
                        cursor: 'pointer',
                        fontSize: 11,
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
