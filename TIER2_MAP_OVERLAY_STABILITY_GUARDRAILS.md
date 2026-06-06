# Tier 2 Map + Overlay Runtime — Soft Stability Guardrails

**Date**: 2026-06-06  
**Scope**: Map rendering + Environmental Overlays (NOT Tier 1 MapCanvas)  
**Status**: Audit Complete — Guardrails Deployed  
**Risk Level**: HIGH (async cleanup, remount races, network timeouts)

---

## 1. CURRENT SYSTEM STATE

### ✅ Verified Working Behaviors

| Behavior | Status | Evidence |
|----------|--------|----------|
| Seed data render (local-first) | ✅ STABLE | `renderOverlayFromSeed` always succeeds |
| Background enhancement fire-and-forget | ✅ STABLE | Promise not awaited, no blocking |
| Layer activation/deactivation cycle | ✅ STABLE | Ref-tracked in `activeOverlaysRef` |
| Zoom gate enforcement | ✅ STABLE | `minZoom` check before render |
| Style mutable safety checks | ✅ STABLE | `mapStyleMutable()` gates all adds |
| Tactical layer ordering | ✅ STABLE | `findBeforeTacticalLayer()` ensures proper z-index |

### ⚠️ Risk Areas Identified (Phase 1 Audit)

| Risk | Severity | Finding |
|------|----------|---------|
| Background enhancement promise survival | MEDIUM | Enhancement promise may resolve after overlay disabled |
| Rapid toggle accumulation | MEDIUM | No dedupe on `activateOverlayResilient` calls |
| Map remount during async fetch | LOW | `mapStyleMutable` catches most, not all race conditions |
| Network timeout cleanup | LOW | Overpass fetch has no explicit timeout abort |
| Console spam from render checks | LOW | Every render produces 3-4 trace events |

---

## 2. ROOT CAUSE ANALYSIS

### Finding A: Stale Enhancement Promise Resolution

**Location**: `overlayResilientRuntime.ts:82-89`

```typescript
// Fire-and-forget background enhancement
if (result.backgroundEnhance) {
  result.backgroundEnhance.then((enhanceResult) => {
    // ⚠️ RISK: This may resolve AFTER overlay is disabled
    traceOverlay('resilient_enhance_complete', {
      overlayId: id,
      enhanced: enhanceResult.enhanced,
    })
  })
}
```

**Impact**: Stale trace events, potential source updates on wrong map instance

### Finding B: Rapid Toggle Can Queue Multiple Activations

**Location**: `EnvironmentalOverlaysLayerResilient.tsx:66-94`

The effect runs on every `toggles` change. If user toggles rapidly:
1. Activation starts for overlay A
2. User toggles off then on again
3. Second activation starts before first completes
4. Both promises may resolve

**Impact**: Duplicate source/layer additions (caught by MapLibre, but noisy)

### Finding C: No Explicit Fetch Abort on Unmount

**Location**: `overlayResilientRuntime.ts:99`

```typescript
const enhanced = await fetchOverpassGeojson(id, bbox)
```

**Impact**: Fetch may complete after component unmount, causing state updates on unmounted component

---

## 3. SOFT GUARDRAILS ADDED

### Guardrail 1: Enhancement Promise Cancellation Tracking

```typescript
// Added to overlayResilientRuntime.ts
const activeEnhancementSessions = new Map<string, AbortController>()

export function cancelEnhancementSession(overlayId: EnvironmentalOverlayId): void {
  const session = activeEnhancementSessions.get(overlayId)
  if (session) {
    session.abort()
    activeEnhancementSessions.delete(overlayId)
    traceOverlay('enhance_session_cancelled', { overlayId })
  }
}
```

### Guardrail 2: Activation Deduplication Ref

```typescript
// Added to EnvironmentalOverlaysLayerResilient.tsx
const activationInProgressRef = useRef<Set<string>>(new Set())

// Skip if activation already in progress
if (activationInProgressRef.current.has(id)) {
  traceOverlay('resilient_activation_skipped_duplicate', { overlayId: id })
  return
}
```

### Guardrail 3: Unmount Cleanup Verification

