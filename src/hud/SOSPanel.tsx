import React, { useEffect, useMemo, useRef, useState } from 'react'
import HudPanel from './HudPanel'
import { useGPS } from '../hooks/useGPS'
import { useAppContext } from '../context/AppContext'

const HOLD_MS = 3000
const ALARM_PULSE_MS = 420
const MORSE_UNIT_MS = 180
const AUTO_LAUNCH_DELAY_S = 5

type AlarmMode = 'off' | 'armed'

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

type RescueContact = {
  id: string
  name?: string
  email: string
  phone?: string
  relationship?: string
}

function getSavedContacts(): RescueContact[] {
  try {
    const raw =
      localStorage.getItem('titanium_saved_contacts') ??
      localStorage.getItem('emergency_contacts_saved') ??
      '[]'
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((c: any): RescueContact | null => {
        const email = typeof c?.email === 'string' ? c.email.trim() : ''
        if (!email) return null
        return {
          id: String(c.id ?? email),
          name: typeof c?.name === 'string' ? c.name : undefined,
          email,
          phone: typeof c?.phone === 'string' ? c.phone : undefined,
          relationship: typeof c?.relationship === 'string' ? c.relationship : undefined,
        }
      })
      .filter(Boolean) as RescueContact[]
  } catch {
    return []
  }
}

