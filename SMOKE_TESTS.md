# Tactical HUD — Smoke Tests

Scope: post-deploy regression detection on the live Netlify build.
Target outcomes: routing correctness, service-worker behavior, mobile UI stability, permission flows, system-settings deep links.

This document is **manual checklist material**. It does not replace unit tests. If any step fails, capture the device, OS version, browser/version, install state (tab vs PWA standalone), URL, console logs, and `localStorage.cockpit*` snapshot before reporting.

---

## 0. Conventions

- **PASS** = expected behavior observed.
- **FAIL** = unexpected behavior (record evidence).
- **N/A** = step does not apply on this platform.
- "Open the app" = navigate to the deployed URL in a fresh tab unless otherwise specified.
- "Storage snapshot" = open DevTools → Application → Local Storage → host → copy keys starting with `cockpit_` (and `hud_*` if relevant).
- "Force reload" = `Ctrl/Cmd+Shift+R` on desktop, or use the in-app **FORCE UPDATE APP** button in Preflight panel.

---

## 1. Pre-flight (single deploy; run once after each release)

| # | Step | Expected |
|---|------|----------|
| 1.1 | Open the app URL in any modern browser. | HTML loads; no Safari/Chrome system error sheet. |
| 1.2 | DevTools → Network: hard reload. | `index.html` returns 200, hashed `/assets/*.js` and `*.css` return 200. No 404s. |
| 1.3 | DevTools → Application → Service Workers. | A worker is **activated and running** for the deploy URL; source is `/sw.js`. |
| 1.4 | Application → Manifest. | `name: Tactical HUD`, `start_url: /`, `display: standalone`, manifest icon visible. |
| 1.5 | Direct deep-link: append a fake path like `/foo/bar` to the URL. | App loads (SPA fallback to `index.html`); URL bar still shows `/foo/bar`. No "page not found." |
| 1.6 | Network → request a non-existent asset `/assets/does-not-exist.js`. | Returns HTML body (current SPA fallback behavior — known quirk; record but not a regression unless changed). |
| 1.7 | Build stamp visible in top-left debug overlay (dev) or `document.title` includes timestamp slice. | Stamp matches deployed build. |

---

## 2. Desktop Chromium / Opera / Edge

### 2.1 First load

1. Open in a private window. **PASS:** map renders within ~5 s; HUD panels visible.
2. Open DevTools console. **PASS:** no `[runtime] Unhandled` errors. `[BUILD ID]`, `[DEVICE DETECT]`, `[FORCE RELOAD AVAILABLE]` lines log normally.

### 2.2 Floating-panel stability (regression: autonomous growth)

1. Click any docked panel header to undock (or use **Layers** / **Coords** / **Display**).
2. Note the panel's current width and height (DevTools → Elements → outer panel `<div data-panel-id="...">` → `getBoundingClientRect()`).
3. Snapshot `localStorage.getItem('cockpit_state')` for that panel's `w`/`h`.
4. **Wait 2 minutes idle** (no input, no resize). Do not background the tab.
5. Re-measure and re-snapshot.

**PASS:** width/height in storage and on-screen are **byte-identical** to step 2/3.
**FAIL:** any monotonic increase. Record per-axis delta, browser, idle duration, panel id.

### 2.3 Resize handle

1. Drag a floating panel's bottom-right corner. Resize stops cleanly at min and at viewport bounds.
2. Release. Open storage; `w`/`h` reflect the released size.
3. Reload page. **PASS:** panel restores to that size.

### 2.4 Dock / undock

1. Drag any floating panel to the left or right edge → preview rail appears → release. **PASS:** panel docks.
2. Click the docked rail's bottom action OR swipe outward (desktop: drag the dock strip). **PASS:** panel undocks to a sensible position; not minimized.

### 2.5 Force update flow

1. Click the **FORCE UPDATE APP** button in the Preflight panel.
2. Console logs: `[FORCE UPDATE] Checking SW`, `[FORCE UPDATE] Triggered`, `[FORCE UPDATE] Reloading`, then `[SW] Controller changed → reloading`.
3. **PASS:** page reloads exactly once and lands on a working app. URL contains `?update=<timestamp>`.

### 2.6 Refresh / direct entry

1. Hard refresh on the home URL. **PASS:** identical state restoration; panels unchanged in size and position.
2. Hard refresh on `/foo/bar`. **PASS:** SPA fallback serves the app, URL preserved.

### 2.7 Background / foreground (tab switching)

