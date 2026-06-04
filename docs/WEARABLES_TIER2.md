# Wearables (Tier 2)

**Panel:** dock strip → **WEAR** (Wearables) · voice: `wearables panel` / `open wearables`

Tier 2 companion devices — information sharing and notification testing. Does **not** change Tier 1 GPS, SOS, deadman dispatch, or rescue logic.

## Where it lives

| Piece | Path |
|-------|------|
| HUD panel | `src/hud/WearablesPanel.tsx` |
| Status + device guide | `src/lib/wearables/wearablesStatus.ts` |
| Test notification (not SOS) | `src/lib/wearables/companionNotification.ts` |
| Cockpit default layout | `src/context/CockpitContext.tsx` (`panelId: wearables`) |
| App mount | `src/App.tsx` (lazy panel) |

## Works today (Pixel Watch tester)

1. Install HUD on **phone** (PWA or Android app).
2. Open **Wearables** panel → **Allow notifications** → **Send test alert**.
3. Confirm alert on phone; Pixel Watch should **mirror** if paired.
4. For **contact** role: **Share contact push invite** → contact subscribes → SOS push can mirror to their watch.

## Health Connect (Android field APK)

1. Use the **Play / field APK** (Capacitor), not browser-only.
2. Sync ring or watch data into the **Health Connect** app (Oura, Samsung Health, Pixel Watch, etc.).
3. Wearables → **Link Health Connect** → allow **heart rate** and **steps**.
4. **Refresh vitals** — advisory readout only; voice **biometric** includes HR/steps when linked.
5. Does **not** drive SOS, deadman dispatch, or GPS.

Rebuild APK after pulling: `npm run cap:sync` then Android Studio assemble.

## Planned (Tier 2+)

| Track | Scope |
|-------|--------|
| Health Connect extras | More record types, optional refresh interval |
| Wear OS companion | Complications / open phone — not full HUD on wrist |
| Deadman on wrist | Off until legal review |
| Smart glasses | Tier 3 AR — no Tier 2 link |

## Not in scope

- HUD app running on the watch face
- Web Bluetooth to Pixel Watch
- Auto-SOS from heart rate without review

See also: `docs/IOS_FIELD_GUIDE.md` for iPhone-specific limits.