function getRouteContactIds(): string[] {
  try {
    const raw =
      localStorage.getItem('titanium_route_contacts') ??
      localStorage.getItem('current_route_contacts') ??
      '[]'
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((v: any) => (typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

function resolveRapidEndpoint(): string {
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
  const { state } = useAppContext()
  const gps = useGPS()
  const [holding, setHolding] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [mode, setMode] = useState<AlarmMode>('off')
  const [flashScreen, setFlashScreen] = useState<'yes' | 'no'>('no')
  const [flashTorch, setFlashTorch] = useState<'yes' | 'no'>('no')
  const [status, setStatus] = useState('READY')
  const [launchCountdown, setLaunchCountdown] = useState<number | null>(null)
  const [flashInvert, setFlashInvert] = useState(false)
  const [torchActive, setTorchActive] = useState(false)

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
  const launchSentRef = useRef(false)

  const isArmed = mode === 'armed'
  const progressPct = Math.max(0, Math.min(100, holdProgress * 100))
  const alarmColor = useMemo(() => (isArmed ? '#ff4466' : '#ff1744'), [isArmed])

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
    setStatus('ALARM OFF')
  }

  const ensureTorchTrack = async () => {
    try {
      if (torchTrackRef.current) return torchTrackRef.current
      if (!navigator.mediaDevices?.getUserMedia) return null
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      const track = stream.getVideoTracks()[0]
      if (!track) return null
      torchStreamRef.current = stream
      torchTrackRef.current = track
      return track
    } catch {
      return null
    }
  }

  const setTorch = async (on: boolean) => {
    try {
      const track = await ensureTorchTrack()
      if (!track) return false
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
      if (!caps?.torch) return false
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      return true
    } catch {
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
      setStatus('AUDIBLE ALARM ACTIVE')
    } catch {
      setStatus('ALARM FAILED (AUDIO BLOCKED)')
    }
  }

  const flashPattern = async () => {
    // SOS = ... --- ...
    const dots = [1, 1, 1, 3, 3, 3, 1, 1, 1]
    for (const units of dots) {
      if (morseStopRef.current) return
      setFlashInvert(true)
      if (flashTorch === 'yes') {
        const on = await setTorch(true)
        setTorchActive(on)
      }
      await sleep(units * MORSE_UNIT_MS)
      if (flashTorch === 'yes') {
        await setTorch(false)
        setTorchActive(false)
      }
      setFlashInvert(false)
      await sleep(MORSE_UNIT_MS)
    }
    await sleep(MORSE_UNIT_MS * 2)
  }

  useEffect(() => {
    if (!isArmed) {
      stopAlarm()
      morseStopRef.current = true
      setFlashInvert(false)
      void stopTorch()
      return
    }
    if (flashScreen === 'yes' || flashTorch === 'yes') {
      morseStopRef.current = false
      setStatus('MORSE SOS ACTIVE')
      void (async () => {
        while (!morseStopRef.current) {
          await flashPattern()
        }
      })()
    } else {
      morseStopRef.current = true
      setFlashInvert(false)
    }
    return () => {
      morseStopRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArmed, flashScreen, flashTorch])

  useEffect(() => {
    return () => {
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
    const onVoiceMorse = (ev: Event) => {
      const custom = ev as CustomEvent<{ enabled?: boolean }>
      if (typeof custom.detail?.enabled !== 'boolean') return
      setFlashScreen(custom.detail.enabled ? 'yes' : 'no')
      setStatus(custom.detail.enabled ? 'MORSE SCREEN ENABLED' : 'MORSE SCREEN DISABLED')
    }
    const onVoiceTorch = (ev: Event) => {
      const custom = ev as CustomEvent<{ enabled?: boolean }>
      if (typeof custom.detail?.enabled !== 'boolean') return
      setFlashTorch(custom.detail.enabled ? 'yes' : 'no')
      setStatus(custom.detail.enabled ? 'MORSE TORCH ENABLED' : 'MORSE TORCH DISABLED')
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
      new CustomEvent('hud:sos-morse-state', {
        detail: { enabled: flashScreen === 'yes' },
      }),
    )
  }, [flashScreen])

  const beginHold = () => {
    if (holding || isArmed) return
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
        if (navigator.vibrate) navigator.vibrate([120, 90, 160])
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
    stopAlarm()
    morseStopRef.current = true
    setFlashInvert(false)
    await stopTorch()
  }

  const launchRescuePacket = async () => {
    if (launchSentRef.current) return
    launchSentRef.current = true
    const saved = getSavedContacts()
    const routeIds = new Set(getRouteContactIds())
    const selected = saved.filter((c) => routeIds.has(c.id))
    const contacts = selected.length ? selected : saved
    const payload = {
      type: 'trigger_rescue',
      trigger_source: 'sos_panel_auto',
      timestamp: new Date().toISOString(),
      location: { lat: gps.lat, lon: gps.lng, accuracy_m: gps.accuracy },
      route: state.waypoints.map((w) => ({
        id: w.id,
        lat: w.lat,
        lon: w.lng,
        label: w.label,
        type: w.type,
      })),
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name ?? null,
        email: c.email,
        phone: c.phone ?? null,
        relationship: c.relationship ?? null,
      })),
    }

    if (import.meta.env.DEV) {
      console.log('🚨 SOS auto-launch rescue packet', payload)
    }
    if (!contacts.length) {
      setStatus('SOS AUTO-LAUNCH: NO CONTACTS FOUND')
      return
    }
    const endpoint = resolveRapidEndpoint()
    if (!endpoint) {
      setStatus(`SOS PACKET READY (${contacts.length} CONTACTS) — NO ENDPOINT SET`)
      return
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) setStatus(`SOS SENT TO ${contacts.length} CONTACTS`)
      else setStatus(`SOS SEND FAILED (${res.status})`)
    } catch {
      setStatus('SOS SEND FAILED (NETWORK)')
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
    startAlarm()
    launchSentRef.current = false
    setLaunchCountdown(AUTO_LAUNCH_DELAY_S)
    launchTimerRef.current = window.setInterval(() => {
      setLaunchCountdown((prev) => {
        if (prev == null) return null
        if (prev <= 1) {
          if (launchTimerRef.current) {
            window.clearInterval(launchTimerRef.current)
            launchTimerRef.current = null
          }
          void launchRescuePacket()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (launchTimerRef.current) {
        window.clearInterval(launchTimerRef.current)
        launchTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArmed])

  return (
    <>
      {flashScreen === 'yes' && isArmed && (
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
        <div style={{ fontFamily: 'var(--font-ui, system-ui)', fontSize: 11 }}>
          <div style={{ color: '#ff9aac', marginBottom: 8, letterSpacing: '0.08em' }}>
            SLIDE + HOLD 3 SECONDS TO ARM
          </div>
          <div
            style={{
              position: 'relative',
              height: 48,
              borderRadius: 24,
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
                left: 4 + (progressPct / 100) * (220 - 40),
                top: 4,
                width: 40,
                height: 40,
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
          <div style={{ marginTop: 8, color: '#ffb5c2' }}>{status}</div>
          {isArmed && launchCountdown != null && launchCountdown > 0 && (
            <div style={{ marginTop: 6, color: '#ffd3dd', fontSize: 10, letterSpacing: '0.06em' }}>
              AUTO LAUNCH TO CONTACTS IN {launchCountdown}s (DISARM TO CANCEL)
            </div>
          )}
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            <div style={{ color: '#ffd5de', fontSize: 11, letterSpacing: '0.06em' }}>
              MORSE SCREEN FLASH
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                data-no-drag
                onClick={(e) => {
                  e.stopPropagation()
                  setFlashScreen('yes')
                }}
                style={{
                  flex: 1,
                  minHeight: 34,
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
                  minHeight: 34,
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
            <div style={{ color: '#ffd5de', fontSize: 11, letterSpacing: '0.06em', marginTop: 4 }}>
              MORSE TORCH FLASH
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                data-no-drag
                onClick={(e) => {
                  e.stopPropagation()
                  setFlashTorch('yes')
                }}
                style={{
                  flex: 1,
                  minHeight: 34,
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
                  minHeight: 34,
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
                if (isArmed) {
                  stopAlarm()
                } else {
                  startAlarm()
                }
              }}
              style={{
                width: '100%',
                padding: '7px 8px',
                border: '1px solid #ff7b95',
                borderRadius: 4,
                background: 'rgba(255,68,102,0.2)',
                color: '#ffd5de',
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: 'pointer',
              }}
            >
              TEST AUDIBLE ALARM
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void disarmAll()
              }}
              style={{
                width: '100%',
                padding: '7px 8px',
                border: '1px solid #7a2a3a',
                borderRadius: 4,
                background: 'rgba(60,8,18,0.5)',
                color: '#ffb8c6',
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: 'pointer',
              }}
            >
              DISARM / STOP ALL
            </button>
          </div>
          <div style={{ marginTop: 8, color: '#c894a0', fontSize: 10 }}>
            Torch: {torchActive ? 'ACTIVE' : flashTorch === 'yes' ? 'REQUESTED' : 'OFF'}
          </div>
        </div>
      </HudPanel>
    </>
  )
}

