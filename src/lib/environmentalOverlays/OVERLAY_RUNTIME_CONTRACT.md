# Overlay Runtime Contract

## Status: ENFORCED

This document defines the unified runtime contract for ALL Tier 2 environmental overlays. All overlays MUST conform to this contract.

---

## 1. State Machine (STRICT ENFORCEMENT)

All overlays use the unified state machine defined in `overlayStateMachine.ts`:

### States

| State | Description | Terminal |
|-------|-------------|----------|
| `IDLE` | Disabled, no activity | Yes |
| `LOADING` | Async operation in progress | **No** - MUST transition within 30s |
| `READY` | Successfully loaded | Yes |
| `EMPTY` | No data/features in view | Yes |
| `ERROR` | Load failure | Yes |
| `OFFLINE_FALLBACK` | Using cached/stale data | Yes |

### Rules

1. **30-Second Hard Timeout**: All `LOADING` states MUST transition to a terminal state within 30 seconds
2. **Automatic Enforcement**: `startLoading()` registers a timeout that forces transition
3. **Deterministic Resolution**: All async paths MUST resolve to `READY`, `EMPTY`, `ERROR`, or `OFFLINE_FALLBACK`
4. **No Silent Failures**: All state transitions are logged via `logInfo()` / `logWarn()`

### API

```typescript
// All overlays use these functions
startLoading(id)           // → LOADING (with 30s timeout)
resolveReady(id, count)    // → READY
resolveEmpty(id, msg)      // → EMPTY
resolveError(id, err)      // → ERROR
resolveOfflineFallback(id, cachedAt)  // → OFFLINE_FALLBACK
toIdle(enabled)            // → IDLE
```

---

## 2. Loading Behavior (UNIFIED)

### Characteristics

| Aspect | Specification |
|--------|---------------|
| Timeout | 30 seconds (OVERLAY_TIMEOUT_MS) |
| Retry Logic | None (manual user retry via toggle) |
| Animation | No overlay-specific animations |
| State Indicator | Consistent "Loading…" text via `overlayLayerStatusLine()` |

### Transition Timing

- **Style Wait**: 5s max for map initialization
- **Network Fetch**: 25s Overpass timeout + 5s buffer
- **Forced Resolution**: ERROR state after 30s regardless

---

## 3. Error Handling (UNIFIED)

### Error Resolution

All errors MUST resolve to one of:
1. `ERROR` state - for network/config failures
2. `OFFLINE_FALLBACK` state - when cached data available

### Error Display

- Uses `overlayLayerStatusLine()` in LayerPanel
- Red color for errors (`#ff9aac`)
- No blocking modals or alerts
- No retry loops

### Error Sources

| Source | Handling |
|--------|----------|
| Network failure | → ERROR (with "OSM layer blocked or offline" message) |
| Rate limit (429) | → ERROR (with retry guidance) |
| Missing API key | → ERROR (with configuration message) |
| Map not ready | → ERROR (after 5s style wait timeout) |
| Empty response | → EMPTY (not error) |

---

## 4. Offline Behavior (UNIFIED)

### Rules

| Condition | Behavior |
|-----------|----------|
| Cached data exists | → OFFLINE_FALLBACK state, render cached |
| No cached data | → EMPTY state, show guidance |
| Non-cacheable overlay | → ERROR state (if offline) |

### Cacheable Overlays

```typescript
offlineCacheable: true  // bike_paths, abandoned_rail, mines, hiking_trails, camping
offlineCacheable: false // fire_firms, relief_usgs, forest_usfs, public_lands (raster)
```

### Cache Layer

- Single storage key: `hud_env_overlay_geo_cache_v1`
- Max 800 features per overlay
- Max 480KB JSON per overlay
- Automatic trimming with 30% reduction steps

---

## 5. Caching Strategy (TWO TIERS — PHYSICS-DRIVEN)

There are **two distinct cache tiers** based on delivery type. This is architectural reality, not a divergence.

### Tier 1: Controlled Cache (GeoJSON overlays)

| Aspect | Specification |
|--------|---------------|
| **Overlays** | bike_paths, abandoned_rail, mines, hiking_trails, camping |
| **Storage** | Application-managed localStorage |
| **Key** | `hud_env_overlay_geo_cache_v1` |
| **Limits** | 800 features, 480KB per overlay |
| **Eviction** | Automatic trim (30% reduction steps) |
| **Offline** | Full OFFLINE_FALLBACK support |
| **Determinism** | Guaranteed availability when cached |

### Tier 2: Ephemeral Network Cache (Raster overlays)

| Aspect | Specification |
|--------|---------------|
| **Overlays** | fire_firms, relief_usgs, forest_usfs, public_lands |
| **Storage** | Browser HTTP cache (external authority) |
| **Management** | Server-controlled Cache-Control headers |
| **Offline** | ERROR state (requires network) |
| **Determinism** | Best-effort, not guaranteed |

