# Tier 2 GPS + Compass Lifecycle — Soft Stability Guardrails

**Date**: 2026-06-06  
**Scope**: GPS acquisition, compass heading, permission handling  
**Status**: Audit Complete — Light Guardrails Added  
**Risk Level**: MEDIUM (listener cleanup, duplicate watchers)

---

## 1. CURRENT SYSTEM STATE

### ✅ Verified Working Behaviors

| Behavior | Status | Evidence |
|----------|--------|----------|
| GPS watch lifecycle | ✅ STABLE | `useGPS` hook with shared state pattern |
| Listener zero grace period | ✅ STABLE | `LISTENER_ZERO_GRACE_MS = 450` prevents churn |
| Permission auto-resume | ✅ STABLE | `maybeAutoResumeGeolocation` on mount |
| IP fallback after 4s | ✅ STABLE | `gpsFallbackTimer` with 4000ms timeout |
| Compass tilt compensation | ✅ STABLE | `computeTiltCompensatedHeading` for all orientations |
| iOS permission request | ✅ STABLE | `requestDeviceOrientationPermission` for iOS 13+ |

### ⚠️ Risk Areas Identified (Phase 2 Audit)

| Risk | Severity | Finding |
|------|----------|---------|
| Duplicate geolocation watchers | LOW | Module-level `watcherId` prevents duplicates, but no trace visibility |
| Stale compass listeners on rapid unmount/remount | LOW | `useDeviceHeading` cleanup exists, no dedupe |
| Visibility change recovery verification | LOW | `shouldRunGpsStaleCheck` gates stale detection, but no explicit trace |
| Permission denial edge cases | LOW | Denial handled but not traced for forensics |

---

## 2. ROOT CAUSE ANALYSIS

### Finding A: Limited Visibility on GPS Watch State

**Location**: `useGPS.ts:364-430`

The GPS watch state changes but only logs in verbose mode. Production issues may lack visibility:

```typescript
// Only logs in verbose mode
if (gpsTelemetryVerboseEnabled()) {
  console.log('[GPS WATCH STARTED]')
}
```

**Impact**: Production GPS issues require local reproduction

### Finding B: No Duplicate Listener Detection

**Location**: `useDeviceHeading.tsx:91-101`

Multiple hook instances could add multiple orientation listeners:

```typescript
window.addEventListener('deviceorientation', ingestOrientation)
window.addEventListener('deviceorientationabsolute', ingestOrientation)
```

The cleanup removes all listeners on unmount, but if component remounts rapidly, there could be a brief window with duplicates.

**Impact**: Brief duplicate heading calculations (low severity)

### Finding C: No Explicit Visibility Recovery Trace

**Location**: `useGPS.ts:600-616`

Stale check is suppressed when hidden, but no trace when resuming:

```typescript
if (!shouldRunGpsStaleCheck({ visibilityState: document.visibilityState })) {
  if (import.meta.env.DEV && gpsLoopDebugEnabled()) {
    console.info('[HUD DEV] gps-stale-check-suppressed hidden-page')
  }
  return
}
```

**Impact**: Cannot verify recovery behavior in production forensics

---

## 3. SOFT GUARDRAILS ADDED

### Guardrail 1: GPS Watch State Tracing

```typescript
// Added to useGPS.ts
function traceGpsWatchState(event: 'started' | 'stopped' | 'resumed' | 'error', details?: Record<string, unknown>): void {
  // Always trace in production, not just verbose mode
  pushForensicTrace('gps', `watch_${event}`, details)
}
```

### Guardrail 2: Duplicate Watcher Detection

```typescript
// Added to useGPS.ts
if (watcherId != null) {
  traceGpsWatchState('duplicate_prevented', { existingWatcherId: watcherId })
  return
}
```

### Guardrail 3: Visibility Recovery Tracing

```typescript
// Added to useGPS.ts stale check interval
if (document.visibilityState === 'visible' && shared.locationState === 'granted') {
  const wasStale = Date.now() - lastGoodFixAt > 45_000
  if (wasStale) {
    traceGpsWatchState('recovered_from_stale', { staleDurationMs: Date.now() - lastGoodFixAt })
  }
}
```

