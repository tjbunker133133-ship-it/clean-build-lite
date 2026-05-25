# Tier 1 Freeze — Field-Proven Baseline (2026-05-24)

Tier 1 is **COMPLETE**, **FIELD-PROVEN**, and **FROZEN**. This document is the authoritative boundary between locked Tier 1 and additive Tier 2 work.

**Principle:** Stability, predictability, field reliability, and rollback safety override feature velocity, optimization, and architectural experimentation.

---

## Locked Tier 1 systems (immutable unless explicitly approved)

| Domain | Scope |
|--------|--------|
| **PWA** | Install shell, service-worker deployment behavior |
| **Map** | `MapCanvas`, `mapStyles`, layer visibility toggles, resize/mount stability |
| **GPS** | Raw fix acquisition via `watchPosition`; fix normalization; dev-only debug hooks |
| **HUD** | Cockpit shell, panel dock/float geometry, interaction shielding |
| **Offline baseline** | Tier 1 layer stack availability; bounded prefetch; no Tier 1 network dependency |
| **Safety** | SOS sustained slide (3s), rescue packet build/post/dispatch, deadman panel UX |
| **Deploy** | `vite.config.ts`, `index.html`, build/runtime entry structure |
| **Edge** | `supabase/functions/send-rescue-email` contract |
| **Reference** | `src/tier1-hud.html` (SHA-256 locked) |

### Immutable behavior truths (stability contract)

- Raw GPS is the source of truth in production HUD
- SOS requires ~3s sustained slide (`HOLD_MS = 3000`)
- Mission corridor **width constant** remains 2-mile total (5280 ft half-width) — see `tier1Contract`
- Tier 1 reference has zero network I/O; production rescue paths are explicit Tier 1 infrastructure
- Panel/map baseline from `src/.cursorrules` § STABLE PANEL + MAP BASELINE must not regress

---

## Explicitly excluded from Tier 1 freeze (Tier 2 active development)

These systems **must not** be treated as frozen Tier 1. They may change freely provided they remain **additive** and do not replace Tier 1 core behavior.

| Capability | Primary paths |
|------------|----------------|
| Waypoint progression / arrival confirmation | `src/lib/waypointNavigation.ts`, `src/hud/WaypointTypePanel.tsx` |
| Corridor-aware navigation | `src/hooks/useCorridorOffline.ts`, `src/lib/corridorPrefetch.ts` |
| Off-route detection | `src/lib/offRoute.ts` |
| Trail-aware distance | `src/lib/trailRoute.ts` |
| Snap-to-trail runtime | `src/lib/snapToTrail.ts` |
| Route / waypoint map layers | `src/layers/RouteLayer.tsx`, `src/layers/WaypointLayer.tsx` |
| Navigation HUD / monitor | `src/hud/NavigationHud.tsx`, `src/hooks/useNavigationMonitor.ts` |
| GPS confidence heuristics | `src/lib/gpsConfidence.ts` |
| Environmental / predictive routing | Tier 2+ specs (not in Tier 1 manifest) |

Programmatic registry: `src/lib/tier1FreezeBoundaries.ts`.

---

## Safeguards (regression prevention)

| Guard | Purpose |
|-------|---------|
| `npm run verify:tier1` | Reference hash + invariants + production baseline manifest |
| `tier1-baseline.manifest.json` | Rollback-safe SHA-256 snapshot of locked production files |
| `src/lib/tier1Contract.ts` | Reference HTML + SOS hold + corridor width invariants |
| `src/lib/tier1Freeze.ts` | Manifest audit (CI / vitest) |
| `.cursor/rules/tier1-freeze.mdc` | Agent hard gate before editing locked paths |
| `.cursor/rules/stability-audit-layer.mdc` | Mandatory SYSTEM AUDIT REPORT on behavior-touching work |

### Changing locked Tier 1 (requires explicit approval)

1. State which locked system and why (field defect or approved migration)
2. Update `tier1-baseline.manifest.json` **in the same change set** if production baseline files change
3. Update `src/lib/tier1Contract.ts` + `src/.cursorrules` if reference `tier1-hud.html` changes
4. Produce SYSTEM AUDIT REPORT with decision **SAFE TO DEPLOY** or **NEEDS REVIEW**

### Rollback path

- **Reference restore:** revert `src/tier1-hud.html` to manifest `reference.sha256`
- **Production restore:** revert files listed in `tier1-baseline.manifest.json` `production` to recorded hashes
- **Git:** restore workspace to commit tagged at freeze (`tier1-field-proven-2026-05-24`) or last passing `verify:tier1` commit

---

## Tier 2 additive rule

Tier 2 work **builds on top of** Tier 1. It must not:

- Replace raw GPS truth with trail/snap coordinates in core fix readout
- Introduce Tier 1 network dependencies
- Merge Tier 2 navigation state into Tier 1 safety dispatch without explicit approval
- Refactor locked Tier 1 files for convenience

---

## Related docs

- `TIER1_HARDENING.md` — pre-merge gates and reference vs production table
- `src/.cursorrules` — architecture tiers, drift policy, panel/map baseline
- `SMOKE_TESTS.md` — field smoke checklist

**Freeze status:** ACTIVE — Tier 2 development may proceed only with Tier 1 guards passing.