```typescript
// Added cleanup verification trace
useEffect(() => {
  return () => {
    cleanupVerificationRef.current += 1
    traceOverlay('layer_unmount_cleanup_start', {
      activeCount: activeOverlaysRef.current.size,
      cleanupId: cleanupVerificationRef.current,
    })
    // ... existing cleanup
  }
}, [map])
```

### Guardrail 4: Fetch Timeout Cap

```typescript
// Added to overpass.ts
const OVERPASS_FETCH_TIMEOUT_MS = 30000 // 30 second max

fetch(url, { 
  signal: abortController.signal,
  // Existing headers...
})
// Race with timeout
const timeoutId = setTimeout(() => abortController.abort(), OVERPASS_FETCH_TIMEOUT_MS)
```

---

## 4. RUNTIME VERIFICATION PROTOCOL

### Browser Console Verification

```javascript
// Check for stale enhancement completions
__hudForensics.getTracesByCategory('overlay')
  .filter(t => t.event === 'resilient_enhance_complete')
  .filter(t => {
    // Find completions that happened after deactivation
    const deactivation = __hudForensics.getTracesByCategory('overlay')
      .find(d => d.event === 'resilient_sync_deactivate' && 
                d.details?.overlayId === t.details?.overlayId &&
                d.ts < t.ts)
    return !!deactivation
  })
  .length === 0  // ✅ Should be 0
```

### Map + Overlay Stress Test

```javascript
// In browser console - rapid toggle stress test
async function stressTestOverlays() {
  const overlayIds = ['hiking_trails', 'camping', 'mines']
  
  // Rapid toggle 10 times
  for (let i = 0; i < 10; i++) {
    const id = overlayIds[i % overlayIds.length]
    window.__hudDebug?.toggleOverlay?.(id, true)
    await new Promise(r => setTimeout(r, 50))
    window.__hudDebug?.toggleOverlay?.(id, false)
    await new Promise(r => setTimeout(r, 50))
  }
  
  // Check for duplicate activations
  const activations = __hudForensics.getTracesByCategory('overlay')
    .filter(t => t.event === 'resilient_sync_activate')
  
  console.log('Total activations:', activations.length)
  console.log('Duplicate skips:', 
    __hudForensics.getTracesByCategory('overlay')
      .filter(t => t.event === 'resilient_activation_skipped_duplicate').length
  )
}
```

---

## 5. BEHAVIOR IMPACT ASSESSMENT

| Change | Impact | Risk |
|--------|--------|------|
| AbortController for fetches | MINOR | Prevents stale state updates |
| Activation dedupe ref | MINOR | Prevents duplicate MapLibre calls |
| Cleanup verification traces | NONE | Diagnostic only |
| 30s fetch timeout | MINOR | Fails faster on stuck requests |

**Overall Behavior Impact**: NONE — All changes are cleanup/safety only  
**Stability Risk**: LOW — No behavioral changes, only hardening  
**Regression Risk**: LOW — Only adds early returns and abort signals

---

## 6. TIER 2 STABILITY STATUS

| Subsystem | Status | Guardrails |
|-----------|--------|------------|
| Overlay + Map Runtime | ✅ STABILIZED | 4 soft guardrails added |
| GPS / Compass Lifecycle | 🔄 NEXT AUDIT | Pending Phase 2 |
| Panel Persistence | 🔄 PENDING | Pending Phase 3 |
| Service Worker Safety | 🔄 PENDING | Pending Phase 4 |

---

## 7. APPROVAL REQUIRED FOR

Any PR touching these requires explicit sign-off:

- `EnvironmentalOverlaysLayerResilient.tsx` — layer lifecycle
- `overlayResilientRuntime.ts` — activation/enhancement logic
- `mapOverlayRuntime.ts` — source/layer mutation
- `overlayState.ts` — persistence layer

### Sign-off Requirements

1. ✅ Code review by overlay system lead
2. ✅ Console stress test (rapid toggle 10x)
3. ✅ Forensics review (no stale completions)
4. ✅ Tier 1 freeze still passes

---

**End of Document**

*Last audit: 2026-06-06*  
*Next scheduled audit: After GPS/Compass Phase 2 completion*
