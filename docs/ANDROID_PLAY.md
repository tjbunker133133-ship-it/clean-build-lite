# Android Play Store track (Capacitor)

Signal One HUD ships as a **Vite PWA** today. The **Play Store build** uses **Capacitor 6** wrapping the same `dist/` bundle.

## Prerequisites

- Node 20+
- Android Studio (SDK 34+, JDK 17)
- Release keystore (Play App Signing recommended)

## Build flow

```bash
npm run build
npm run cap:sync
npm run cap:open:android
```

In Android Studio: **Build → Generate Signed Bundle / APK** (AAB for Play).

## Mission Link on Android

- **Web/PWA:** QR + copy/paste WebRTC bundles (all Android Chrome devices, phones included).
- **Play APK:** adds **LAN discovery** (`android-nsd`) so teammates on the same hotspot can find a mission by **join code** without pasting SDP when discovery succeeds. QR/paste remain the fallback.

## Play policy checklist (before listing)

| Item | Notes |
|------|--------|
| Target API | Match current Google Play requirement (update yearly) |
| Data safety | Declare location; mission peer IDs; no sale of location data |
| Privacy policy | Hosted URL linked in Play Console |
| Permissions | Request only: location, nearby Wi‑Fi / network as used |
| Background location | Avoid unless product requires; mission GPS is foreground |
| SOS copy | Supplemental only; not a replacement for emergency services |
| Billing | Play Billing if selling subscriptions in-app |

## Permissions (Android)

Declared in the app module as features are enabled:

- `ACCESS_FINE_LOCATION` — map + team presence (foreground)
- `ACCESS_NETWORK_STATE`, `INTERNET` — maps + mesh
- `CHANGE_WIFI_MULTICAST_STATE` — NSD LAN discovery

## Tier 1 safety

Capacitor shell must **not** change raw GPS truth, SOS hold, or rescue dispatch. Mission mesh stays **Tier 2**.