1. Switch tabs for ~30 s, return.
2. Map and panels intact. GPS-related UI (if a fix existed before) preserved.
3. Console may log map watchdog or visibility-change — no errors.

---

## 3. Mac Safari (desktop)

### 3.1 Same baseline as section 2

Run 2.1–2.7. All should PASS.

### 3.2 Settings deep links **not exposed**

1. Open the **Permission Wizard** (set GPS to denied via system prefs, reload, wait for prompt overlay).
2. Inspect the wizard.

**PASS:** No "OPEN IPHONE SETTINGS" / "ALT SETTINGS LINK" / "OPEN ANDROID LOCATION" buttons render (UA does not contain `iPhone|iPad|iPod` or `Android`).
**FAIL:** any of those buttons render.

---

## 4. iOS Safari (browser tab)

Tested on the latest iOS available, plus at minimum one device on iOS 16 or earlier if accessible.

### 4.1 First load

1. Open the URL in Safari. **PASS:** app loads; no "cannot load page because address is invalid" sheet.
2. Tap the URL bar → reload. **PASS:** app reloads cleanly.

### 4.2 Direct deep-link

1. Type `<deploy-url>/foo/bar` in URL bar. **PASS:** app loads; URL preserved.

### 4.3 GPS permission flow

1. Open app for the first time on a device that has never granted location.
2. Permission wizard appears (or prompt overlay if GPS is `denied`/stuck).
3. Tap **REQUEST LOCATION**. Safari's native permission sheet appears. Tap **Allow**.
4. **PASS:** GPS state transitions to `granted`; `localStorage.gpsPermission === 'granted'`.

### 4.4 GPS denied recovery — **regression hot spot**

1. In iOS Settings → Privacy → Location Services → set Safari to **Never**.
2. Reload the app.
3. After ~10 s the permission overlay appears.
4. Tap **OPEN IPHONE SETTINGS**.

**PASS:** One of:
- iOS Settings opens to Privacy → Location Services (older iOS), OR
- App stays put for ~800 ms, then a centered modal appears: **OPEN SETTINGS MANUALLY** with text "Open Settings manually in iPhone Settings > Privacy > Location" and an OK button.

**FAIL:**
- A Safari "cannot open page because the address is invalid" sheet appears at any point.
- The app navigates away from itself (URL bar changes off the deploy URL).
- App returns to a blank page.

5. Dismiss the modal. Tap **ALT SETTINGS LINK**. Same expected outcome (success or modal — never the Safari error sheet).

6. Tap **COPY SAFARI STEPS**. **PASS:** clipboard contains the multi-line manual instructions.

### 4.5 Background / resume

1. Granted GPS, app loaded.
2. Switch to another app for 30 s. Return to Safari.

**PASS:**
- Map repaints without "MAP FALLBACK".
- GPS still locked; status rail shows `GPS LOCK`.
- Floating-panel sizes unchanged in storage and on screen.

### 4.6 Orientation change

1. Rotate device portrait → landscape → portrait, slowly.
2. **PASS:** map resizes; panels remain within viewport; no panel sizing drift in storage after settling.

### 4.7 URL-bar slide

1. Scroll the page slightly so the URL bar collapses, then expands.
2. **PASS:** map repaints to fill new viewport; panel sizes unchanged in storage.

---

## 5. iOS PWA (Add to Home Screen)

### 5.1 Install

1. In Safari → Share → **Add to Home Screen**. Confirm.
2. Open the home-screen icon. **PASS:** app loads in standalone mode (no Safari chrome). No "cannot load page" sheet.

### 5.2 Cold start under stale-SW conditions — **regression hot spot**

After a new deploy ships:

1. Without opening Safari first, tap the home-screen icon.
2. **PASS:** app loads. May briefly flash an old version, then auto-reload to the new one (`[SW] Controller changed → reloading`).
3. **FAIL:** the system unavailability sheet appears, OR the app stays stuck on a blank screen for >10 s, OR a JS console error about a missing hashed asset appears (open via Mac Safari → Develop → iPhone).

### 5.3 Force update from PWA

1. From within the standalone PWA, open Preflight → **FORCE UPDATE APP**.
2. **PASS:** standalone reloads once; afterwards `[BUILD ID]` log shows the new build.

### 5.4 GPS denied recovery in standalone mode

Repeat 4.4 from inside the home-screen PWA.

**PASS:** identical behavior (Settings opens, or modal appears). No system error sheet inside the standalone wrapper.

### 5.5 Background / foreground

