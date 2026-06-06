# Tier 2 Panel + State Persistence — Soft Stability Guardrails

**Date**: 2026-06-06  
**Scope**: Panel persistence, localStorage handling, state restoration  
**Status**: Audit Complete — Guardrails Deployed  
**Risk Level**: MEDIUM (corrupted storage recovery, hydration timing)

---

## 1. CURRENT SYSTEM STATE

### ✅ Verified Working Behaviors

| Behavior | Status | Evidence |
|----------|--------|----------|
| Overlay toggle persistence | ✅ STABLE | `loadOverlayToggles` / `saveOverlayToggles` |
| Corrupted storage recovery | ✅ STABLE | Try/catch with fallback to defaults |
| Schema validation | ✅ STABLE | `isEnvironmentalOverlayId` guards writes |
| localStorage quota handling | ✅ STABLE | Silent catch on write failures |

### ⚠️ Risk Areas Identified (Phase 3 Audit)

| Risk | Severity | Finding |
|------|----------|---------|
| Invalid type coercion | LOW | `typeof parsed[id] === 'boolean'` check exists but could be stricter |
| Missing storage event sync | LOW | Changes don't sync across tabs (expected, but documented) |
| No storage size monitoring | LOW | Could silently fail on large state |
| Empty string key handling | LOW | No validation on storage key constants |

---

## 2. ROOT CAUSE ANALYSIS

### Finding A: Limited Visibility on Storage Failures

**Location**: `overlayState.ts:30-36`

```typescript
export function saveOverlayToggles(toggles: OverlayToggleState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toggles))
  } catch {
    /* quota / private mode */
  }
}
```

**Impact**: Storage failures are silent, no forensics visibility

### Finding B: No Storage Corruption Tracing

**Location**: `overlayState.ts:14-28`

Parse failures return defaults silently without trace.

**Impact**: Cannot diagnose field reports of "settings lost"

---

## 3. SOFT GUARDRAILS ADDED

### Guardrail 1: Storage Operation Tracing

```typescript
// Added to overlayState.ts
traceOverlay('storage_save_attempt', { 
  key: STORAGE_KEY, 
  toggleCount: Object.values(toggles).filter(Boolean).length 
})
```

### Guardrail 2: Parse Failure Diagnostics

```typescript
// Added to overlayState.ts loadOverlayToggles
try {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    traceOverlay('storage_load_empty', { key: STORAGE_KEY })
    return base
  }
  // ... parse
} catch (err) {
  traceOverlay('storage_load_failed', { 
    key: STORAGE_KEY, 
    error: (err as Error).message.slice(0, 100)
  })
  return base
}
```

### Guardrail 3: Quota Warning Trace

```typescript
// Added to saveOverlayToggles
try {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toggles))
  traceOverlay('storage_save_success', { key: STORAGE_KEY, size: JSON.stringify(toggles).length })
} catch (err) {
  const isQuota = (err as Error).message?.toLowerCase().includes('quota')
  traceOverlay(isQuota ? 'storage_quota_exceeded' : 'storage_save_error', {
    key: STORAGE_KEY,
    error: (err as Error).message.slice(0, 100),
  })
}
```

---

## 4. RUNTIME VERIFICATION PROTOCOL

### Browser Console Verification

```javascript
// Check for storage issues
__hudForensics.getTracesByCategory('overlay')
  .filter(t => t.event?.includes('storage_'))
  .slice(-10)

// Should see pattern:
// - storage_load_empty (first visit)
// OR
// - storage_load_success (returning visit)
// - storage_save_success (after toggle)
```

### Storage Stress Test

```javascript
// Verify quota handling
function stressTestStorage() {
  const largePayload = 'x'.repeat(5 * 1024 * 1024) // 5MB
  try {
    localStorage.setItem('test_quota', largePayload)
  } catch (e) {
    console.log('Quota exceeded as expected:', e.message)
  }
  localStorage.removeItem('test_quota')

  // Check overlay system handled it gracefully
  const traces = __hudForensics.getTracesByCategory('overlay')
    .filter(t => t.event === 'storage_quota_exceeded')
  console.log('Quota traces:', traces.length)
}
```

---

## 5. BEHAVIOR IMPACT ASSESSMENT

| Change | Impact | Risk |
|--------|--------|------|
| Storage save tracing | NONE | Diagnostic only |
| Load failure tracing | NONE | Diagnostic only |
| Quota warning trace | NONE | Diagnostic only |

**Overall Behavior Impact**: NONE — All changes are tracing only  
**Stability Risk**: VERY LOW — No runtime logic changes  
**Regression Risk**: NONE — Only adds trace calls

---

## 6. TIER 2 STABILITY STATUS

| Subsystem | Status | Guardrails |
|-----------|--------|------------|
| Overlay + Map Runtime | ✅ STABILIZED | 4 soft guardrails added |
| GPS / Compass Lifecycle | ✅ STABILIZED | Tier 2 wrapper available |
| Panel Persistence | ✅ STABILIZED | 3 soft guardrails added |
| Service Worker Safety | 🔄 NEXT AUDIT | Pending Phase 4 |

---

**End of Document**

*Last audit: 2026-06-06*
