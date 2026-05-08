import React, { useEffect, useMemo, useRef, useState } from 'react'
import HudPanel from './HudPanel'
import { useGPS } from '../hooks/useGPS'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { emitHaptic } from '../runtime/haptics'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { buildRescuePacket, rescuePacketDevLogSummary } from '../lib/rescue/buildRescuePacket'
import { getRescueEligibility } from '../lib/rescue/eligibility'
import { traceAction } from '../runtime/actionTrace'
import { openContactConfig } from './openContactConfig'
import {
  touchFontSm as touchFontSmFn,
  touchFontMd as touchFontMdFn,
  touchGapLg as touchGapLgFn,
  touchGapMd as touchGapMdFn,
  touchGapSm as touchGapSmFn,
  touchMinTarget as touchMinTargetFn,
} from './tokens'

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

// CONTRACT-SENSITIVE: dispatch endpoint resolver. The fallback order
// (VITE_RESCUE_EMAIL_URL → VITE_RAPID_ENDPOINT_URL → localStorage
// `heartbeatFnUrl`) is part of the operator contract — changing it can
// silently misroute live SOS dispatches. Mirror any change in
// `DeadManPanel.tsx::resolveRapidEndpoint` to keep both paths aligned.
function resolveRapidEndpoint(): string {
  const rescue = ((import.meta as any).env?.VITE_RESCUE_EMAIL_URL as string | undefined)?.trim()
  if (rescue) return rescue
  const env = ((import.meta as any).env?.VITE_RAPID_ENDPOINT_URL as string | undefined)?.trim()
  if (env) return env
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      const value = localStorage.getItem(key)
      if (!value) continue
      try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed.heartbeatFnUrl === 'string' && parsed.heartbeatFnUrl.trim()) {
          return parsed.heartbeatFnUrl.trim()
        }
      } catch {
        // noop
      }
    }
  } catch {
    // noop
  }
  return ''
}

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
  const { panels, raisePanel, updatePanel } = useCockpit()
  const [holding, setHolding] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [mode, setMode] = useState<AlarmMode>('off')
  const [flashScreen, setFlashScreen] = useState<'yes' | 'no'>('no')
  const [flashTorch, setFlashTorch] = useState<'yes' | 'no'>('no')
  const [morsePattern, setMorsePattern] = useState<MorsePattern>('off')
  const [status, setStatus] = useState('READY')
  const [launchCountdown, setLaunchCountdown] = useState<number | null>(null)
  const [flashInvert, setFlashInvert] = useState(false)
  const [torchActive, setTorchActive] = useState(false)
  const [flashlightSupport, setFlashlightSupport] = useState<'unknown' | 'supported' | 'unsupported'>('unknown')
  const [flashlightPermission, setFlashlightPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
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
  const torchStreamRef = useRef<MediaStream | null>(null)
  const torchTrackRef = useRef<MediaStreamTrack | null>(null)
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
    try {
      gainRef.current?.gain.setValueAtTime(0.0001, audioCtxRef.current?.currentTime ?? 0)
      oscRef.current?.stop()
      oscHiRef.current?.stop()
      oscRef.current?.disconnect()
      oscHiRef.current?.disconnect()
      gainRef.current?.disconnect()
      compRef.current?.disconnect()
    } catch {
      // noop
    }
    oscRef.current = null
    oscHiRef.current = null
    gainRef.current = null
    compRef.current = null
    setAlarmActive(false)
    setStatus('ALARM OFF')
  }

  const ensureTorchTrack = async () => {
    try {
      if (torchTrackRef.current) return torchTrackRef.current
      if (!navigator.mediaDevices?.getUserMedia) {
        setFlashlightSupport('unsupported')
        console.log('[FLASHLIGHT]', {
          supported: false,
          permission: flashlightPermission,
          active: false,
          device: navigator.userAgent,
        })
        return null
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      const track = stream.getVideoTracks()[0]
      if (!track) return null
      setFlashlightPermission('granted')
      torchStreamRef.current = stream
      torchTrackRef.current = track
      return track
    } catch {
      setFlashlightPermission('denied')
      return null
    }
  }

  const setTorch = async (on: boolean) => {
    try {
      const track = await ensureTorchTrack()
      if (!track) return false
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
      if (!caps?.torch) {
        setFlashlightSupport('unsupported')
        console.log('[FLASHLIGHT]', {
          supported: false,
          permission: flashlightPermission,
          active: false,
          device: navigator.userAgent,
        })
        return false
      }
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      setFlashlightSupport('supported')
      console.log('[FLASHLIGHT]', {
        supported: true,
        permission: flashlightPermission === 'unknown' ? 'granted' : flashlightPermission,
        active: on,
        device: navigator.userAgent,
      })
      return true
    } catch {
      setFlashlightSupport('unsupported')
      return false
    }
  }

  const stopTorch = async () => {
    try {
      if (torchTrackRef.current) {
        const caps = torchTrackRef.current.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
        if (caps?.torch) {
          await torchTrackRef.current.applyConstraints({
            advanced: [{ torch: false } as MediaTrackConstraintSet],
          })
        }
      }
    } catch {
      // noop
    }
    try {
      torchTrackRef.current?.stop()
    } catch {
      // noop
    }
    try {
      torchStreamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {
      // noop
    }
    torchTrackRef.current = null
    torchStreamRef.current = null
    setTorchActive(false)
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
      if (flashTorch === 'yes') {
        if (step.on) {
          const on = await setTorch(true)
          setTorchActive(on)
        } else {
          await setTorch(false)
          setTorchActive(false)
        }
      }
      await sleep(step.units * MORSE_UNIT_MS)
    }
  }

  // SOS-side cleanup on disarm. Releases the camera/torch track defensively.
  // The audible alarm is intentionally NOT touched here — alarm lifecycle
  // is owned by the operator (TEST AUDIBLE ALARM button + unmount cleanup).
  // Morse cleanup is driven by disarmAll() setting morsePattern='off'.
  useEffect(() => {
    if (isArmed) return
    void stopTorch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArmed])

  // Independent Morse signaling effect. Runs purely on morsePattern + the
  // two output channels. No dependency on isArmed, no rescue calls, no
  // edge functions. Cleanup sets morseStopRef=true so any in-flight pattern
  // exits at the next step boundary; orphaned timers are impossible because
  // every wait is an awaited setTimeout that resolves naturally.
  useEffect(() => {
    if (morsePattern === 'off') {
      morseStopRef.current = true
      setFlashInvert(false)
      // Pattern fully stopped → release the camera/torch track so the
      // OS camera indicator clears. Track is re-acquired on next start.
      void stopTorch()
      return
    }
    if (flashScreen !== 'yes' && flashTorch !== 'yes') {
      // pattern selected but no output channel — sit idle, don't loop
      morseStopRef.current = true
      setFlashInvert(false)
      void stopTorch()
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
  }, [morsePattern, flashScreen, flashTorch])

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
  //   7. stopTorch() → fired-and-forgotten last; the camera track release
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
      void stopTorch()
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
    if (!import.meta.env.DEV) return
    const onHarnessOpen = () => {
      openContactConfig({
        source: 'sos',
        panels,
        updatePanel,
        raisePanel,
      })
    }
    window.addEventListener('hud:test-open-contact-sos', onHarnessOpen)
    return () => window.removeEventListener('hud:test-open-contact-sos', onHarnessOpen)
  }, [panels, updatePanel, raisePanel])

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
    const onVoiceTorch = (ev: Event) => {
      const custom = ev as CustomEvent<{ enabled?: boolean }>
      if (typeof custom.detail?.enabled !== 'boolean') return
      setFlashTorch(custom.detail.enabled ? 'yes' : 'no')
      setStatus(custom.detail.enabled ? 'MORSE FLASHLIGHT ENABLED' : 'MORSE FLASHLIGHT DISABLED')
    }
    window.addEventListener('hud:sos-morse', onVoiceMorse)
    window.addEventListener('hud:sos-torch', onVoiceTorch)
    return () => {
      window.removeEventListener('hud:sos-morse', onVoiceMorse)
      window.removeEventListener('hud:sos-torch', onVoiceTorch)
    }
  }, [])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('hud:sos-torch-state', {
        detail: { enabled: flashTorch === 'yes' },
      }),
    )
  }, [flashTorch])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('hud:flashlight-capability', {
        detail: {
          supported: flashlightSupport === 'supported',
          supportState: flashlightSupport,
          permission: flashlightPermission,
          active: torchActive,
          device: navigator.userAgent,
        },
      }),
    )
  }, [flashlightSupport, flashlightPermission, torchActive])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('hud:sos-morse-state', {
        detail: { enabled: flashScreen === 'yes' },
      }),
    )
  }, [flashScreen])

  const beginHold = () => {
    traceAction('sos_long_hold', 'handler_enter')
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
    setStatus('READY')
    // Audible alarm is operator-owned and intentionally NOT stopped here —
    // the rescue-dispatch path no longer starts it, so disarm has nothing
    // to stop. Morse pattern is still cleared for the "STOP ALL" UX.
    setMorsePattern('off')
    morseStopRef.current = true
    setFlashInvert(false)
    await stopTorch()
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
    const eligibility = getRescueEligibility({ contactCount, endpoint })
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
      traceAction('sos_dispatch', 'async_start', { step: 'post_dispatch', contactCount })
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(packet),
        signal: ac.signal,
      })
      if (res.ok) {
        safeSetStatus(`SOS SENT TO ${contactCount} CONTACTS`)
        traceAction('sos_dispatch', 'async_complete', { status: res.status, contactCount })
      } else {
        safeSetStatus(`SOS SEND FAILED (${res.status})`)
        traceAction('sos_dispatch', 'failure', { reason: 'http_error', status: res.status })
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
          <div
            style={{
              color: '#ff9aac',
              marginBottom: gapMd,
              letterSpacing: '0.08em',
              fontSize: isMobile ? 16 : 13,
              fontWeight: 700,
            }}
          >
            SLIDE + HOLD 3 SECONDS TO ARM
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
              MORSE FLASHLIGHT FLASH
            </div>
            <div style={{ display: 'flex', gap: gapLg }}>
              <button
                type="button"
                data-no-drag
                onClick={(e) => {
                  e.stopPropagation()
                  setFlashTorch('yes')
                }}
                style={{
                  flex: 1,
                  minHeight: safeMinPx,
                  minWidth: safeMinPx,
                  fontSize: fontMd,
                  borderRadius: 6,
                  border: flashTorch === 'yes' ? '1px solid #ff9fb3' : '1px solid #7a2a3a',
                  background: flashTorch === 'yes' ? 'rgba(255,68,102,0.28)' : 'rgba(60,8,18,0.45)',
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
                  setFlashTorch('no')
                }}
                style={{
                  flex: 1,
                  minHeight: safeMinPx,
                  minWidth: safeMinPx,
                  fontSize: fontMd,
                  borderRadius: 6,
                  border: flashTorch === 'no' ? '1px solid #ff9fb3' : '1px solid #7a2a3a',
                  background: flashTorch === 'no' ? 'rgba(255,68,102,0.22)' : 'rgba(60,8,18,0.45)',
                  color: '#ffd5de',
                  cursor: 'pointer',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                }}
              >
                NO
              </button>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                // Operator-owned alarm toggle. Reads alarmActive (the
                // alarm subsystem's own state), not isArmed (rescue
                // dispatch state) — the two are now decoupled.
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
              TEST AUDIBLE ALARM
            </button>
            <button
              type="button"
              data-no-drag
              onClick={(e) => {
                e.stopPropagation()
                openContactConfig({
                  source: 'sos',
                  panels,
                  updatePanel,
                  raisePanel,
                })
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
            Flashlight: {torchActive ? 'ACTIVE' : flashTorch === 'yes' ? 'REQUESTED' : 'OFF'}
          </div>
        </div>
      </HudPanel>
    </>
  )
}

