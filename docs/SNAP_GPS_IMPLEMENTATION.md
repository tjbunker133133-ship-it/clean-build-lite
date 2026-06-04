# Stable Trail Snapping + GPS Reliability

**Status:** Phase 1 foundation (observability + pipeline library). Production snap placement still uses existing `snapToTrail.ts` + MapCanvas contract until Phase 1b wiring is approved.

**Device target:** Samsung Galaxy S25 FE (Android PWA).

---

## 1. Architecture summary

### Current production path (unchanged in Phase 1)

```
watchPosition (useGPS.ts, Tier 1 LOCKED)
  → raw lat/lng/accuracy on map marker + navigation
  → optional waypoint drop (MapCanvas, Tier 1 LOCKED)
       → if snap ON + outdoor + capable:
            findNearestTrailCandidate (snapToTrail.ts, vector tiles only)
       → waypoint stores lat/lng + optional rawLat/rawLng + snapDistanceMeters
```

No routing APIs today. Snapping is **local MapLibre geometry only** (offline-friendly when vector tiles are loaded).

### Target architecture (phased)

```
┌─────────────────────────────────────────────────────────────┐
│ RAW TRACK (ground truth, never overwritten)                  │
│  lat, lng, accuracy, heading?, speed?, timestamp             │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ GPS QUALITY GATE (gpsQualityGate.ts)                         │
│  reject/defer + logged reasons                               │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ MOTION SMOOTHING (optional, Phase 2 — no fake magic)         │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ SNAP PROVIDER (snapProvider.ts)                              │
│  maplibre-local (today) | osrm | graphhopper | valhalla …    │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ SNAP VALIDATION (snapValidation.ts)                        │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ SNAPPED TRACK (separate store — snapTrackStore.ts)           │
│  snappedLat/Lng, confidence, distance, provider, road name   │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
         render / navigation assist (never replaces raw marker)
```

**Module home:** `src/lib/snapTrack/` (Tier 2).

**Observability:** `snapDiagnostics.ts` → `runtimeSnapshot.snapGps` → Runtime debug overlay (Alt+Shift+D).

---

## 2. Risk analysis

| Risk | Level | Mitigation |
|------|-------|------------|
| Breaking Tier 1 GPS | HIGH | Do not edit `useGPS.ts` without explicit approval |
| Breaking MapCanvas snap contract | HIGH | Phase 1b instrumentation only; pipeline opt-in |
| Network snap provider outage | MEDIUM | Fail open to raw; queue + timeout (Phase 2) |
| Async race / stale snap | MEDIUM | Monotonic request ids in `snapPipeline.ts` |
| Provider lock-in | LOW | `SnapProvider` interface; one file per provider |
| Battery / Android throttle | MEDIUM | Defer snaps when gate rejects; no polling loops |
| Offline vector tiles missing | MEDIUM | Capability fails closed today; breadcrumb raw mode |

---

## 3. Files (Phase 1)

| Path | Role |
|------|------|
| `src/lib/snapTrack/types.ts` | Dual-track types |
| `src/lib/snapTrack/gpsQualityGate.ts` | Pre-snap validation |
| `src/lib/snapTrack/snapValidation.ts` | Post-snap validation |
| `src/lib/snapTrack/snapProvider.ts` | Provider interface + stubs |
| `src/lib/snapTrack/mapLibreTrailProvider.ts` | Wraps existing `snapToTrail` |
| `src/lib/snapTrack/snapPipeline.ts` | Ordered pipeline + stale cancel |
| `src/lib/snapTrack/snapTrackStore.ts` | In-memory dual buffers |
| `src/lib/snapTrack/snapDiagnostics.ts` | Metrics + localStorage + snapshot bridge |
| `src/lib/snapTrack/fixtures/*.json` | Replay logs |
| `src/hooks/useNavigationMonitor.ts` | Raw GPS ingest → diagnostics only |
| `src/runtime/runtimeSnapshot.ts` | `snapGps` snapshot slice |
| `src/runtime/RuntimeDebugOverlay.tsx` | Debug section |

**Phase 1b (implemented):** `MapCanvas.tsx` — post-commit `observeWaypointDropAfterCommit()` (Tier 1 placement unchanged).

Feature flags (Vite env):