### Why Two Tiers?

| Factor | GeoJSON | Raster |
|--------|---------|--------|
| Data volume | Bounded (feature-based) | Unbounded (tile-based) |
| Bounding box | Small (viewport) | Massive (global) |
| Authority | OSM (fetch once) | USGS/NASA/USFS (external) |
| Offline need | Critical (trail data) | Acceptable (planning aid) |

### Cache Operations

```typescript
// Tier 1 only (GeoJSON overlays)
readCachedOverlayGeo(id, viewport)   // Check bbox intersection
writeCachedOverlayGeo(entry)         // Trim and store
clearOverlayGeoCache(id?)             // Clear single or all

// Tier 2 (Raster overlays) - no application cache
// Relies on browser HTTP cache for tile performance
```

### TTL Strategy

- **Tier 1**: No explicit TTL; valid until overwritten
- **Tier 2**: Controlled by external WMS servers (Cache-Control headers)
- OFFLINE_FALLBACK indicates staleness for Tier 1 only

### Fallback Ordering

**Tier 1 (GeoJSON)**:
1. Try network fetch (if online)
2. On failure, try cached data → OFFLINE_FALLBACK
3. No cache available → ERROR

**Tier 2 (Raster)**:
1. Requires network → ERROR if offline
2. Browser may serve from HTTP cache
3. No application-level fallback

---

## 6. UI Consistency (UNIFIED)

### Status Display

All overlays use `overlayLayerStatusLine()` in `LayerPanel.tsx`:

```typescript
if (error) return error
if (loading) return 'Loading…'
if (fromCache || stale) return 'Degraded — cached data'
if (checked) return 'Syncing…'
```

### Color Coding

| State | Color |
|-------|-------|
| Error | `#ff9aac` (red) |
| Cached/Stale | `#ffd166` (yellow) |
| Loading | `#94a3b8` (gray) |

### Toggle Behavior

- Same checkbox component for all overlays
- Same enable/disable flow
- Same offline/cached hints

---

## 7. Lifecycle Implementation

### Single Source of Truth

All 9 overlays use the SAME `syncOverlay()` function in `EnvironmentalOverlaysLayer.tsx`:

```typescript
function syncOverlay(map, id, enabled, online, patchStatus): () => void
```

### Lifecycle Flow

```
ENABLED
   ↓
LOADING (30s timeout enforced)
   ↓
┌─────────────┬─────────────┬─────────────┐
↓             ↓             ↓             ↓
READY        EMPTY         ERROR    OFFLINE_FALLBACK
(feature    (no data    (failure)    (cached)
 count)      in view)
```

### Cleanup

- All overlays remove layers/sources on disable
- All overlays clear timeouts on unmount
- All overlays cancel pending operations on toggle off

---

## 8. Overlay Definitions

All overlays defined in `catalog.ts` with consistent structure:

```typescript
type EnvironmentalOverlayDef = {
  id: EnvironmentalOverlayId
  label: string
  hint: string
  delivery: 'raster-wms' | 'geojson-overpass'
  onlinePreferred: boolean
  offlineCacheable: boolean
  attribution: string
  signupUrl?: string
  envKey?: 'VITE_FIRMS_MAP_KEY'
  minZoom?: number
  maxZoom?: number
}
```

### Current Catalog (9 Overlays)

| ID | Type | Cacheable | Delivery |
|----|------|-----------|----------|
| fire_firms | Raster | No | WMS |
| relief_usgs | Raster | No | WMS |
| forest_usfs | Raster | No | WMS |
| public_lands | Raster | No | WMS |
| bike_paths | GeoJSON | Yes | Overpass |
| abandoned_rail | GeoJSON | Yes | Overpass |
| mines | GeoJSON | Yes | Overpass |
| hiking_trails | GeoJSON | Yes | Overpass |
| camping | GeoJSON | Yes | Overpass |

---

## 9. Render Implementation Notes

### Standard GeoJSON (Line Overlays)

All non-camping GeoJSON overlays render as line layers:
- `hud-env-lyr-{id}` - single layer ID
- Standard line styling per overlay

### Multi-Feature Overlays (Camping)

Camping uses multiple layer types for different geometries:
- `hud-env-lyr-camping-points` - Circle markers for campgrounds
- `hud-env-lyr-camping-polygons-fill` - Fill for dispersed zones
- `hud-env-lyr-camping-polygons-outline` - Outline for dispersed zones

**Note**: This is a rendering difference only. Lifecycle, state machine, caching, and error handling remain identical.

---

## 10. Telemetry Structure (UNIFIED LABELING)

