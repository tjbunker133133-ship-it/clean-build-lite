import { useCallback, useEffect, useMemo, useState } from 'react'
import HudPanel from './HudPanel'
import { useMissionSync } from '../context/MissionSyncContext'
import {
  readMissionBundleFromClipboard,
  shareBundleResultMessage,
  shareMissionBundle,
} from '../lib/missionSync/shareBundle'
import { formatJoinCode, isValidJoinCodeInput } from '../lib/missionSync/joinCode'
import { filterTeammatePresence } from '../lib/missionSync/presence'
import { missionPacketToQrDataUrl, scanMissionPacketFromCamera } from '../lib/missionSync/qr'
import { isMissionTurnConfigured } from '../lib/missionSync/turnConfig'
import { FIELD_WALK_WATCHER_STEPS, fieldWalkWatcherSummary } from '../lib/missionSync/fieldTestGuide'
import { formatPresenceAge, monitorTransportLabel } from '../lib/missionSync/monitorUx'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchGapMd, touchGapSm, touchMinTarget } from './tokens'

function btnStyle(primary = false, danger = false): React.CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: 8,
    border: danger
      ? '1px solid rgba(248, 113, 113, 0.55)'
      : primary
        ? '1px solid rgba(94, 234, 212, 0.55)'
        : '1px solid #334155',
    background: danger
      ? 'rgba(127, 29, 29, 0.35)'
      : primary
        ? 'rgba(4, 48, 42, 0.85)'
        : 'rgba(15, 23, 42, 0.75)',
    color: danger ? '#fecaca' : primary ? '#a7f3d0' : '#cbd5e1',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: touchMinTarget(false),
    letterSpacing: '0.04em',
  }
}

function StepCard({
  step,
  title,
  children,
  active,
  done,
}: {
  step: number
  title: string
  children: React.ReactNode
  active?: boolean
  done?: boolean
}) {
  return (
    <div
      style={{
        padding: '12px 12px',
        borderRadius: 10,
        border: active
          ? '1px solid rgba(94, 234, 212, 0.45)'
          : done
            ? '1px solid rgba(74, 222, 128, 0.35)'
            : '1px solid #334155',
        background: active ? 'rgba(4, 48, 42, 0.45)' : 'rgba(15, 23, 42, 0.55)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 800,
            background: done ? 'rgba(74, 222, 128, 0.25)' : 'rgba(94, 234, 212, 0.15)',
            color: done ? '#86efac' : '#5eead4',
          }}
        >
          {done ? '✓' : step}
        </span>
        <strong style={{ color: '#e2e8f0', letterSpacing: '0.06em', fontSize: 12 }}>{title}</strong>
      </div>
      {children}
    </div>
  )
}

