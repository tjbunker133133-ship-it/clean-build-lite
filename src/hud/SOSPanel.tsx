import React, { useEffect, useMemo, useRef, useState } from 'react'
import HudPanel from './HudPanel'
import { useGPS } from '../hooks/useGPS'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { emitHaptic } from '../runtime/haptics'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { buildRescuePacket, rescuePacketDevLogSummary } from '../lib/rescue/buildRescuePacket'
import {
  buildRescueDispatchHeaders,
  classifyRescueDispatchKey,
  hasRescueDispatchAuth,
  logRescueDispatchTrace,
  parseRescueDispatchFailure,
} from '../lib/rescue/rescueDispatch'
import { getRescueEligibility } from '../lib/rescue/eligibility'
import { useTacticalProfile } from '../hooks/useTacticalProfile'
import { traceAction } from '../runtime/actionTrace'
import {
  touchFontSm as touchFontSmFn,
  touchFontMd as touchFontMdFn,
  touchGapLg as touchGapLgFn,
  touchGapMd as touchGapMdFn,
  touchGapSm as touchGapSmFn,
  touchMinTarget as touchMinTargetFn,
} from './tokens'
import { resolveRapidEndpoint } from '../lib/rescue/resolveRapidEndpoint'

const HOLD_MS = 3000
const ALARM_PULSE_MS = 420
const MORSE_UNIT_MS = 180
const AUTO_LAUNCH_DELAY_S = 5

type AlarmMode = 'off' | 'armed'

// ── Morse signaling system ──────────────────────────────────────────────
// Independent from the SOS escalation trigger (slide-hold → arm → audible
// alarm + auto-launch rescue email). Morse only controls visual flashing:
// it never sends rescue emails, never invokes edge functions, and never
// arms the deadman. Only one pattern can run at a time; switching patterns
// stops the previous loop cleanly via `morseStopRef`.
type MorsePattern = 'off' | 'sos' | 'yes' | 'no'

type MorseStep = { on: boolean; units: number }

const MORSE_LETTERS: Record<string, number[]> = {
  // Standard timing units: dot = 1, dash = 3
  s: [1, 1, 1],
  o: [3, 3, 3],
  y: [3, 1, 3, 3],
  e: [1],
  n: [3, 1],
}

const MORSE_WORDS: Record<Exclude<MorsePattern, 'off'>, string> = {
  sos: 'sos',
  yes: 'yes',
  no: 'no',
}