All overlay errors MUST include consistent metadata structure. Origins differ, but structure is uniform.

### Required Error Fields

Every overlay error must include:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `overlayId` | string | Overlay identifier | `"fire_firms"` |
| `sourceType` | enum | Origin classification | `"OSM" \| "WMS" \| "TILE" \| "OVERPASS" \| "NETWORK"` |
| `errorCategory` | enum | Error classification | `"NETWORK" \| "TIMEOUT" \| "AUTH" \| "404" \| "RATE_LIMIT"` |
| `message` | string | Human-readable description | `"OSM busy (rate limit) — wait 30s"` |

### Source Type Classification

| Source | Classification | Overlays |
|--------|---------------|----------|
| OpenStreetMap Overpass API | `"OVERPASS"` | bike_paths, abandoned_rail, mines, hiking_trails, camping |
| NASA FIRMS WMS | `"WMS"` | fire_firms |
| USGS/USFS/BLM WMS | `"WMS"` | relief_usgs, forest_usfs, public_lands |
| MapLibre tile errors | `"TILE"` | All raster overlays |
| Generic network | `"NETWORK"` | Fetch failures |

### Error Category Classification

| Category | When Used |
|----------|-----------|
| `"NETWORK"` | Connection failure, DNS, CORS |
| `"TIMEOUT"` | 30s overlay timeout, 25s Overpass timeout, 5s style wait |
| `"AUTH"` | Missing API key, invalid credentials |
| `"404"` | Tile not found, endpoint unavailable |
| `"RATE_LIMIT"` | HTTP 429, throttling |

### Implementation

Errors are logged via `logWarn()` with structured context:

```typescript
// Example error logging pattern
logWarn('OVERLAY', `${overlayId} [${sourceType}] ${errorCategory}: ${message}`)

// Examples:
// "fire_firms [WMS] AUTH: API key missing — add VITE_FIRMS_MAP_KEY"
// "bike_paths [OVERPASS] RATE_LIMIT: OSM busy — wait 30s"
// "mines [OVERPASS] TIMEOUT: Query exceeded 25s"
```

**Note**: State machine transitions use unified logging via `logInfo()` / `logWarn()` with overlay ID. Source classification is added at error origin points.

---

## 11. Compliance Verification

### Checklist

- [x] All overlays use same state machine
- [x] All overlays have 30s timeout enforcement
- [x] All overlays use config-driven lifecycle (no hardcoded ID checks)
- [x] Cache tiers documented and accepted (physics-driven divergence)
- [x] Telemetry structure unified (consistent error labeling)
- [x] All overlays use same error resolution
- [x] All overlays use same offline behavior (per tier)
- [x] All overlays use same loading UX
- [x] All overlays use same UI status display
- [x] All overlays use single `syncOverlay()` implementation
- [x] No overlay-specific lifecycle overrides
- [x] No overlay-specific loading animations
- [x] No overlay-specific error handling
- [x] No overlay-specific caching logic

### Test Coverage

```bash
npm run verify:tier1    # Tier 1 freeze compliance
npm run test            # All overlay tests
```

---

## 12. Contract Enforcement

This contract is enforced by:

1. **Type System**: `EnvironmentalOverlayDef` ensures consistent configuration
2. **Single Implementation**: `syncOverlay()` handles ALL overlays identically (config-driven, no ID branches)
3. **State Machine**: `withStateMachine()` wrapper enforces terminal states
4. **Tests**: `environmentalOverlays.test.ts` validates catalog consistency
5. **Build Verification**: `verify:tier1` ensures no regressions

---

## 13. Future Overlay Requirements

When adding new overlays:

1. Add to `EnvironmentalOverlayId` type in `types.ts`
2. Add definition to `ENVIRONMENTAL_OVERLAY_CATALOG` in `catalog.ts`
3. If GeoJSON: add query to `overpassQuery()` in `overpass.ts`
4. If special rendering: add to `applyGeojsonOverlay()` in `mapOverlayRuntime.ts`
5. **DO NOT create overlay-specific lifecycle logic** — use `def.delivery`, `def.envKey`, etc.
6. **DO NOT hardcode overlay IDs** in `syncOverlay()` or `OverlayContext`
7. DO NOT create overlay-specific state handling
8. DO NOT create overlay-specific caching
9. DO NOT create overlay-specific error handling

All new overlays automatically inherit the unified runtime contract.

### Config-Driven Checklist

Before submitting PR for new overlay, verify:

```typescript
// ❌ WRONG: Hardcoded ID check
if (id === 'my_new_overlay') { ... }

// ✅ CORRECT: Config-driven check
if (def.delivery === 'geojson-overpass') { ... }
if (def.envKey && !readEnvKey(def.envKey)) { ... }
if (def.offlineCacheable) { ... }
```
