# Signal One HUD — iPhone / iPad field guide

This app is already tuned for **Apple WebKit** in several Tier 1 paths (map recovery, gesture tolerance, BFCache resume). This page covers **what works**, **what is intentionally limited**, and **what does not work** in Safari / Home Screen PWA on iOS — especially vs Android field testing.

---

## Before field use on iOS

1. **Add to Home Screen** (Share → Add to Home Screen) — not a bookmark.
2. Open **HUD V.1 from the icon**, not a Safari tab.
3. **Settings → HUD app → Location → While Using**.
4. Run **Preflight** (GPS lock, notifications if you want push).
5. Same env keys as Android: `VITE_MAPTILER_KEY`, optional `VITE_FIRMS_MAP_KEY`, Supabase + VAPID for push.

---

## Works well on iOS (today’s build)

| Feature | Notes |
|---------|--------|
| **Tier 1 GPS** | Raw fix, SOS, deadman, rescue — same pipeline |
| **Basemaps** | Streets, Topo, Outdoor, Satellite (Outdoor/Topo use **raster** on iOS for WebKit stability) |
| **Offline corridor** | Outdoor raster tiles + cached corridor when you prefetched on network |
| **Waypoints** | Tap-to-drop, straight routes, navigation monitor, corridor alerts |
| **Voice commands** | `webkitSpeechRecognition`; wake word + command list |
| **Situational overlays** | Checkboxes in Map & display; WMS (fire, relief, lands) need network; OSM Overpass layers cache per viewport |
| **Fire brief / weather** | Voice + weather panel |
| **Web Push alerts** | **Home Screen PWA only**, iOS **16.4+**, notification permission |
| **Snap diagnostics** | Alt+Shift+D overlay; waypoint drop logs (tier1 placement unchanged) |
| **Display modes** | Low light / bright / red tactical |

---

## Limited on iOS (by design — stable, not broken)

| Feature | Why |
|---------|-----|
| **Snap to trail (Outdoor)** | iOS uses **raster** Outdoor/Topo so MapLibre does not crash on embedded terrain. Trail snap needs **vector** trail layers → checkbox stays disabled / “not capable”. **Use straight pin-to-pin routes** — same as recommended on Android with snap off. |
| **Trail tap inspect (Outdoor)** | Same vector requirement — disarm + tap trail only when vector trails exist (typically not on iOS Outdoor). |
| **Android-style outdoor vector offline** | Android PWA can keep vector Outdoor for snap + corridor URL match; iOS trades that for **WebKit stability**. |
| **Background GPS** | iOS throttles Safari/PWA in background — expect stale fixes until foreground; use **foreground** for critical nav. |
| **Background WebRTC mesh** | Unreliable when app backgrounded; LAN/QR bundle still OK in foreground. |

---

## Does not work on iOS (browser / PWA limits)

| Feature | Why |
|---------|-----|
| **Web Push in Safari tab** | Apple requires **installed PWA** (Home Screen). |
| **Mission Bluetooth / Nearby mesh** | **Android Capacitor app only** — Web Bluetooth is not available for peer mesh on iOS Safari. Use **Share / QR / paste mission bundle** instead. |
| **Programmatic “Install app”** | No Android-style install prompt — manual Add to Home Screen only. |
| **OSRM / GraphHopper snap pipeline** | Not shipped yet (any platform). |
| **SMS alerts** | Not in this build (push + email only). |
| **Opening iOS Settings via `prefs:` URL** | Often blocked on newer iOS — Preflight uses clipboard steps instead. |

---

## Today’s Tier 2 features on iPhone

### Environmental overlays

- **Works:** Toggle in Map & display; OSM bike/hike/mines/rail cache when you’ve viewed the area online.
- **Needs network:** NASA FIRMS fire, USGS relief, USFS/BLM WMS (same as Android).
- **Does not replace** basemap or GPS truth.

### Snap pipeline (Phase 1b)

- **Default:** `VITE_ENABLE_SNAP_PIPELINE=false` — placement identical to before.
- **Diagnostics:** `VITE_ENABLE_SNAP_DIAGNOSTICS=true` logs drops; on iOS most Outdoor drops are **raw** (no tier1 snap).
- **Pipeline on** only re-runs MapLibre snap when vector trails exist (rare on iOS Outdoor).

### Voice overlay commands

- Same phrases as Android (`show fire map`, `bike paths on`, etc.).
- FIRMS fire layer still needs `VITE_FIRMS_MAP_KEY` in the **built** deploy.

---

## iOS vs Android quick matrix

| | Android PWA (field) | iOS Home Screen PWA |
|--|---------------------|---------------------|
| Outdoor basemap | Vector (snap/corridor friendly) | Raster (stable) |
| Snap to trail | Available when Outdoor + zoom 12+ | **Not available** on Outdoor |
| Corridor offline | Strong | Strong (raster outdoor) |
| Push alerts | Chrome PWA | **16.4+**, installed only |
| Mission mesh | QR/share; Android app → BT | QR/share only |
| Map WebKit crashes | Less aggressive | Mitigated via raster + repaint |

---

## If something looks wrong on iPhone

1. Confirm **Home Screen** icon (Preflight → PWA Install = pass).
2. Outdoor + **Snap to trail** greyed out → **expected on iOS**, not a bug.
3. Fire layer empty → key in build + restart dev / redeploy prod.
4. No push → notifications allowed + watch link opened in **same** installed app.
5. Debug overlay: `?hudOverlay=1` or Alt+Shift+D (desktop) — check snap / GPS track section.

---

## Optional env (same as Android)

```env
VITE_ENABLE_SNAP_PIPELINE=false
VITE_ENABLE_SNAP_VALIDATION=true
VITE_ENABLE_SNAP_DIAGNOSTICS=true
```

No iOS-specific env flags required.