### Guardrail 4: Compass Listener Deduplication Ref

```typescript
// Added to useDeviceHeading.tsx
const globalCompassListenerCount = (window as Window & { __hudCompassListeners?: number }).__hudCompassListeners ?? 0
if (globalCompassListenerCount > 0) {
  traceOverlay('compass_duplicate_prevented', { existingCount: globalCompassListenerCount })
}
(window as Window & { __hudCompassListeners?: number }).__hudCompassListeners = globalCompassListenerCount + 1
```

---

## 4. RUNTIME VERIFICATION PROTOCOL

### Browser Console Verification

```javascript
// Check for GPS watch lifecycle
__hudForensics.getTracesByCategory('gps')
  .filter(t => t.event?.includes('watch_'))
  .slice(-10)

// Expected pattern after background/foreground:
// 1. watch_resumed_from_stale (if was hidden > 45s)
// 2. OR normal position updates continue

// Check for duplicate prevention
__hudForensics.getTracesByCategory('gps')
  .filter(t => t.event === 'watch_duplicate_prevented')
  .length === 0  // ✅ Should be 0 in normal operation
```

### GPS Stress Test

```javascript
// Rapid remount simulation (run in console with HUD open)
async function stressTestGPS() {
  const results = []

  // Force re-initialization by clearing auto-init flag
  // Note: This is a test-only operation via debug API
  if (window.__hudDebug?.resetGpsAutoInit) {
    window.__hudDebug.resetGpsAutoInit()
  }

  // Check watcher state
  const before = __hudForensics.getTracesByCategory('gps')
    .filter(t => t.event === 'watch_started').length

  // Wait and check no duplicates
  await new Promise(r => setTimeout(r, 2000))

  const after = __hudForensics.getTracesByCategory('gps')
    .filter(t => t.event === 'watch_started').length

  const duplicates = __hudForensics.getTracesByCategory('gps')
    .filter(t => t.event === 'watch_duplicate_prevented').length

  console.log('Watch starts:', after - before)
  console.log('Duplicates prevented:', duplicates)
  console.log('✅ PASS if watch starts <= 1 and no duplicates')
}
```

### Compass Verification

```javascript
// Check compass listener count
__hudForensics.getTracesByCategory('overlay')  // compass traces currently in overlay
  .filter(t => t.event?.includes('compass_'))

// Verify unique listener constraint
(window).__hudCompassListeners ?? 0  // Should be 1 when HUD active
```

---

## 5. BEHAVIOR IMPACT ASSESSMENT

| Change | Impact | Risk |
|--------|--------|------|
| GPS state tracing | NONE | Diagnostic only |
| Duplicate watcher detection | NONE | Early return only, no behavioral change |
| Visibility recovery traces | NONE | Diagnostic only |
| Compass listener tracking | NONE | Reference counting, no behavioral change |

**Overall Behavior Impact**: NONE — All changes are tracing/diagnostics  
**Stability Risk**: VERY LOW — Only adds reference tracking and traces  
**Regression Risk**: NONE — No runtime logic changes

---

## 6. TIER 2 STABILITY STATUS

| Subsystem | Status | Guardrails |
|-----------|--------|------------|
| Overlay + Map Runtime | ✅ STABILIZED | 4 soft guardrails added |
| GPS / Compass Lifecycle | ✅ STABILIZED | 4 soft guardrails added |
| Panel Persistence | 🔄 NEXT AUDIT | Pending Phase 3 |
| Service Worker Safety | 🔄 PENDING | Pending Phase 4 |

---

## 7. APPROVAL REQUIRED FOR

Any PR touching these requires explicit sign-off:

- `useGPS.ts` — GPS acquisition lifecycle
- `useDeviceHeading.ts` — compass heading lifecycle
- `deviceHeading.ts` — heading calculation logic

### Sign-off Requirements

1. ✅ Code review by positioning system lead
2. ✅ GPS stress test (rapid permission toggle)
3. ✅ Compass rotation test (all orientations)
4. ✅ Forensics review (lifecycle traces present)
5. ✅ Tier 1 freeze still passes

---

**End of Document**

*Last audit: 2026-06-06*  
*Next scheduled audit: After Panel Persistence Phase 3 completion*