export default function MissionLinkPanel() {
  const sync = useMissionSync()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const [missionNameInput, setMissionNameInput] = useState(sync.missionName)
  const [pasteHost, setPasteHost] = useState('')
  const [pasteAnswer, setPasteAnswer] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [burstText, setBurstText] = useState('')
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [pasteMonitor, setPasteMonitor] = useState('')
  const [monitorMissionId, setMonitorMissionId] = useState('')
  const [monitorToken, setMonitorToken] = useState('')
  const [pasteObserverAnswer, setPasteObserverAnswer] = useState('')
  const [lanSearching, setLanSearching] = useState(false)
  const [linkHelp, setLinkHelp] = useState<string | null>(null)

  const fieldPeers = useMemo(
    () => sync.peers.filter((p) => p.linkRole === 'member'),
    [sync.peers],
  )
  const meshPeerCount = fieldPeers.length
  const monitorPeers = useMemo(
    () => sync.peers.filter((p) => p.linkRole === 'observer'),
    [sync.peers],
  )
  const linked = sync.peers.length > 0
  const fieldLinked = fieldPeers.length > 0
  const inMission = sync.role !== 'idle'
  const activeEncoded = sync.pendingOfferEncoded ?? sync.pendingAnswerEncoded
  const isObserver = sync.role === 'observer'
  const isFieldMember = sync.role === 'member'
  const lanReady = sync.nativeLink.available
  const codeJoinReady = sync.joinCodeSignalingAvailable || lanReady

  const phaseLabel = useMemo(() => {
    if (isObserver) {
      const transport =
        sync.monitorLive && sync.monitorTransport !== 'idle'
          ? ` · ${monitorTransportLabel(sync.monitorTransport)}`
          : ''
      if (sync.monitorLive) return `Watching ${sync.monitorTargetCallsign}${transport}`
      if (sync.phase === 'awaiting-host-answer') return 'Finishing secure link…'
      if (sync.phase === 'connecting') return 'Waiting for field lead…'
      return 'Monitor mode — read-only'
    }
    if (sync.phase === 'connected') {
      const obs = sync.observerCount > 0 ? ` · ${sync.observerCount} observer(s)` : ''
      return `Linked · ${sync.peers.filter((p) => p.linkRole === 'member').length} teammate(s)${obs}`
    }
    if (sync.phase === 'awaiting-joiner') return 'Waiting for teammate to join'
    if (sync.phase === 'awaiting-host-answer') return 'Connecting to mission host…'
    if (sync.phase === 'connecting') return 'Joining mission…'
    if (inMission) return 'Mission active — not linked yet'
    return 'Not in a mission'
  }, [sync.phase, sync.peers, sync.observerCount, sync.missionName, sync.monitorLive, sync.monitorTransport, sync.monitorTargetCallsign, inMission, isObserver])

  useEffect(() => {
    setMissionNameInput(sync.missionName)
  }, [sync.missionName])

  const qrEncoded =
    activeEncoded ??
    (sync.pendingObserverOfferFitsQr ? sync.pendingObserverOfferEncoded : null)

  useEffect(() => {
    let cancelled = false
    const enc = qrEncoded
    const fits =
      enc === activeEncoded
        ? sync.pendingOfferFitsQr || sync.pendingAnswerFitsQr
        : sync.pendingObserverOfferFitsQr
    if (!enc || !fits) {
      setQrUrl(null)
      return
    }
    void missionPacketToQrDataUrl(enc).then((url) => {
      if (!cancelled) setQrUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [
    qrEncoded,
    activeEncoded,
    sync.pendingOfferFitsQr,
    sync.pendingAnswerFitsQr,
    sync.pendingObserverOfferFitsQr,
    sync.pendingObserverOfferEncoded,
  ])

  useEffect(() => {
    if (lanSearching && sync.phase === 'connected') setLanSearching(false)
  }, [lanSearching, sync.phase])

  const shareBundle = useCallback(
    async (
      text: string | null,
      label: string,
      kind: 'join' | 'answer' | 'monitor' | 'invite' = 'join',
    ) => {
      if (!text?.trim()) {
        setLinkHelp('Nothing to share yet — start a mission or tap Prepare link for next teammate.')
        return
      }
      const result = await shareMissionBundle(text, {
        title: label,
        alsoCopy: false,
        filename: label.includes('Answer') ? 'signal-one-mission-answer.txt' : 'signal-one-mission-join.txt',
      })
      setLinkHelp(shareBundleResultMessage(result, kind))
      if (result === 'shared') sync.dismissNotice()
    },
    [sync],
  )

  const tryClipboardIntoBox = useCallback(
    async (target: 'host' | 'answer') => {
      const raw = await readMissionBundleFromClipboard()
      if (!raw) {
        setLinkHelp(
          'Paste manually: long-press the text box above, tap Paste, then tap the green Join/Complete button. (We do not read your clipboard without that.)',
        )
        return
      }
      if (target === 'host') {
        setPasteHost(raw)
        setLinkHelp('Bundle pasted — tap Join from bundle.')
      } else {
        setPasteAnswer(raw)
        setLinkHelp('Answer pasted — tap Complete link.')
      }
    },
    [],
  )

  const runScan = useCallback(
    async (target: 'host-offer' | 'host-answer') => {
      setScanning(true)
      try {
        const hit = await scanMissionPacketFromCamera()
        if (!hit?.raw) return
        if (target === 'host-offer') {
          await sync.startJoinMission(hit.raw)
        } else {
          await sync.applyJoinerAnswer(hit.raw)
        }
      } finally {
        setScanning(false)
      }
    },
    [sync],
  )

  const runLanJoin = useCallback(async () => {
    setLanSearching(true)
    try {
      await sync.discoverMissionOnLan(joinCodeInput)
    } finally {
      window.setTimeout(() => setLanSearching(false), 12_000)
    }
  }, [sync, joinCodeInput])

  const joinCodePreview = isValidJoinCodeInput(joinCodeInput)
    ? formatJoinCode(joinCodeInput)
    : null

  return (
    <HudPanel panelId="missionLink" title="Mission Link" initialPos={{ x: 16, y: 420 }} initialWidth={360}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapMd(isMobile), fontSize: fontSm }}>
        {!sync.supported ? (
          <p style={{ color: '#fbbf24', margin: 0, lineHeight: 1.45 }}>
            Mission Link needs a modern browser (Chrome, Edge, or the Android field app). Safari on
            iPhone can join via paste — sharing uses the text boxes below.
          </p>
        ) : null}

        {!inMission ? (
          <div
            style={{
              display: 'grid',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(94, 234, 212, 0.35)',
              background: 'rgba(4, 48, 42, 0.35)',
            }}
          >
            <div style={{ color: '#a7f3d0', fontWeight: 800, fontSize: 12, letterSpacing: '0.08em' }}>
              QUICK START
            </div>
            <button
              type="button"
              style={{ ...btnStyle(true), width: '100%' }}
              disabled={!sync.supported}
              onClick={() => void sync.startMission(missionNameInput)}
            >
              1 · Start field mission (host)
            </button>
            <p style={{ color: '#64748b', margin: 0, fontSize: '0.88em', lineHeight: 1.4 }}>
              Same Wi‑Fi hotspot for everyone. Host shares the mission code or join link; teammates
              never need cell data for the link text.
            </p>
          </div>
        ) : null}

        <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
          Offline team mesh on Wi‑Fi hotspot. The <strong style={{ color: '#cbd5e1' }}>Android field app</strong>{' '}
          (Capacitor — already in this project) adds auto Wi‑Fi link. Any device can use{' '}
          <strong style={{ color: '#cbd5e1' }}>Share join link</strong> for Bluetooth, SMS, or copy — works with no
          cell data once the text reaches the other tablet. Same name on two devices is fine.
        </p>
        <p style={{ color: '#64748b', margin: 0, fontSize: '0.9em' }}>
          Link search: <strong style={{ color: '#94a3b8' }}>{sync.signalingLabel}</strong>
          {sync.nativeLink.discoveryMethod === 'android-nsd-nearby'
            ? ' · Wi‑Fi first, then Bluetooth/Nearby (no pairing), mesh uses best network path'
            : lanReady
              ? ' · Rebuild APK if Bluetooth/Nearby missing'
              : ' · Browser: Share / QR / paste'}
        </p>

        <div style={{ color: '#5eead4', fontWeight: 700, fontSize: 13 }}>{phaseLabel}</div>

        {isFieldMember && inMission ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(125, 211, 252, 0.35)',
              background: 'rgba(15, 35, 55, 0.45)',
              lineHeight: 1.45,
              fontSize: '0.9em',
            }}
          >
            <div style={{ color: '#bae6fd', fontWeight: 800, fontSize: 11, letterSpacing: '0.08em' }}>
              WALK + HOME WATCHER
            </div>
            <ol style={{ margin: '8px 0 0', paddingLeft: 18, color: '#94a3b8' }}>
              {FIELD_WALK_WATCHER_STEPS.map((step) => (
                <li key={step} style={{ marginBottom: 4 }}>
                  {step}
                </li>
              ))}
            </ol>
            <p style={{ margin: '8px 0 0', color: '#7dd3fc', fontWeight: 700 }}>
              {fieldWalkWatcherSummary(sync.observerCount, meshPeerCount)}
            </p>
          </div>
        ) : null}

        {inMission ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: 'rgba(15, 23, 42, 0.6)',
              color: '#94a3b8',
              lineHeight: 1.5,
              fontSize: '0.92em',
            }}
          >
            <strong style={{ color: '#cbd5e1' }}>Team sync (offline + online)</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>Waypoints, arrivals/archived, trail-follow mode</li>
              <li>Live teammate GPS on the map</li>
              <li>Map corridor bounds — each tablet prefetches tiles when online</li>
              <li>Check-ins and short team messages</li>
            </ul>
            <p style={{ margin: '8px 0 0', color: '#64748b' }}>
              Map tiles:{' '}
              <strong style={{ color: '#94a3b8' }}>
                {sync.teamCorridorStatus === 'ready'
                  ? 'corridor ready'
                  : sync.teamCorridorStatus === 'prefetching'
                    ? 'warming corridor…'
                    : sync.teamCorridorStatus === 'team-hint'
                      ? 'bounds saved — prefetch when online'
                      : 'follows mission route'}
              </strong>
            </p>
          </div>
        ) : null}

        {sync.lastNotice ? (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #334155',
              color: sync.lastNotice.level === 'warn' ? '#fbbf24' : '#86efac',
              lineHeight: 1.45,
            }}
          >
            {sync.lastNotice.message}
          </div>
        ) : null}
        {linkHelp ? (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid rgba(56, 189, 248, 0.35)',
              background: 'rgba(8, 47, 73, 0.45)',
              color: '#bae6fd',
              lineHeight: 1.45,
              fontSize: '0.92em',
            }}
          >
            {linkHelp}
          </div>
        ) : null}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b8c4d8' }}>
          <input
            type="checkbox"
            checked={sync.autoApply}
            onChange={(e) => sync.setAutoApply(e.target.checked)}
            disabled={isObserver}
          />
          Auto-apply team waypoint updates{isObserver ? ' (always on in monitor mode)' : ''}
        </label>

        {!inMission ? (
          <>
            <StepCard step={1} title="Field mission" active>
              <label style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
                <span style={{ color: '#94a3b8' }}>Mission name</span>
                <input
                  value={missionNameInput}
                  onChange={(e) => setMissionNameInput(e.target.value)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#0f172a',
                    color: '#f8fafc',
                  }}
                />
              </label>
              <button
                type="button"
                style={{ ...btnStyle(true), width: '100%', marginTop: 10 }}
                onClick={() => void sync.startMission(missionNameInput)}
              >
                Start new mission
              </button>
              <p style={{ color: '#64748b', margin: '10px 0 8px', fontSize: '0.92em' }}>
                Or join a teammate&apos;s mission (your callsign is yours only — only the code must match
                the host):
              </p>
              <input
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                placeholder="Code from host screen · e.g. ABC-123"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#5eead4',
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textAlign: 'center',
                }}
              />
              {joinCodePreview ? (
                <div style={{ color: '#5eead4', fontSize: '0.88em', marginTop: 6, textAlign: 'center', fontWeight: 700 }}>
                  Ready to join {joinCodePreview}
                </div>
              ) : null}
              <button
                type="button"
                style={{ ...btnStyle(true), width: '100%', marginTop: 10 }}
                disabled={!isValidJoinCodeInput(joinCodeInput) || lanSearching || !codeJoinReady}
                onClick={() => void runLanJoin()}
              >
                {lanSearching
                  ? 'Connecting…'
                  : codeJoinReady
                    ? 'Join with mission code'
                    : 'Code join unavailable'}
              </button>
              {!codeJoinReady ? (
                <p style={{ color: '#fbbf24', margin: '8px 0 0', fontSize: '0.88em', lineHeight: 1.45 }}>
                  Mission code needs production Supabase (Wi‑Fi + internet). Or paste join bundle below.
                </p>
              ) : (
                <p style={{ color: '#64748b', margin: '8px 0 0', fontSize: '0.88em', lineHeight: 1.45 }}>
                  Type the <strong style={{ color: '#5eead4' }}>code on the host phone</strong> (e.g. 222-222). Same
                  Wi‑Fi/hotspot + internet. Callsigns can differ (GCM vs Good Cit){lanReady ? '; Android also auto-links' : ''}.
                </p>
              )}
              <textarea
                value={pasteHost}
                onChange={(e) => setPasteHost(e.target.value)}
                placeholder="Or paste join bundle from host…"
                rows={3}
                style={{
                  width: '100%',
                  marginTop: 10,
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 11,
                }}
              />
              <p style={{ color: '#64748b', margin: '8px 0 0', fontSize: '0.88em', lineHeight: 1.45 }}>
                Paste the host&apos;s link text into the box (long-press → Paste). No clipboard
                permission popup.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={{ ...btnStyle(true), flex: '1 1 140px' }}
                  disabled={!pasteHost.trim()}
                  onClick={() => void sync.startJoinMission(pasteHost.trim())}
                >
                  Join from bundle
                </button>
                <button type="button" style={btnStyle()} disabled={scanning} onClick={() => void runScan('host-offer')}>
                  {scanning ? 'Scanning…' : 'Scan join QR'}
                </button>
                <button type="button" style={btnStyle()} onClick={() => void tryClipboardIntoBox('host')}>
                  Try auto-paste
                </button>
              </div>
            </StepCard>

            <StepCard step={2} title="Watch someone (live map link)" active>
              <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.45, fontSize: '0.92em' }}>
                They tap <strong style={{ color: '#cbd5e1' }}>Share live map link</strong> and text you one
                link. Open it in Messages — Signal One connects and shows their GPS on{' '}
                <strong style={{ color: '#cbd5e1' }}>your map</strong>. No copy/paste.
              </p>
              <p style={{ color: '#7dffa8', margin: '10px 0 0', fontSize: '0.85em', lineHeight: 1.45 }}>
                Already got a link? Tap it again or reopen the HUD — connection starts automatically.
              </p>
              <details style={{ marginTop: 12 }}>
                <summary style={{ color: '#94a3b8', cursor: 'pointer', fontSize: '0.9em' }}>
                  Advanced — paste link or technical bundle
                </summary>
                {sync.observerSignalingAvailable ? (
                  <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                    <input
                      value={monitorMissionId}
                      onChange={(e) => setMonitorMissionId(e.target.value)}
                      placeholder="Mission ID (only if link failed)"
                      style={{
                        width: '100%',
                        padding: 8,
                        borderRadius: 8,
                        border: '1px solid #334155',
                        background: '#0f172a',
                        color: '#e2e8f0',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 11,
                      }}
                    />
                    <input
                      value={monitorToken}
                      onChange={(e) => setMonitorToken(e.target.value)}
                      placeholder="Watch token (only if link failed)"
                      style={{
                        width: '100%',
                        padding: 8,
                        borderRadius: 8,
                        border: '1px solid #334155',
                        background: '#0f172a',
                        color: '#e2e8f0',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 11,
                      }}
                    />
                    <button
                      type="button"
                      style={{ ...btnStyle(), width: '100%' }}
                      onClick={() => void sync.monitorMissionFromToken(monitorMissionId, monitorToken)}
                    >
                      Connect with ID + token
                    </button>
                  </div>
                ) : null}
                <textarea
                  value={pasteMonitor}
                  onChange={(e) => setPasteMonitor(e.target.value)}
                  placeholder="Paste technical monitor bundle…"
                  rows={3}
                  style={{
                    width: '100%',
                    marginTop: 8,
                    padding: 8,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#0f172a',
                    color: '#e2e8f0',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 11,
                  }}
                />
                <button
                  type="button"
                  style={{ ...btnStyle(), width: '100%', marginTop: 8 }}
                  onClick={() => void sync.monitorMissionFromOffer(pasteMonitor.trim())}
                >
                  Connect from bundle
                </button>
              </details>
            </StepCard>
          </>
        ) : null}

        {isObserver ? (
          <StepCard step={1} title="Live on your map" active={sync.monitorLive}>
            <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
              {sync.monitorLive
                ? `Following ${sync.monitorTargetCallsign} on the map — waypoints, GPS, and messages update automatically.`
                : 'Waiting for live GPS from the field — keep this screen open.'}
            </p>
            {sync.monitoredPresence?.lat != null && sync.monitoredPresence.lng != null ? (
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgba(8, 47, 73, 0.45)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                }}
              >
                <div style={{ color: '#bae6fd', fontWeight: 800, fontSize: '1.05em' }}>
                  {sync.monitoredPresence.callsign}
                </div>
                <div style={{ color: '#94a3b8', marginTop: 4, fontSize: '0.9em' }}>
                  {sync.monitoredPresence.lat.toFixed(5)}, {sync.monitoredPresence.lng.toFixed(5)}
                  {sync.monitoredPresence.accuracy != null
                    ? ` · ±${Math.round(sync.monitoredPresence.accuracy)}m`
                    : ''}
                </div>
                <div style={{ color: '#64748b', marginTop: 4, fontSize: '0.85em' }}>
                  Updated {formatPresenceAge(sync.monitoredPresence.updatedAt)}
                  {sync.monitorTransport !== 'idle'
                    ? ` · ${monitorTransportLabel(sync.monitorTransport)}`
                    : ''}
                </div>
              </div>
            ) : null}
            {sync.pendingAnswerEncoded ? (
              <p style={{ color: '#fbbf24', margin: '8px 0 0', fontSize: '0.9em' }}>
                Finishing secure link with field team…
              </p>
            ) : null}
            <button type="button" style={{ ...btnStyle(false, true), width: '100%', marginTop: 10 }} onClick={() => sync.endMonitor()}>
              Stop monitoring
            </button>
          </StepCard>
        ) : null}

        {isFieldMember && inMission && !linked ? (
          <>
            <StepCard step={2} title="Share mission code" active={sync.phase === 'awaiting-joiner'} done={linked}>
              {sync.joinCode ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#94a3b8', fontSize: '0.88em' }}>
                    Teammates enter this code — their callsign can be different
                  </div>
                  <div style={{ color: '#5eead4', fontSize: 28, fontWeight: 800, letterSpacing: 3, margin: '6px 0' }}>
                    {sync.joinCode}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '0.85em' }}>
                    Callsign on this device: <strong style={{ color: '#cbd5e1' }}>{sync.callsign}</strong>
                  </div>
                </div>
              ) : null}
              {sync.pendingOfferEncoded ? (
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {qrUrl ? (
                    <img src={qrUrl} alt="Join QR" style={{ width: 180, height: 180, alignSelf: 'center' }} />
                  ) : (
                    <span style={{ color: '#94a3b8' }}>
                      QR skipped — teammates use the mission code above (no paste).
                    </span>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      style={{ ...btnStyle(true), flex: '1 1 140px' }}
                      onClick={() => void shareBundle(sync.pendingOfferEncoded, 'Signal One — join mission')}
                    >
                      Share join link
                    </button>
                    <button
                      type="button"
                      style={btnStyle()}
                      onClick={() =>
                        void shareBundle(sync.pendingOfferEncoded, 'Signal One — join mission', 'join')
                      }
                    >
                      Copy link text
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" style={{ ...btnStyle(true), width: '100%', marginTop: 8 }} onClick={() => void sync.createJoinOffer()}>
                  Prepare link for next teammate
                </button>
              )}
              <button
                type="button"
                style={{ ...btnStyle(), width: '100%', marginTop: 8 }}
                onClick={() => void sync.reconnectMesh()}
              >
                Reconnect mesh (new link bundle)
              </button>
            </StepCard>

            {sync.pendingAnswerEncoded ? (
              <StepCard step={3} title="Complete link (fallback)" active>
                <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                  If Wi‑Fi auto-link did not finish, paste the answer bundle on the host tablet:
                </p>
                <textarea
                  value={pasteAnswer}
                  onChange={(e) => setPasteAnswer(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    marginTop: 8,
                    padding: 8,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#0f172a',
                    color: '#e2e8f0',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 11,
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={btnStyle(true)} onClick={() => void sync.applyJoinAnswer(pasteAnswer.trim())}>
                    Complete link
                  </button>
                  <button
                    type="button"
                    style={btnStyle(true)}
                    onClick={() => void shareBundle(sync.pendingAnswerEncoded, 'Signal One — mission answer')}
                  >
                    Share answer
                  </button>
                  <button type="button" style={btnStyle()} onClick={() => void tryClipboardIntoBox('answer')}>
                    Try auto-paste
                  </button>
                </div>
              </StepCard>
            ) : null}
          </>
        ) : null}

        {linked ? (
          <StepCard step={3} title="Connections" done active>
            {fieldLinked ? (
              <>
                <div style={{ color: '#94a3b8', marginBottom: 6, fontSize: '0.88em', fontWeight: 700 }}>
                  Field teammates
                </div>
                <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: '#d1fae5' }}>
                  {fieldPeers.map((p) => (
                    <li key={p.peerId}>
                      {p.callsign}{' '}
                      <span style={{ color: '#64748b' }}>({p.deviceId.slice(0, 8)}…)</span>
                    </li>
                  ))}
                </ul>
                <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
                  <button type="button" style={btnStyle(true)} onClick={() => void sync.createJoinOffer()}>
                    Link another teammate
                  </button>
                  <button type="button" style={btnStyle()} onClick={() => sync.pushSnapshotNow()}>
                    Push my waypoints now
                  </button>
                  <button type="button" style={btnStyle(true)} onClick={() => sync.sendTeamCheckIn()}>
                    Send check-in OK
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={burstText}
                      onChange={(e) => setBurstText(e.target.value)}
                      placeholder="Short team message…"
                      maxLength={120}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #334155',
                        background: '#0f172a',
                        color: '#f8fafc',
                      }}
                    />
                    <button
                      type="button"
                      style={btnStyle(true)}
                      onClick={() => {
                        if (sync.sendTeamBurst(burstText)) setBurstText('')
                      }}
                    >
                      Send
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p style={{ color: '#64748b', margin: 0, lineHeight: 1.45, fontSize: '0.92em' }}>
                No field teammates linked yet — use mission code or join bundle above.
              </p>
            )}
            {monitorPeers.length > 0 ? (
              <p style={{ color: '#94a3b8', margin: fieldLinked ? '12px 0 0' : '8px 0 0', fontSize: '0.88em' }}>
                Watchers:{' '}
                <strong style={{ color: '#bae6fd' }}>
                  {monitorPeers.map((p) => p.callsign?.trim() || 'Watcher').join(', ')}
                </strong>
              </p>
            ) : null}
          </StepCard>
        ) : null}

        {isFieldMember && inMission ? (
          <StepCard step={4} title="Let someone watch you" active>
            <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.45, fontSize: '0.92em' }}>
              Send one <strong style={{ color: '#cbd5e1' }}>live map link</strong> — parent or friend taps it
              and sees your GPS on their phone (read-only, anywhere with signal).
            </p>
            <button
              type="button"
              style={{ ...btnStyle(true), width: '100%', marginTop: 10 }}
              onClick={() => void sync.shareMonitorInvite()}
            >
              Share live map link
            </button>
            <p style={{ color: '#64748b', margin: '8px 0 0', fontSize: '0.85em', lineHeight: 1.45 }}>
              Creates the watch session and opens your share sheet (Messages, etc.). They only tap the link —
              you do not need a second step.
            </p>
            {sync.pendingObserverOfferEncoded && sync.pendingObserverOfferFitsQr && qrUrl ? (
              <div style={{ marginTop: 12, display: 'grid', gap: 8, justifyItems: 'center' }}>
                <span style={{ color: '#94a3b8', fontSize: '0.85em' }}>Or let them scan this QR</span>
                <img src={qrUrl} alt="Watch me QR" style={{ width: 180, height: 180 }} />
              </div>
            ) : null}
            <details style={{ marginTop: 12 }}>
              <summary style={{ color: '#94a3b8', cursor: 'pointer', fontSize: '0.9em' }}>
                Advanced — technical bundle
              </summary>
              <button
                type="button"
                style={{ ...btnStyle(), width: '100%', marginTop: 8 }}
                onClick={() => void sync.createObserverInvite()}
              >
                Copy technical bundle
              </button>
              {sync.pendingObserverOfferEncoded ? (
                <button
                  type="button"
                  style={{ ...btnStyle(), width: '100%', marginTop: 8 }}
                  onClick={() =>
                    void shareBundle(sync.pendingObserverOfferEncoded, 'Signal One — mission monitor', 'monitor')
                  }
                >
                  Share bundle file
                </button>
              ) : null}
              {sync.pendingObserverOfferEncoded ? (
                <div style={{ marginTop: 12 }}>
                  <p style={{ color: '#94a3b8', margin: '0 0 8px', fontSize: '0.9em', lineHeight: 1.45 }}>
                    If link auto-connect fails, paste observer answer bundle:
                  </p>
                  <textarea
                    value={pasteObserverAnswer}
                    onChange={(e) => setPasteObserverAnswer(e.target.value)}
                    placeholder="Paste monitor answer bundle…"
                    rows={2}
                    style={{
                      width: '100%',
                      padding: 8,
                      borderRadius: 8,
                      border: '1px solid #334155',
                      background: '#0f172a',
                      color: '#e2e8f0',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 11,
                    }}
                  />
                  <button
                    type="button"
                    style={{ ...btnStyle(true), width: '100%', marginTop: 8 }}
                    onClick={() => void sync.applyObserverAnswer(pasteObserverAnswer.trim())}
                  >
                    Complete monitor link
                  </button>
                </div>
              ) : null}
            </details>
            {sync.observerCount > 0 ? (
              <p style={{ color: '#86efac', margin: '8px 0 0', fontSize: '0.9em', fontWeight: 700 }}>
                {sync.peers
                  .filter((p) => p.linkRole === 'observer')
                  .map((p) => p.callsign?.trim() || 'Watcher')
                  .join(', ')}{' '}
                — watching your live map (see pill top-right)
              </p>
            ) : null}
            {!isMissionTurnConfigured() ? (
              <p style={{ color: '#64748b', margin: '10px 0 0', fontSize: '0.85em', lineHeight: 1.45 }}>
                Tip: TURN in production improves direct links; internet relay works without it.
              </p>
            ) : null}
          </StepCard>
        ) : null}

        {inMission ? (
          <button
            type="button"
            style={{ ...btnStyle(false, true), width: '100%' }}
            onClick={() => (isObserver ? sync.endMonitor() : sync.endMission())}
          >
            {isObserver ? 'Stop monitoring' : 'End mission link'}
          </button>
        ) : null}

        {filterTeammatePresence(sync.teamPresence, sync.deviceId).length > 0 ? (
          <div>
            <div style={{ color: '#94a3b8', marginBottom: 6 }}>Teammate GPS on map</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#bae6fd', fontSize: '0.95em' }}>
              {filterTeammatePresence(sync.teamPresence, sync.deviceId).map((p) => (
                <li key={p.deviceId}>
                  {p.callsign}
                  {p.lat != null && p.lng != null ? ` · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : ' · no fix'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {sync.lastSyncAt ? (
          <div style={{ color: '#64748b', fontSize: '0.9em' }}>
            Last sync {new Date(sync.lastSyncAt).toLocaleTimeString()}
          </div>
        ) : null}
      </div>
    </HudPanel>
  )
}