function morseUnits(pattern: Exclude<MorsePattern, 'off'>): MorseStep[] {
  // Build a flat step list: on/off + duration in units. Inter-element gap
  // is 1u, inter-letter gap is 3u, end-of-word gap is 7u.
  const text = MORSE_WORDS[pattern]
  const out: MorseStep[] = []
  for (let li = 0; li < text.length; li += 1) {
    const seq = MORSE_LETTERS[text[li]]
    if (!seq) continue
    for (let si = 0; si < seq.length; si += 1) {
      out.push({ on: true, units: seq[si] })
      if (si < seq.length - 1) out.push({ on: false, units: 1 })
    }
    if (li < text.length - 1) out.push({ on: false, units: 3 })
  }
  out.push({ on: false, units: 7 })
  return out
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

// Removed obsolete localStorage contact fallbacks (`titanium_saved_contacts`,
// `emergency_contacts_saved`, `titanium_route_contacts`,
// `current_route_contacts`). The dispatch path is now backend-truth-only via
// `buildRescuePacket()` → `fetchEmergencyContacts()`.

export default function SOSPanel() {
  // CONTRACT-SENSITIVE (subscriptions): both calls are intentional. They
  // do not appear to be used inside this component, but removing them
  // changes runtime behavior:
  //   - `useGPS()` participates in the GPS singleton's listener refcount
  //     (`src/hooks/useGPS.ts`). Dropping the call here lets the watch
  //     tear down sooner than the panel's actual lifetime.
  //   - `useAppContext()` keeps the panel subscribed to global app state
  //     so future operational signals can flow without re-wiring.
  // Do NOT "clean up" by deleting these calls.
  useAppContext()
  useGPS()
  const { operationalReady, assessment } = useTacticalProfile()
  const { raisePanel, updatePanel } = useCockpit()
  const [holding, setHolding] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [mode, setMode] = useState<AlarmMode>('off')
  const [flashScreen, setFlashScreen] = useState<'yes' | 'no'>('no')
  const [flashlightEnabled, setFlashlightEnabled] = useState(false)
  const [morsePattern, setMorsePattern] = useState<MorsePattern>('off')
  const [status, setStatus] = useState('READY')
  const [launchCountdown, setLaunchCountdown] = useState<number | null>(null)
  const [flashInvert, setFlashInvert] = useState(false)
  const [flashlightActive, setFlashlightActive] = useState(false)
  // Audible alarm is operator-owned. Its lifecycle is fully decoupled from
  // the SOS rescue dispatch path: only the start/stop alarm functions and
  // the "TEST AUDIBLE ALARM" button mutate this flag. SOS arming, the
  // launch countdown, and rescue dispatch never touch it.
  const [alarmActive, setAlarmActive] = useState(false)

  const holdStartRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const oscRef = useRef<OscillatorNode | null>(null)
  const oscHiRef = useRef<OscillatorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const compRef = useRef<DynamicsCompressorNode | null>(null)
  const alarmTimerRef = useRef<number | null>(null)
  const morseStopRef = useRef(false)
  const flashlightStreamRef = useRef<MediaStream | null>(null)
  const flashlightTrackRef = useRef<MediaStreamTrack | null>(null)
  const launchTimerRef = useRef<number | null>(null)
  // CONTRACT-SENSITIVE (iOS): absolute wall-clock deadline for the
  // 5-second auto-launch window. iOS Safari throttles or fully pauses
  // setInterval on hidden tabs; tick-decrement math drifts and can delay
  // rescue dispatch after a background-suspend. Reading
  // `deadline - Date.now()` on each tick + on visibility resume means
  // the first resumed tick correctly fires the rescue if the deadline
  // has already passed during suspension.
  const launchDeadlineRef = useRef<number>(0)
  // CONTRACT-SENSITIVE (exactly-once-per-arm dispatch): `launchSentRef`
  // is the SOS auto-launch idempotency gate. Its lifecycle, by design:
  //   - flips to `true` at the top of `launchRescuePacket()` BEFORE any
  //     await — guarantees that a single arm window cannot POST twice
  //     even under StrictMode double-invocation or rapid re-entry.
  //   - is RESET to `false` ONLY when `[isArmed]` flips (operator disarms
  //     OR re-arms). The reset is intentional: re-arming is an explicit
  //     operator decision and must be allowed to dispatch again. Do NOT
  //     replace this with a session-storage lock (Deadman uses one because
  //     auto-expiry is involuntary; SOS is operator-initiated).
  //   - is NEVER cleared inside `launchRescuePacket` — leaving it true
  //     until disarm prevents an unmount-during-flight + remount from
  //     double-POSTing within the same arm window.
  const launchSentRef = useRef(false)
  // Mount tracker — guards post-async setState (rescue dispatch, future
  // additions). The rescue trigger gate (`launchSentRef`) is unchanged;
  // this only suppresses status-text writes after unmount.
  const mountedRef = useRef(true)
  /** Abort in-flight rescue POST on panel unmount only (not on disarm). */
  const rescueFetchAbortRef = useRef<AbortController | null>(null)

  const isArmed = mode === 'armed'
  const progressPct = Math.max(0, Math.min(100, holdProgress * 100))
  const alarmColor = useMemo(() => (isArmed ? '#ff4466' : '#ff1744'), [isArmed])

  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const gapLg = touchGapLgFn(isMobile)
  const gapMd = touchGapMdFn(isMobile)
  const gapSm = touchGapSmFn(isMobile)
  const tapMin = touchMinTargetFn(isMobile)
  const fontSm = touchFontSmFn(isMobile)
  const fontMd = touchFontMdFn(isMobile)
  // SOS-specific oversized targets: slide-to-confirm + safety toggles get a
  // 56px floor on mobile so the slider is operable with one thumb under stress.
  const safeMinPx = isMobile ? 56 : 40
  const trackHeight = isMobile ? 56 : 48
  const knobSize = safeMinPx
  const sliderTravel = Math.max(60, 220 - knobSize)
  const panelPadding = isMobile ? 16 : 12

  const stopAlarm = () => {
    if (alarmTimerRef.current) {
      window.clearInterval(alarmTimerRef.current)
      alarmTimerRef.current = null
    }
    const ctx = audioCtxRef.current
    const t = ctx?.currentTime ?? 0
    try {
      gainRef.current?.gain.cancelScheduledValues(t)
      gainRef.current?.gain.setValueAtTime(0, t)
    } catch {
      // noop
    }
    for (const node of [oscRef.current, oscHiRef.current]) {
      try {
        node?.stop(t + 0.02)
      } catch {
        // already stopped
      }
      try {
        node?.disconnect()
      } catch {
        // noop
      }
    }
    try {
      gainRef.current?.disconnect()
    } catch {
      // noop
    }
    try {
      compRef.current?.disconnect()
    } catch {
      // noop
    }
    oscRef.current = null
    oscHiRef.current = null
    gainRef.current = null
    compRef.current = null
    try {
      if (ctx && ctx.state === 'running') void ctx.suspend()
    } catch {
      // noop
    }
    setAlarmActive(false)
    setStatus('ALARM OFF')
  }

  const ensureFlashlightTrack = async () => {
    try {
      if (flashlightTrackRef.current) return flashlightTrackRef.current
      if (!navigator.mediaDevices?.getUserMedia) return null
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      const track = stream.getVideoTracks()[0]
      if (!track) return null
      flashlightStreamRef.current = stream
      flashlightTrackRef.current = track
      return track
    } catch {
      return null
    }
  }

  const setDeviceFlashlight = async (on: boolean) => {
    try {
      const track = await ensureFlashlightTrack()
      if (!track) return false
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
      if (!caps?.torch) return false
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      return true
    } catch {
      return false
    }
  }

  const stopFlashlight = async () => {
    try {
      if (flashlightTrackRef.current) {
        const caps = flashlightTrackRef.current.getCapabilities?.() as MediaTrackCapabilities & {
          torch?: boolean
        }
        if (caps?.torch) {
          await flashlightTrackRef.current.applyConstraints({
            advanced: [{ torch: false } as MediaTrackConstraintSet],
          })
        }
      }
    } catch {
      // noop
    }
    try {
      flashlightTrackRef.current?.stop()
    } catch {
      // noop
    }
    try {
      flashlightStreamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {
      // noop
    }
    flashlightTrackRef.current = null
    flashlightStreamRef.current = null
    setFlashlightActive(false)
  }

  const startAlarm = () => {
    stopAlarm()
    try {
      const ctx =
        audioCtxRef.current ??
        new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') void ctx.resume()
      const osc = ctx.createOscillator()
      const oscHi = ctx.createOscillator()
      const gain = ctx.createGain()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -12
      comp.knee.value = 20
      comp.ratio.value = 8
      comp.attack.value = 0.003
      comp.release.value = 0.12
      osc.type = 'sawtooth'
      oscHi.type = 'square'
      osc.frequency.value = 880
      oscHi.frequency.value = 1760
      gain.gain.value = 0.0001
      osc.connect(gain)
      oscHi.connect(gain)
      gain.connect(comp)
      comp.connect(ctx.destination)
      osc.start()
      oscHi.start()
      let hi = true
      alarmTimerRef.current = window.setInterval(() => {
        const now = ctx.currentTime
        osc.frequency.setValueAtTime(hi ? 1540 : 820, now)
        oscHi.frequency.setValueAtTime(hi ? 3080 : 1640, now)
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.exponentialRampToValueAtTime(0.95, now + 0.03)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
        hi = !hi
      }, ALARM_PULSE_MS)
      oscRef.current = osc
      oscHiRef.current = oscHi
      gainRef.current = gain
      compRef.current = comp
      setAlarmActive(true)
      setStatus('AUDIBLE ALARM ACTIVE')
    } catch {
      setAlarmActive(false)
      setStatus('ALARM FAILED (AUDIO BLOCKED)')
    }
  }

  const flashPattern = async (pattern: Exclude<MorsePattern, 'off'>) => {
    // Walk a precomputed on/off step list. The morseStopRef gate is checked
    // between every step so a pattern switch halts within MORSE_UNIT_MS.
    const seq = morseUnits(pattern)
    for (const step of seq) {
      if (morseStopRef.current) return
      setFlashInvert(step.on)
      await sleep(step.units * MORSE_UNIT_MS)
    }
  }

  // SOS-side cleanup on disarm. Releases the camera/flashlight track when off.
  // Audible alarm + morse are cleared in disarmAll() (STOP ALL / voice disarm).
  useEffect(() => {
    if (isArmed) return
    if (!flashlightEnabled) void stopFlashlight()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArmed, flashlightEnabled])

  // Independent Morse signaling effect. Runs purely on morsePattern + the
  // two output channels. No dependency on isArmed, no rescue calls, no
  // edge functions. Cleanup sets morseStopRef=true so any in-flight pattern
  // exits at the next step boundary; orphaned timers are impossible because
  // every wait is an awaited setTimeout that resolves naturally.
  useEffect(() => {
    if (morsePattern === 'off') {
      morseStopRef.current = true
      setFlashInvert(false)
      if (!flashlightEnabled) {
        void stopFlashlight()
      }
      return
    }
    if (flashScreen !== 'yes') {
      // Morse is screen-only; flashlight on/off is independent (solid hold, not Morse).
      morseStopRef.current = true
      setFlashInvert(false)
      return
    }
    morseStopRef.current = false
    setStatus(`MORSE ${morsePattern.toUpperCase()} ACTIVE`)
    void (async () => {
      while (!morseStopRef.current) {
        await flashPattern(morsePattern as Exclude<MorsePattern, 'off'>)
      }
    })()
    return () => {
      morseStopRef.current = true
      setFlashInvert(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morsePattern, flashScreen])

  // When flashlight is on without an active Morse pattern, hold the device LED on.
  useEffect(() => {
    if (!flashlightEnabled || morsePattern !== 'off') return
    void (async () => {
      const on = await setDeviceFlashlight(true)
      setFlashlightActive(on)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashlightEnabled, morsePattern])

  // CONTRACT-SENSITIVE (unmount cleanup ordering): the statement order
  // below is part of the lifecycle contract. Reordering can resurrect the
  // exact bugs the prior reliability passes fixed:
  //   1. abort()  → causes any in-flight rescue fetch to reject as
  //      AbortError. MUST run BEFORE mountedRef flip so the safeSetStatus
  //      gate in `launchRescuePacket` short-circuits the rejection path.
  //   2. abort ref = null → drops our pointer to the controller AFTER
  //      abort() so abort() always sees a live ref.
  //   3. mountedRef = false → blocks any post-async setState from any
  //      pending coroutine.
  //   4. cancelAnimationFrame → kills the hold-progress rAF that the
  //      arm/disarm flow doesn't always reach (unmount-mid-hold edge).
  //   5. stopAlarm() → tears down WebAudio nodes BEFORE morseStop so an
  //      operator-running alarm at the moment of unmount cuts cleanly.
  //   6. morseStopRef = true → halts the morse loop at its next step
  //      boundary; setting this AFTER stopAlarm is intentional so an
  //      in-flight morse step can complete its current await without
  //      racing the audio teardown.
  //   7. stopFlashlight() → fired-and-forgotten last; the camera track release
  //      is best-effort and must not block the synchronous cleanup chain.
  // DO NOT "simplify" this block.
  useEffect(() => {
    return () => {
      rescueFetchAbortRef.current?.abort()
      rescueFetchAbortRef.current = null
      mountedRef.current = false
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      stopAlarm()
      morseStopRef.current = true
      void stopFlashlight()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onArm = () => {
      setMode('armed')
      setHoldProgress(1)
      setStatus('SOS ARMED (VOICE)')
    }
    const onDisarm = () => {
      void disarmAll()
    }
    window.addEventListener('hud:sos-arm', onArm)
    window.addEventListener('hud:sos-disarm', onDisarm)
    return () => {
      window.removeEventListener('hud:sos-arm', onArm)
      window.removeEventListener('hud:sos-disarm', onDisarm)
    }
  }, [])

  useEffect(() => {
    const onVoiceMorse = (ev: Event) => {
      const custom = ev as CustomEvent<{ enabled?: boolean }>
      if (typeof custom.detail?.enabled !== 'boolean') return
      const enabled = custom.detail.enabled
      setFlashScreen(enabled ? 'yes' : 'no')
      // Preserve voice UX (channel-on → SOS flashes) without overwriting
      // a manual YES/NO selection: only auto-set/clear when the panel is
      // currently in a default 'off'/'sos' state.
      if (enabled) {
        setMorsePattern((prev) => (prev === 'off' ? 'sos' : prev))
      } else {
        setMorsePattern((prev) => (prev === 'sos' ? 'off' : prev))
      }
      setStatus(enabled ? 'MORSE SCREEN ENABLED' : 'MORSE SCREEN DISABLED')
    }
    const onVoiceFlashlight = async (ev: Event) => {
      const custom = ev as CustomEvent<{ enabled?: boolean }>
      if (typeof custom.detail?.enabled !== 'boolean') return
      const enabled = custom.detail.enabled
      setFlashlightEnabled(enabled)
      if (enabled) {
        const on = await setDeviceFlashlight(true)
        setFlashlightActive(on)
        setStatus(on ? 'FLASHLIGHT ON' : 'FLASHLIGHT ON (DEVICE UNSUPPORTED)')
      } else {
        await stopFlashlight()
        setStatus('FLASHLIGHT OFF')
      }
    }
    window.addEventListener('hud:sos-morse', onVoiceMorse)
    window.addEventListener('hud:sos-flashlight', onVoiceFlashlight)
    return () => {
      window.removeEventListener('hud:sos-morse', onVoiceMorse)
      window.removeEventListener('hud:sos-flashlight', onVoiceFlashlight)
    }
  }, [])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('hud:sos-flashlight-state', {
        detail: { enabled: flashlightEnabled },
      }),
    )
  }, [flashlightEnabled])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('hud:sos-morse-state', {
        detail: { enabled: flashScreen === 'yes' },
      }),
    )
  }, [flashScreen])

  const beginHold = () => {
    traceAction('sos_long_hold', 'handler_enter')
    if (!operationalReady) {
      setStatus('SOS BLOCKED — COMPLETE TACTICAL PROFILE IN PREFLIGHT')
      traceAction('sos_long_hold', 'guard_reject', { reason: 'profile_incomplete' })
      return
    }
    if (holding || isArmed) {
      traceAction('sos_long_hold', 'guard_reject', { reason: 'already_holding_or_armed' })
      return
    }
    holdStartRef.current = performance.now()
    setHolding(true)
    setStatus('HOLD TO ARM SOS...')
    const tick = (t: number) => {
      const elapsed = t - holdStartRef.current
      const frac = Math.min(1, elapsed / HOLD_MS)
      setHoldProgress(frac)
      if (frac >= 1) {
        setHolding(false)
        setHoldProgress(1)
        setMode('armed')
        setStatus('SOS ARMED')
        traceAction('sos_long_hold', 'state_result', { armed: true })
        emitHaptic('criticalAlert', 'sos.arm')
        return
      }
      rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)
  }

  const endHold = () => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (holding && holdProgress < 1) {
      setStatus('HOLD CANCELLED')
      traceAction('sos_long_hold', 'guard_reject', { reason: 'released_early' })
    }
    setHolding(false)
    setHoldProgress((v) => (v >= 1 ? 1 : 0))
  }

  const disarmAll = async () => {
    if (launchTimerRef.current) {
      window.clearInterval(launchTimerRef.current)
      launchTimerRef.current = null
    }
    launchSentRef.current = false
    setLaunchCountdown(null)
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setHolding(false)
    setMode('off')
    setHoldProgress(0)
    stopAlarm()
    setMorsePattern('off')
    morseStopRef.current = true
    setFlashInvert(false)
    setFlashScreen('no')
    setFlashlightEnabled(false)
    await stopFlashlight()
    setStatus('READY')
    traceAction('sos_disarm', 'state_result', { alarm: false, morse: 'off' })
  }

  const launchRescuePacket = async () => {
    traceAction('sos_dispatch', 'handler_enter')
    if (launchSentRef.current) {
      traceAction('sos_dispatch', 'guard_reject', { reason: 'already_sent_for_arm_window' })
      return
    }
    launchSentRef.current = true
    // Payload construction is centralized in the shared builder so SOS
    // and Deadman emit identically-shaped packets. Builder reads contacts
    // from Supabase and coordinates from existing GPS persistence.
    traceAction('sos_dispatch', 'async_start', { step: 'build_packet' })
    const packet = await buildRescuePacket('SOS')
    const contactCount = packet.contacts.length
    const endpoint = resolveRapidEndpoint()

    if (import.meta.env.DEV) {
      console.log('[rescue] SOS auto-launch (redacted)', rescuePacketDevLogSummary(packet))
    }
    // Local helper: every status write after an `await` checks the mount
    // flag. The rescue trigger (`launchSentRef`) is gated separately at
    // the top of this function and is intentionally NOT reset here —
    // unmount during an in-flight dispatch must not allow a duplicate
    // dispatch on remount within the same `isArmed` window.
    const safeSetStatus = (s: string) => {
      if (mountedRef.current) setStatus(s)
    }
    const eligibility = getRescueEligibility({
      contactCount,
      endpoint,
      profileOperational: operationalReady,
    })
    if (!eligibility.dispatchReady && eligibility.reason === 'profile_incomplete') {
      safeSetStatus('SOS BLOCKED — COMPLETE TACTICAL PROFILE IN PREFLIGHT')
      traceAction('sos_dispatch', 'guard_reject', { reason: 'profile_incomplete' })
      return
    }
    if (!eligibility.dispatchReady && eligibility.reason === 'no_contacts') {
      if (import.meta.env.DEV) {
        console.info('[HUD DEV] sos-fallback-reason', { reason: 'no_contacts', contactCount })
      }
      safeSetStatus('SOS AUTO-LAUNCH: NO CONTACTS FOUND')
      traceAction('sos_dispatch', 'guard_reject', { reason: 'no_contacts' })
      return
    }
    if (!eligibility.dispatchReady && eligibility.reason === 'no_endpoint') {
      if (import.meta.env.DEV) {
        console.info('[HUD DEV] sos-fallback-reason', { reason: 'no_endpoint', contactCount })
      }
      safeSetStatus(`SOS PACKET READY (${contactCount} CONTACTS) — NO ENDPOINT SET`)
      traceAction('sos_dispatch', 'guard_reject', { reason: 'no_endpoint', contactCount })
      return
    }
    const ac = new AbortController()
    rescueFetchAbortRef.current = ac
    try {
      const dispatchKeyKind = classifyRescueDispatchKey(
        ((import.meta as unknown as { env?: Record<string, string | undefined> }).env
          ?.VITE_SUPABASE_ANON_KEY ?? '') as string,
      )
      traceAction('sos_dispatch', 'async_start', {
        step: 'post_dispatch',
        contactCount,
        hasDispatchAuth: hasRescueDispatchAuth(),
        dispatchKeyKind,
        signed: Boolean(packet.signature),
      })
      logRescueDispatchTrace({
        triggerLabel: 'SOS',
        endpoint,
        triggerType: packet.triggerType,
        hasOperator: Boolean(packet.operator),
        signed: Boolean(packet.signature),
      })
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: buildRescueDispatchHeaders(),
        body: JSON.stringify(packet),
        signal: ac.signal,
      })
      if (res.ok) {
        safeSetStatus(`SOS SENT TO ${contactCount} CONTACTS`)
        traceAction('sos_dispatch', 'async_complete', { status: res.status, contactCount })
      } else {
        const fail = await parseRescueDispatchFailure(res, 'SOS')
        safeSetStatus(fail.operatorMessage)
        traceAction('sos_dispatch', 'failure', {
          reason: 'http_error',
          status: fail.status,
          code: fail.code,
        })
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === 'AbortError') return
      safeSetStatus('SOS SEND FAILED (NETWORK)')
      traceAction('sos_dispatch', 'failure', { reason: 'network_error' })
    } finally {
      if (rescueFetchAbortRef.current === ac) rescueFetchAbortRef.current = null
    }
  }

  useEffect(() => {
    if (!isArmed) {
      if (launchTimerRef.current) {
        window.clearInterval(launchTimerRef.current)
        launchTimerRef.current = null
      }
      launchSentRef.current = false
      setLaunchCountdown(null)
      return
    }
    // The SOS slide-hold path is now strictly a rescue-dispatch authorization.
    // It must NOT start the audible alarm — the alarm is operator-owned via
    // the "TEST AUDIBLE ALARM" button.
    // CONTRACT-SENSITIVE: resetting `launchSentRef` here is INTENTIONAL.
    // It re-opens the dispatch gate for THIS arm window. The previous
    // disarm cleanup (`!isArmed` branch above) already cleared it; this
    // line keeps the invariant explicit when the user re-arms after a
    // failed dispatch. See the ref's declaration block for full lifecycle.
    launchSentRef.current = false
    setLaunchCountdown(AUTO_LAUNCH_DELAY_S)
    // Capture the absolute deadline once. Tick + visibility-resume both
    // read it without drift.
    launchDeadlineRef.current = Date.now() + AUTO_LAUNCH_DELAY_S * 1000
    const launchTick = () => {
      const remainingSec = Math.max(0, Math.ceil((launchDeadlineRef.current - Date.now()) / 1000))
      setLaunchCountdown(remainingSec)
      if (remainingSec <= 0) {
        if (launchTimerRef.current) {
          window.clearInterval(launchTimerRef.current)
          launchTimerRef.current = null
        }
        void launchRescuePacket()
      }
    }
    launchTimerRef.current = window.setInterval(launchTick, 1000)
    // iOS Safari can fully pause setInterval on hidden tabs. Force one
    // immediate reconciliation when the tab returns so rescue dispatch
    // fires without waiting up to ~1s for the next throttled tick.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (launchTimerRef.current == null) return
      launchTick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (launchTimerRef.current) {
        window.clearInterval(launchTimerRef.current)
        launchTimerRef.current = null
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArmed])

  return (
    <>
      {flashScreen === 'yes' && morsePattern !== 'off' && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 99999,
            background: flashInvert ? 'rgba(255,255,255,0.96)' : 'transparent',
            transition: 'background 40ms linear',
            mixBlendMode: 'screen',
          }}
        />
      )}
      <HudPanel
        panelId="sos"
        title="SOS Arm"
        initialPos={{ x: 280, y: 590 }}
        initialWidth={260}
        accent={alarmColor}
      >
        <div
          style={{
            fontFamily: 'var(--font-ui, system-ui)',
            fontSize: fontMd,
            padding: panelPadding,
            maxHeight: 'calc(100vh - 160px)',
            overflowY: 'auto',
          }}
        >
          {!operationalReady && (
            <div
              style={{
                marginBottom: gapMd,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(255, 107, 135, 0.45)',
                background: 'rgba(48, 18, 22, 0.55)',
                color: '#ffd5dd',
                fontSize: fontSm,
                lineHeight: 1.35,
              }}
            >
              <strong>Setup incomplete</strong> — SOS is disabled until display name, reply-to email, and
              at least one valid emergency contact are saved in Preflight.
              {assessment.messages[0] ? ` ${assessment.messages[0]}` : ''}
            </div>
          )}
          <div
            style={{
              color: operationalReady ? '#ff9aac' : '#9ea7a0',
              marginBottom: gapMd,
              letterSpacing: '0.08em',
              fontSize: isMobile ? 16 : 13,
              fontWeight: 700,
            }}
          >
            {operationalReady ? 'SLIDE + HOLD 3 SECONDS TO ARM' : 'SOS DISABLED — COMPLETE PROFILE FIRST'}
          </div>
          <div
            style={{
              position: 'relative',
              height: trackHeight,
              borderRadius: trackHeight / 2,
              border: `2px solid ${isArmed ? '#ff6b87' : '#ff446699'}`,
              background: 'rgba(25, 5, 10, 0.65)',
              overflow: 'hidden',
              userSelect: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, rgba(255,68,102,0.35), rgba(255,68,102,0.78))',
                transition: holding ? 'none' : 'width 160ms ease',
              }}
            />
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation()
                beginHold()
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                endHold()
              }}
              onPointerLeave={endHold}
              onPointerCancel={endHold}
              style={{
                position: 'absolute',
                left: 4 + (progressPct / 100) * sliderTravel,
                top: Math.max(2, (trackHeight - knobSize) / 2),
                width: knobSize,
                height: knobSize,
                borderRadius: 999,
                border: '1px solid #ffd1db',
                background: '#ffe4ea',
                color: '#3a111a',
                fontWeight: 700,
                cursor: 'grab',
              }}
              aria-label="Hold three seconds to arm SOS"
            >
              SOS
            </button>
          </div>
          <div style={{ marginTop: gapMd, color: '#ffb5c2', fontSize: fontMd, fontWeight: 600 }}>{status}</div>
          {isArmed && launchCountdown != null && launchCountdown > 0 && (
            <div style={{ marginTop: gapSm, color: '#ffd3dd', fontSize: fontSm, letterSpacing: '0.06em' }}>
              AUTO LAUNCH TO CONTACTS IN {launchCountdown}s (DISARM TO CANCEL)
            </div>
          )}
          <div style={{ marginTop: gapMd, display: 'grid', gap: gapMd }}>
            {/*
              Dedicated Morse PATTERN selector. Each button is an independent
              ON/OFF toggle; clicking the active pattern turns it off, clicking
              another swaps to it (only one runs at a time). This system is
              completely separate from the SOS escalation/rescue path above.
            */}
            <div style={{ color: '#ffd5de', fontSize: fontMd, letterSpacing: '0.06em', fontWeight: 700 }}>
              MORSE PATTERN (VISUAL ONLY)
            </div>
            <div style={{ display: 'flex', gap: gapMd }}>
              {(['sos', 'yes', 'no'] as const).map((p) => {
                const active = morsePattern === p
                return (
                  <button
                    key={p}
                    type="button"
                    data-no-drag
                    onClick={(e) => {
                      e.stopPropagation()
                      setMorsePattern((prev) => (prev === p ? 'off' : p))
                    }}
                    style={{
                      flex: 1,
                      minHeight: safeMinPx,
                      minWidth: safeMinPx,
                      fontSize: fontMd,
                      borderRadius: 6,
                      border: active ? '1px solid #ff9fb3' : '1px solid #7a2a3a',
                      background: active ? 'rgba(255,68,102,0.32)' : 'rgba(60,8,18,0.45)',
                      color: '#ffd5de',
                      cursor: 'pointer',
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                    }}
                    aria-pressed={active}
                  >
                    FLASH {p.toUpperCase()}
                  </button>
                )
              })}
            </div>
            <div style={{ color: '#ffd5de', fontSize: fontMd, letterSpacing: '0.06em', fontWeight: 700 }}>
              MORSE SCREEN FLASH
            </div>
            <div style={{ display: 'flex', gap: gapLg }}>
              <button
                type="button"
                data-no-drag
                onClick={(e) => {
                  e.stopPropagation()
                  setFlashScreen('yes')
                }}
                style={{
                  flex: 1,
                  minHeight: safeMinPx,
                  minWidth: safeMinPx,
                  fontSize: fontMd,
                  borderRadius: 6,
                  border: flashScreen === 'yes' ? '1px solid #ff9fb3' : '1px solid #7a2a3a',
                  background: flashScreen === 'yes' ? 'rgba(255,68,102,0.28)' : 'rgba(60,8,18,0.45)',
                  color: '#ffd5de',
                  cursor: 'pointer',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                }}
              >
                YES
              </button>
              <button
                type="button"
                data-no-drag
                onClick={(e) => {
                  e.stopPropagation()
                  setFlashScreen('no')
                }}
                style={{
                  flex: 1,
                  minHeight: safeMinPx,
                  minWidth: safeMinPx,
                  fontSize: fontMd,
                  borderRadius: 6,
                  border: flashScreen === 'no' ? '1px solid #ff9fb3' : '1px solid #7a2a3a',
                  background: flashScreen === 'no' ? 'rgba(255,68,102,0.22)' : 'rgba(60,8,18,0.45)',
                  color: '#ffd5de',
                  cursor: 'pointer',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                }}
              >
                NO
              </button>
            </div>
            <div style={{ color: '#ffd5de', fontSize: fontMd, letterSpacing: '0.06em', marginTop: 4, fontWeight: 700 }}>
              FLASHLIGHT
            </div>
            <div style={{ display: 'flex', gap: gapLg }}>
              <button
                type="button"
                data-no-drag
                onClick={(e) => {
                  e.stopPropagation()
                  void (async () => {
                    setFlashlightEnabled(true)
                    const on = await setDeviceFlashlight(true)
                    setFlashlightActive(on)
                    setStatus(on ? 'FLASHLIGHT ON' : 'FLASHLIGHT ON (DEVICE UNSUPPORTED)')
                  })()
                }}
                style={{
                  flex: 1,
                  minHeight: safeMinPx,
                  minWidth: safeMinPx,
                  fontSize: fontMd,
                  borderRadius: 6,
                  border: flashlightEnabled ? '1px solid #ff9fb3' : '1px solid #7a2a3a',
                  background: flashlightEnabled ? 'rgba(255,68,102,0.28)' : 'rgba(60,8,18,0.45)',
                  color: '#ffd5de',
                  cursor: 'pointer',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                }}
                aria-pressed={flashlightEnabled}
              >
                ON
              </button>
              <button
                type="button"
                data-no-drag
                onClick={(e) => {
                  e.stopPropagation()
                  void (async () => {
                    setFlashlightEnabled(false)
                    await stopFlashlight()
                    setStatus('FLASHLIGHT OFF')
                  })()
                }}
                style={{
                  flex: 1,
                  minHeight: safeMinPx,
                  minWidth: safeMinPx,
                  fontSize: fontMd,
                  borderRadius: 6,
                  border: !flashlightEnabled ? '1px solid #ff9fb3' : '1px solid #7a2a3a',
                  background: !flashlightEnabled ? 'rgba(255,68,102,0.22)' : 'rgba(60,8,18,0.45)',
                  color: '#ffd5de',
                  cursor: 'pointer',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                }}
                aria-pressed={!flashlightEnabled}
              >
                OFF
              </button>
            </div>
            <button
              type="button"
              data-no-drag
              onClick={(e) => {
                e.stopPropagation()
                if (alarmActive) {
                  stopAlarm()
                } else {
                  startAlarm()
                }
              }}
              aria-pressed={alarmActive}
              style={{
                width: '100%',
                minHeight: tapMin,
                padding: '10px 12px',
                border: alarmActive ? '1px solid #ffd5de' : '1px solid #ff7b95',
                borderRadius: 4,
                background: alarmActive ? 'rgba(255,68,102,0.34)' : 'rgba(255,68,102,0.2)',
                color: '#ffd5de',
                fontWeight: 700,
                fontSize: fontSm,
                letterSpacing: '0.08em',
                cursor: 'pointer',
              }}
            >
              {alarmActive ? 'STOP AUDIBLE ALARM' : 'TEST AUDIBLE ALARM'}
            </button>
            <button
              type="button"
              data-no-drag
              onClick={(e) => {
                e.stopPropagation()
                updatePanel('preflight', { docked: false, minimized: false })
                raisePanel('preflight')
                setStatus('OPENING CONTACT CONFIG')
              }}
              style={{
                width: '100%',
                minHeight: tapMin,
                padding: '10px 12px',
                border: '1px solid rgba(125,255,138,0.42)',
                borderRadius: 4,
                background: 'rgba(125,255,138,0.12)',
                color: '#d8f8dd',
                fontWeight: 700,
                fontSize: fontSm,
                letterSpacing: '0.08em',
                cursor: 'pointer',
              }}
            >
              OPEN CONTACT CONFIG
            </button>
            <button
              type="button"
              data-no-drag
              onClick={(e) => {
                e.stopPropagation()
                void disarmAll()
              }}
              style={{
                width: '100%',
                minHeight: tapMin,
                padding: '10px 12px',
                border: '1px solid #7a2a3a',
                borderRadius: 4,
                background: 'rgba(60,8,18,0.5)',
                color: '#ffb8c6',
                fontWeight: 700,
                fontSize: fontSm,
                letterSpacing: '0.08em',
                cursor: 'pointer',
              }}
            >
              DISARM / STOP ALL
            </button>
          </div>
          <div style={{ marginTop: gapMd, color: '#c894a0', fontSize: fontSm }}>
            Flashlight: {flashlightActive ? 'ACTIVE' : flashlightEnabled ? 'ON' : 'OFF'}
          </div>
        </div>
      </HudPanel>
    </>
  )
}