| Flag | Default | Effect |
|------|---------|--------|
| `VITE_ENABLE_SNAP_PIPELINE` | `false` | Async pipeline compare/validate after drop |
| `VITE_ENABLE_SNAP_VALIDATION` | `true` | Pipeline vs tier1 validation logging |
| `VITE_ENABLE_SNAP_DIAGNOSTICS` | `true` | Structured drop logs + overlay |

**Phase 2:** Network providers, queued retries, breadcrumb polyline from `snapTrackStore`.

---

## 4. Rollback steps

1. Revert commit(s) touching `src/lib/snapTrack/`, `useNavigationMonitor.ts`, `runtimeSnapshot.ts`, `RuntimeDebugOverlay.tsx`.
2. Remove `snapGps` from snapshot if partially merged.
3. Clear diagnostic storage: `localStorage.removeItem('hud_snap_gps_diag_v1')`.
4. Run `npm run verify:tier1` — Tier 1 hashes must match manifest.
5. No migration required (additive only).

---

## 5. Known limitations

- **Heading / speed** not exposed from `useGPS` yet; gate skips heading/speed rules when absent.
- **Live snap pipeline** not wired to MapCanvas (diagnostics + library only).
- **Network routing** providers are stubs (`disabled` / not configured).
- **Breadcrumb trail polyline** from dual store not rendered yet.
- **Motion smoothing** not implemented (intentionally deferred).

---

## 6. Remaining technical debt

- Phase 1b: MapCanvas instrumentation + `runSnapPipeline` on waypoint drop.
- Extend `GPSData` with timestamp, heading, speed (Tier 1 change).
- OSRM/GraphHopper/Valhalla adapters behind env-configured endpoints.
- Replay harness UI for field logs.
- Confidence calibration vs. MapTiler outdoor zoom/classes.

---

## 7. Test checklist (field + CI)

- [ ] Stationary: gate rejects duplicate / sub-threshold movement
- [ ] Urban canyon: high accuracy variance → defer snap, raw marker stable
- [ ] Weak GPS: accuracy > 30 m → reject with `accuracy_poor`
- [ ] Rapid heading change (when heading available): defer
- [ ] Walking speed: snaps within 30 m only on outdoor vector
- [ ] Highway: rejected road classes in `snapToTrail` (no motorway snap)
- [ ] Offline: vector cached → local snap; no network required
- [ ] Airplane mode: raw breadcrumb mode, no UI freeze
- [ ] Background/foreground: GPS recovery states in overlay
- [ ] Replay: `snapPipeline.replay.test.ts` from fixture JSON

CI: `npm test` includes `src/lib/snapTrack/*.test.ts`.

---

## 8. Failure scenarios handled (library)

| Scenario | Behavior |
|----------|----------|
| Poor accuracy | Gate reject, raw preserved |
| GPS jump | Gate reject `excessive_jump` |
| Stale fix | Gate reject `stale_timestamp` |
| Snap too far from raw | Validation reject, raw kept |
| Low confidence | Validation reject |
| Provider timeout | Pipeline returns raw fallback (Phase 2 queue) |
| Stale async response | Ignored via monotonic request id |
| Snap disabled / raster basemap | Provider unavailable → raw |

---

## 9. Performance impact estimate

| Area | Impact |
|------|--------|
| Navigation monitor | +1 lightweight ingest per GPS fix change (~O(1)) |
| localStorage | Rolling 40 events, ~4–8 KB max |
| Snap pipeline (when wired) | Bounded segment eval (existing 500 cap in snapToTrail) |
| Network providers (future) | Debounced queue; max 1 in-flight per track |

**Phase 1 production path:** No measurable map/GPS behavior change.

---

## Success criteria mapping

| Criterion | Phase 1 | Later |
|-----------|---------|-------|
| Raw GPS survives | Yes (unchanged) | — |
| Stable snapped trails | Partial (existing MapCanvas) | Pipeline + store |
| No teleporting | Validation library ready | Wire + tune |
| Responsive UI | No blocking added | — |
| Graceful degradation | Gate + diagnostics | Queue/offline |
| Diagnosable bugs | Overlay + persisted log | Replay UI |

---

## Forbidden behaviors (enforced by review)

- No rewrite of `useGPS.ts` in Phase 1
- No mixing snap coords into raw GPS state
- No silent error swallowing in `snapDiagnostics`
- No infinite retry loops in pipeline