1. Lock device for 1 minute, unlock, return to PWA.
2. **PASS:** map and HUD restore. SW does not double-reload. GPS does not get stuck in `searching`.

---

## 6. Android Chrome

### 6.1 First load

1. Open URL. **PASS:** app loads; no "page not found" / "ERR_FAILED" / Chrome custom error.

### 6.2 GPS permission

1. Tap **PROMPT GPS**. Native permission prompt appears.
2. Allow. **PASS:** GPS locks; status rail shows `GPS LOCK`.

### 6.3 Android settings deep link — **regression hot spot**

1. Disable location for the site (Chrome ⋮ → Site settings → Location → Block).
2. Reload. Permission overlay appears.
3. Tap **OPEN ANDROID LOCATION**.

**PASS:** Android Settings opens to Location, OR (if intent silently fails) the in-app **OPEN SETTINGS MANUALLY** modal appears within ~800 ms.
**FAIL:** any Chrome error page is shown.

4. Tap **COPY ANDROID STEPS**. **PASS:** clipboard contains manual instructions.

### 6.4 Floating-panel stability

Repeat 2.2 with a long-press to undock first (mobile pattern). Idle the device with screen on for 2 minutes (do **not** lock the screen).
**PASS:** no autonomous size growth in storage or on screen.

### 6.5 Mobile maximize / restore — **regression hot spot**

1. Long-press a panel header until glow appears, then drag it free of any dock edge.
2. Tap the **Max** button on the panel header.
3. **PASS:** panel fills the screen with insets, header still visible.
4. Snapshot `localStorage.cockpit_state`. The panel's stored `w` and `h` should be the **pre-max** values, not the viewport.
5. Tap **Restore**. **PASS:** panel returns to its pre-max size and position.

### 6.6 URL bar slide

Scroll page until address bar collapses, then expands.
**PASS:** map resizes; panel sizes in storage do not change.

### 6.7 Backgrounding via OS

1. Press home button. Wait 30 s. Return to Chrome.
2. **PASS:** app resumes; map redraws; GPS unaffected.

### 6.8 Add to Home screen (PWA)

If user installs as PWA: repeat 5.2–5.5 patterns. Android handles SW updates more gracefully than iOS, so the bar is the same baseline.

---

## 7. Permission flows (cross-platform)

| # | Step | Expected |
|---|------|----------|
| 7.1 | First-launch wizard appears when `wizardCompleted` flag absent. | Wizard visible; STEP 1 / N. |
| 7.2 | Click **REQUEST LOCATION** → allow → wizard advances. | `geo === 'granted'`. |
| 7.3 | Click **REQUEST MICROPHONE** → allow. | `mic === 'granted'`. |
| 7.4 | Notifications: prompt appears (Android Chrome / Desktop). | State updates accordingly; iOS Safari surfaces no prompt — `notif === 'unsupported'` is acceptable. |
| 7.5 | iOS-only: orientation/motion request prompt appears. Allow. | `orient`/`motion === 'granted'`. |
| 7.6 | **REQUEST ALL REMAINING (BATCH)** on Done step. | All remaining states resolve to `granted` / `denied` / `unsupported`. |
| 7.7 | **ENTER HUD** dismisses wizard; `wizardCompleted` set in storage. | Wizard does not re-open on next reload. |
| 7.8 | Reset App link → confirm dialog → cleared. | localStorage cleared; SW unregistered; app reloads to clean wizard. |

---

## 8. Service-worker caching

### 8.1 First-deploy install

| # | Step | Expected |
|---|------|----------|
| 8.1.1 | Open the app for the first time. DevTools → Application → Service Workers. | Worker `installed → activated`. Cache `workbox-precache-v2-...` exists. |
| 8.1.2 | Application → Cache Storage → precache. | Contains `index.html`, hashed `/assets/*.js`, `/assets/*.css`, `manifest.webmanifest`, `hud-icon.svg`, `sw-message-handler.js`. |
| 8.1.3 | Reload offline (DevTools → Network → Offline). | App still loads (SW navigation handler returns cached `index.html`). |

### 8.2 New-deploy update flow

After ship a new build:

| # | Step | Expected |
|---|------|----------|
| 8.2.1 | Reload an open tab. | Console: `[SW] Controller changed → reloading`. Page reloads exactly once. |
| 8.2.2 | After the auto-reload, `[BUILD ID]` log shows the new build timestamp. | New version active. |
| 8.2.3 | Cache Storage → outdated precache cleared (`cleanupOutdatedCaches: true` in workbox config). | Only the latest precache cache remains. |
| 8.2.4 | No `404` for any `/assets/*` in the Network tab. | All hashed assets resolved. |

