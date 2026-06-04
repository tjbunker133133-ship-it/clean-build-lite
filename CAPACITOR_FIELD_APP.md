# Signal One — Android field app (Capacitor)

Capacitor is **installed and wired**. After code changes, rebuild the APK:

```bash
npm run cap:sync
```

Install that build on every field tablet. The browser PWA does not include native discovery.

## Mission link — how transports work

| Layer | Priority | What it does |
|--------|----------|----------------|
| **Signaling** (joining) | 1. Wi‑Fi LAN → 2. Bluetooth/Nearby → 3. Share/QR/paste | Exchanges the join bundle so WebRTC can connect |
| **Mesh** (after linked) | LAN paths first, cellular/STUN last | Waypoints, GPS, check-ins over WebRTC data channel |

You do **not** pick Wi‑Fi vs Bluetooth manually for the mesh — the app tries the best path automatically once teammates are linked.

### Signaling (finding each other)

1. **Wi‑Fi LAN** — same phone hotspot; mission code + auto discovery.
2. **Bluetooth / Nearby** — Google Nearby Connections in the Android app; **no Bluetooth pairing** required.
3. **Share / QR / paste** — always available as backup (works offline once the text is on the other device).

Host **Start mission** turns on Wi‑Fi + Nearby search together. Joiner enters code → **Join via Wi‑Fi code**.

### Mesh stability (staying connected)

- Keepalive ping every 12s on the mission data channel.
- Brief disconnects wait ~8s before warning (mission stays active).
- ICE restart attempts on blips; STUN only when LAN path is not enough (e.g. cellular).
- Mission id/name persist across app restarts; tap **Prepare link** / **Reconnect mesh** to link teammates again.

### What syncs over the mesh (offline + online)

| Data | Behavior |
|------|----------|
| Waypoints | Add/update/archive (merge by timestamp) |
| Trail-follow toggle | Shared with waypoints |
| Teammate GPS | ~8s presence updates on map |
| Map corridor | Bounds only — each device prefetches outdoor tiles locally |
| Check-in / burst | Short team OK pings and messages |

Map **tiles are not streamed** (too large for BT). Bounds sync so every tablet warms the same corridor when online.

### TURN relay (recommended for remote monitors)

WebRTC over the public internet often needs a **TURN** server when peers are far apart or behind strict NAT (typical for coast-to-coast).

Add to `.env.local` at project root, then rebuild:

```
VITE_MISSION_TURN_URL=turn:your-turn.example.com:3478
VITE_MISSION_TURN_USERNAME=your-username
VITE_MISSION_TURN_CREDENTIAL=your-credential
```

**Providers:** Twilio Network Traversal, Metered.ca, Xirsys, or self-hosted [coturn](https://github.com/coturn/coturn).

**Without TURN:** Same-region or same-carrier cell links may still connect via STUN. If monitor shows “link failed,” configure TURN or use paste-bundle fallback with Supabase signaling.

**Supabase signaling** (optional): With `VITE_SUPABASE_URL` + anon key set, monitor offer/answer can auto-exchange. Without it, copy/paste bundles both ways.


Field lead creates a **monitor link** (separate from the 6-character Wi‑Fi code). Remote friends paste the monitor bundle — they see waypoints, GPS, check-ins, and messages but **cannot edit** the mission.

- Up to **12** simultaneous observers per mission.
- Uses **internet ICE** (optional TURN in `.env` for reliable coast-to-coast).
- With Supabase configured, monitor offer/answer can auto-exchange over Realtime (no manual paste back).
- Observer bundles are **never** advertised on Wi‑Fi / Bluetooth — field local mesh stays separate.

## Permissions (Android)

The APK requests Bluetooth and location-related permissions required by Nearby Connections and GPS — grant on first mission link.

## Same name / email

Not a problem — each device has its own ID in storage.
