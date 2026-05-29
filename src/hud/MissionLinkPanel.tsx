import { useCallback, useEffect, useState } from 'react'
import HudPanel from './HudPanel'
import { useMissionSync } from '../context/MissionSyncContext'
import { getBluetoothMeshCapability } from '../lib/missionSync/bluetooth'
import { filterTeammatePresence } from '../lib/missionSync/presence'
import { missionPacketToQrDataUrl, scanMissionPacketFromCamera } from '../lib/missionSync/qr'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchGapMd, touchGapSm, touchMinTarget } from './tokens'

function btnStyle(primary = false): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: 8,
    border: primary ? '1px solid rgba(94, 234, 212, 0.55)' : '1px solid #334155',
    background: primary ? 'rgba(4, 48, 42, 0.85)' : 'rgba(15, 23, 42, 0.75)',
    color: primary ? '#a7f3d0' : '#cbd5e1',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: touchMinTarget(false),
  }
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

  const activeEncoded = sync.pendingOfferEncoded ?? sync.pendingAnswerEncoded

  useEffect(() => {
    setMissionNameInput(sync.missionName)
  }, [sync.missionName])

  useEffect(() => {
    let cancelled = false
    if (!activeEncoded || !(sync.pendingOfferFitsQr || sync.pendingAnswerFitsQr)) {
      setQrUrl(null)
      return
    }
    void missionPacketToQrDataUrl(activeEncoded).then((url) => {
      if (!cancelled) setQrUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [activeEncoded, sync.pendingOfferFitsQr, sync.pendingAnswerFitsQr])

  const copyBundle = useCallback(async (text: string | null) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      sync.dismissNotice()
    } catch {
      /* fallback */
      window.prompt('Copy mission bundle:', text)
    }
  }, [sync])

  const runScan = useCallback(async (target: 'host-offer' | 'host-answer') => {
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
  }, [sync])

  const phaseLabel =
    sync.phase === 'connected'
      ? `Linked · ${sync.peers.length} peer(s)`
      : sync.phase === 'awaiting-joiner'
        ? 'Waiting for teammate'
        : sync.phase === 'awaiting-host-answer'
          ? 'Waiting for link partner'
          : sync.phase === 'connecting'
            ? 'Connecting…'
            : sync.role === 'member'
              ? 'Mission active'
              : 'Not linked'

  return (
    <HudPanel panelId="missionLink" title="Mission Link (P2P)" initialPos={{ x: 16, y: 420 }} initialWidth={340}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapMd(isMobile), fontSize: fontSm }}>
        {!sync.supported ? (
          <p style={{ color: '#fbbf24', margin: 0, lineHeight: 1.45 }}>
            WebRTC unavailable in this browser. Use Android Chrome PWA.
          </p>
        ) : null}

        <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
          Equal-peer mesh for Android phones and tablets (Wi‑Fi hotspot). Waypoints, teammate GPS on
          the map, check-ins, and short team messages. Does not change your GPS fix or SOS.{' '}
          {getBluetoothMeshCapability().reason}
        </p>

        <div style={{ color: '#5eead4', fontWeight: 700 }}>{phaseLabel}</div>
        {sync.joinCode ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(94, 234, 212, 0.35)',
              background: 'rgba(4, 48, 42, 0.5)',
            }}
          >
            <div style={{ color: '#94a3b8', fontSize: '0.85em' }}>Mission code (share with team)</div>
            <div style={{ color: '#5eead4', fontSize: 22, fontWeight: 800, letterSpacing: 2 }}>
              {sync.joinCode}
            </div>
          </div>
        ) : null}
        {sync.missionId ? (
          <div style={{ color: '#64748b', fontSize: '0.92em' }}>Mission: {sync.missionId}</div>
        ) : null}
        <div style={{ color: '#64748b', fontSize: '0.88em' }}>
          {sync.nativeLink.available
            ? 'Android LAN discovery available — use mission code on same hotspot'
            : 'LAN auto-link: install Play/Android build · web uses QR or copy/paste'}
        </div>

        {sync.lastNotice ? (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #334155',
              color: sync.lastNotice.level === 'warn' ? '#fbbf24' : '#86efac',
            }}
          >
            {sync.lastNotice.message}
          </div>
        ) : null}

        <label style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
          <span style={{ color: '#b8c4d8' }}>Mission name</span>
          <input
            value={missionNameInput}
            onChange={(e) => setMissionNameInput(e.target.value)}
            disabled={sync.role !== 'idle'}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#f8fafc',
            }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b8c4d8' }}>
          <input
            type="checkbox"
            checked={sync.autoApply}
            onChange={(e) => sync.setAutoApply(e.target.checked)}
          />
          Auto-apply team waypoint updates
        </label>

        {sync.role === 'idle' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
            <button
              type="button"
              style={btnStyle(true)}
              onClick={() => void sync.startMission(missionNameInput)}
            >
              Start mission
            </button>
            <strong style={{ color: '#94a3b8' }}>Or join an existing mission</strong>
            <textarea
              value={pasteHost}
              onChange={(e) => setPasteHost(e.target.value)}
              placeholder="Paste mission join bundle…"
              rows={3}
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
              style={btnStyle(true)}
              onClick={() => void sync.startJoinMission(pasteHost.trim())}
            >
              Join mission
            </button>
            <button
              type="button"
              style={btnStyle()}
              disabled={scanning}
              onClick={() => void runScan('host-offer')}
            >
              {scanning ? 'Scanning…' : 'Scan join QR'}
            </button>
            <input
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
              placeholder="Mission code e.g. ABC-123"
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#f8fafc',
              }}
            />
            <button
              type="button"
              style={btnStyle()}
              onClick={() => void sync.discoverMissionOnLan(joinCodeInput)}
            >
              Find mission on LAN (Android app)
            </button>
          </div>
        ) : null}

        {sync.role === 'member' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
            <button type="button" style={btnStyle(true)} onClick={() => void sync.createJoinOffer()}>
              Link another tablet (any member can do this)
            </button>
            <button type="button" style={btnStyle()} onClick={() => sync.pushSnapshotNow()}>
              Push my waypoints now
            </button>
            <button type="button" style={btnStyle()} onClick={() => sync.endMission()}>
              End mission link
            </button>
          </div>
        ) : null}

        {sync.peers.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
            <strong style={{ color: '#cbd5e1' }}>Team comms (mesh only)</strong>
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
            {sync.teamCheckIns.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18, color: '#86efac', fontSize: '0.9em' }}>
                {sync.teamCheckIns.map((c) => (
                  <li key={`${c.deviceId}-${c.sentAt}`}>
                    {c.callsign} OK {c.note ? `· ${c.note}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            {sync.teamBursts.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18, color: '#bae6fd', fontSize: '0.9em' }}>
                {sync.teamBursts.map((b) => (
                  <li key={`${b.deviceId}-${b.sentAt}`}>
                    <strong>{b.callsign}:</strong> {b.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {sync.pendingOfferEncoded ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
            <strong style={{ color: '#cbd5e1' }}>Other tablet: scan or paste this join bundle</strong>
            {qrUrl ? (
              <img src={qrUrl} alt="Join mission QR" style={{ width: 200, height: 200, alignSelf: 'center' }} />
            ) : (
              <span style={{ color: '#fbbf24' }}>Bundle too large for QR — use copy/paste.</span>
            )}
            <button type="button" style={btnStyle()} onClick={() => void copyBundle(sync.pendingOfferEncoded)}>
              Copy join bundle
            </button>
          </div>
        ) : null}

        {sync.pendingAnswerEncoded ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: touchGapSm(isMobile) }}>
            <strong style={{ color: '#cbd5e1' }}>Link partner: paste answer bundle</strong>
            {qrUrl ? (
              <img src={qrUrl} alt="Answer QR" style={{ width: 200, height: 200, alignSelf: 'center' }} />
            ) : null}
            <textarea
              value={pasteAnswer}
              onChange={(e) => setPasteAnswer(e.target.value)}
              placeholder="Paste answer bundle…"
              rows={3}
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
              style={btnStyle(true)}
              onClick={() => void sync.applyJoinAnswer(pasteAnswer.trim())}
            >
              Complete link
            </button>
            <button type="button" style={btnStyle()} onClick={() => void copyBundle(sync.pendingAnswerEncoded)}>
              Copy answer bundle
            </button>
            <button
              type="button"
              style={btnStyle()}
              disabled={scanning}
              onClick={() => void runScan('host-answer')}
            >
              {scanning ? 'Scanning…' : 'Scan answer QR'}
            </button>
          </div>
        ) : null}

        {sync.peers.length > 0 ? (
          <div>
            <div style={{ color: '#94a3b8', marginBottom: 6 }}>Linked teammates</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#d1fae5' }}>
              {sync.peers.map((p) => (
                <li key={p.peerId}>
                  {p.callsign} <span style={{ color: '#64748b' }}>({p.deviceId.slice(0, 8)}…)</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {filterTeammatePresence(sync.teamPresence, sync.deviceId).length > 0 ? (
          <div>
            <div style={{ color: '#94a3b8', marginBottom: 6 }}>Teammate GPS on map</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#bae6fd', fontSize: '0.95em' }}>
              {filterTeammatePresence(sync.teamPresence, sync.deviceId).map((p) => (
                <li key={p.deviceId}>
                  {p.callsign}
                  {p.lat != null && p.lng != null
                    ? ` · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`
                    : ' · no fix'}
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
