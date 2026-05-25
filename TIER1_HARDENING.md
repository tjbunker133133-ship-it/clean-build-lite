# Tier 1 — Stabilization & Hardening Gate

Tier 1 is the **offline-first safety core**: GPS pulse reference, 2-mile corridor width constant, map stack, Bento UI, forensic vault (encrypt-before-write), and SOS sustained slide.

**Freeze status (2026-05-24):** Tier 1 is **FIELD-PROVEN and FROZEN**. Boundaries, rollback manifest, and Tier 2 exclusions: **`TIER1_FREEZE.md`**. Production baseline hashes: **`tier1-baseline.manifest.json`**.

This document is the **merge/deploy gate**. It does not change runtime behavior.

---

## Automated gates (run before merge / deploy)

| Command | What it proves |
|---------|----------------|
| `npm run verify:tier1` | Reference hash + invariants + SOS 3s hold + corridor width + **production baseline manifest** |
| `npm run verify` | Typecheck + **all** unit tests (includes Tier 1 contract) + production build |
| `npm test` | Full Vitest suite (230+ tests) |

**PASS criteria:** exit code `0` on all commands above.

### Locked reference file

| File | SHA-256 (full) |
|------|----------------|
| `src/tier1-hud.html` | `898d8f46e5dd5b35d78cfcb7b5a3843cba7d61b396a3d9e91540ee78d3dbe397` |

Any intentional edit to the reference must update `.cursorrules` and `src/lib/tier1Contract.ts` in the same PR.

### Production vs reference (documented, not a failure)

| Concern | Reference (`tier1-hud.html`) | Production React HUD |
|---------|------------------------------|----------------------|
| GPS cadence | `setInterval` 120s poll | `watchPosition` (continuous fix stream) |
| SOS | 3s slide on mock rail | `SOSPanel` `HOLD_MS = 3000` |
| Vault | Mock AES-GCM + `localStorage` | Rescue / tactical profile (Tier 2 paths) |

Do **not** conflate reference poll timing with production GPS without an explicit approved migration.

---

## Manual hardening smoke (field / browser)

Run on **device + localhost preview** after automated gates pass. See also `SMOKE_TESTS.md` § Tier 1.

1. **Offline map** — Enable airplane mode after corridor prefetch; TOPO + emergency raster fallback still render; no blank map.
2. **GPS truth** — Raw fix visible; snap-to-trail (if enabled) does not hide raw coordinates in nav readout.
3. **Waypoints** — No auto-advance; user must confirm arrival; straight-line distance always shown.
4. **SOS** — Slide hold ~3s required; tap-only does not arm; release early resets.
5. **Corridor** — Off-route warning only beyond 2-mile total width envelope (5280 ft half-width).
6. **Tier isolation** — With network off, Tier 1 panels/map work; Tier 2 features degrade gracefully (no crash loops).

Enable dev audit logs: `localStorage.hud_tier1_debug = '1'` then reload.

---

## Hardening readiness checklist

- [ ] `npm run verify` passes
- [ ] `npm run verify:tier1` passes
- [ ] `tier1-hud.html` hash unchanged OR drift documented with rules update
- [ ] Manual Tier 1 smoke (6 steps above) on target device
- [ ] No `[runtime] Unhandled` errors during 2-min idle on map view
- [ ] PWA / `sw.js` activates on deploy URL (see `SMOKE_TESTS.md` §1)

**Status:** Tier 1 is **frozen** (`TIER1_FREEZE.md`). Tier 2 work proceeds only with `verify:tier1` passing and explicit approval for any locked-file change.