### 8.3 Stale install recovery (manual)

1. Modify the URL with `?clearcache=1` or open Console and run `await window.__forceReload()`.
2. **PASS:** all caches cleared; page reloads; SW reinstalls cleanly.

---

## 9. Routing

| # | Step | Expected |
|---|------|----------|
| 9.1 | Enter `<deploy>/` in URL bar. | App loads (status 200). |
| 9.2 | Enter `<deploy>/anything/here?x=1`. | App loads; URL preserved; SPA fallback fired. |
| 9.3 | Network tab: navigation request on a deep link. | Response 200, `content-type: text/html`. |
| 9.4 | Network tab: any `/assets/*.js` request. | Response 200, `content-type: application/javascript`. **FAIL** if HTML body returned for missing-hash asset and a console MIME error appears. |
| 9.5 | After deploy, hard refresh in Safari iOS PWA. | App loads new build (no "cannot load page"). |

---

## 10. Background / visibility / sleep

| # | Step | Expected |
|---|------|----------|
| 10.1 | Background tab for 5 minutes, return. | Map repaints (visibility-change → `map.resize()`); GPS reconnects if needed; no console errors. |
| 10.2 | Lock device for 5 minutes (mobile). | Same baseline. SW remains registered. |
| 10.3 | Device sleep / resume. | App resumes within 1 paint; status rail updates within 1 GPS poll. |
| 10.4 | Long idle (15 minutes), foreground. | Floating-panel sizes unchanged in storage. Status rail values refresh. |

---

## 11. Cross-platform regression matrix (quick gate)

Run this matrix after any change touching: routing, SW config, panel sizing, navigation helpers, PWA manifest, Vite config, or `netlify.toml`.

| Platform | First load | Direct deep link | Floating-panel idle | Settings link | Update flow |
|----------|------------|------------------|---------------------|---------------|-------------|
| Desktop Chrome | ✓ | ✓ | ✓ | N/A (no buttons) | ✓ |
| Desktop Edge | ✓ | ✓ | ✓ | N/A | ✓ |
| Desktop Firefox | ✓ | ✓ | ✓ | N/A | ✓ |
| Opera desktop | ✓ | ✓ | ✓ | N/A | ✓ |
| Mac Safari | ✓ | ✓ | ✓ | N/A | ✓ |
| iOS Safari (tab) | ✓ | ✓ | ✓ | ✓ (Settings or modal, never error sheet) | ✓ |
| iOS PWA (Home Screen) | ✓ | N/A | ✓ | ✓ | ✓ |
| Android Chrome | ✓ | ✓ | ✓ | ✓ (Settings or modal, never error page) | ✓ |
| Android Chrome PWA | ✓ | N/A | ✓ | ✓ | ✓ |

A row is **GREEN** only when every column passes. One **FAIL** in any column blocks the release until triaged.

---

## 12. Known acceptable behaviors (do not flag as regressions)

- iPad Safari with iOS 13+ default desktop-class UA: settings deep-link buttons do **not** render. Manual instructions ("COPY SAFARI STEPS") are the intended path.
- Custom-scheme deep-links (`App-Prefs:`, `prefs:`) may silently fail on modern iOS. The in-app fallback modal is the success state, not a regression.
- The first reload after a fresh deploy may log `[SW] Controller changed → reloading` and reload once. Expected.
- Floating-panel widths and heights are 3 px tighter than legacy stored values on first paint after the `box-sizing: border-box` migration. One-time, no further drift.
- `/assets/<old-hash>.js` after redeploy returns `index.html` body (SPA wildcard). Will surface as a strict-MIME error in the console only if the page references the old hash; harmless after the SW auto-reload swaps to the new bundle.

---

## 13. Reporting a failure

For any **FAIL** above, capture:

1. **Platform**: device, OS version, browser/version, install state (tab vs PWA).
2. **URL** at failure.
3. **Console**: full log including `[BUILD ID]`, `[DEVICE DETECT]`, any errors.
4. **Network**: failing request status, response headers, request URL.
5. **Storage**: snapshot of `cockpit_state`, `cockpit_state_device_tune`, and `gpsPermission` if location-related.
6. **Reproduction**: minimum step sequence that triggers the failure.
7. **Frequency**: deterministic, intermittent, or one-shot.

Do not propose code changes from a smoke-test failure alone — file the evidence and let scoped triage decide.
