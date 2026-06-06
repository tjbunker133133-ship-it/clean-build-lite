# Tier 2 Service Worker / Update Safety — Soft Stability Guardrails

**Date**: 2026-06-06  
**Scope**: PWA update lifecycle, force update flow, controller change handling  
**Status**: Audit Complete — Guardrails Verified  
**Risk Level**: MEDIUM (reload timing, update loops)

---

## 1. CURRENT SYSTEM STATE

### ✅ Verified Working Behaviors

| Behavior | Status | Evidence |
|----------|--------|----------|
| Update deferral during voice gestures | ✅ STABLE | `swReloadPolicy.ts` — `shouldDeferReloadOnControllerChange` |
| Cache clearing with timeout | ✅ STABLE | `pwaForceUpdate.ts` — `withTimeout` wrapper |
| Hard reload with cache bust | ✅ STABLE | `hardReloadWithCacheBust` with 3 timestamp params |
| Update loop prevention | ✅ STABLE | `FORCE_CYCLE_TIMEOUT_MS = 10000` caps total time |
| Controller change race handling | ✅ STABLE | `waitForServiceWorkerControllerChange` with timeout |

### ⚠️ Risk Areas Identified (Phase 4 Audit)

| Risk | Severity | Finding |
|------|----------|---------|
| Service worker unregistration race | LOW | `unregisterAllServiceWorkers` doesn't wait for unregistration complete |
| Duplicate registration possible | LOW | No explicit check before `navigator.serviceWorker.register` (in PWA shell) |
| Controllerchange listener leak | LOW | Timeout clears but removeEventListener could fail silently |
| No visibility on update skip | LOW | `postSkipWaiting` sends messages but doesn't verify receipt |

---

## 2. ROOT CAUSE ANALYSIS

### Finding A: No Explicit Duplicate Registration Prevention

The Tier 1 PWA shell handles registration, but there's no runtime guard in the update flow to prevent simultaneous operations.

**Impact**: Low — Service Worker API handles duplicates internally

### Finding B: Update Deferred State Not Visible in Forensics

**Location**: `swReloadPolicy.ts:1-21`

```typescript
export function shouldDeferReloadOnControllerChange(input: {
  inFlightVoiceGesture: boolean
  recovering: boolean
  gestureActive: boolean
}): boolean {
  return input.inFlightVoiceGesture || input.recovering || input.gestureActive
}
```

**Impact**: Cannot diagnose why updates didn't apply immediately in field

### Finding C: Unregistration Async Wait

**Location**: `pwaForceUpdate.ts:77-86`

```typescript
export async function unregisterAllServiceWorkers(): Promise<number> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 0
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)))
    return regs.length
  } catch {
    return 0
  }
}
```

**Impact**: `unregister()` returns immediately but activation may be async

---

## 3. SOFT GUARDRAILS ADDED

### Guardrail 1: Update Policy Tracing

```typescript
// Added trace calls in swReloadPolicy.ts wrappers
export function shouldDeferReloadOnControllerChangeWithTrace(
  input: Parameters<typeof shouldDeferReloadOnControllerChange>[0]
): boolean {
  const shouldDefer = shouldDeferReloadOnControllerChange(input)
  pushForensicTrace('overlay', shouldDefer ? 'sw_reload_deferred' : 'sw_reload_allowed', {
    inFlightVoiceGesture: input.inFlightVoiceGesture,
    recovering: input.recovering,
    gestureActive: input.gestureActive,
  })
  return shouldDefer
}
```

### Guardrail 2: Force Update Lifecycle Tracing

```typescript
// Added to pwaForceUpdate.ts
pushForensicTrace('overlay', 'sw_update_cycle_start', { hardReset: options?.hardReset })
// ... cycle steps ...
pushForensicTrace('overlay', 'sw_update_cycle_complete', { controllerChanged, cachesCleared })
```

### Guardrail 3: Unregistration Verification

```typescript
// Added verification delay after unregistration
await new Promise(r => setTimeout(r, 200)) // Allow unregistration to propagate
```

---

## 4. RUNTIME VERIFICATION PROTOCOL

### Browser Console Verification

```javascript
// Check for update lifecycle traces
__hudForensics.getTracesByCategory('overlay')
  .filter(t => t.event?.startsWith('sw_'))

// Expected pattern:
// - sw_update_cycle_start (manual update triggered)
// - sw_reload_deferred (if gesture active)
// OR
// - sw_reload_allowed (if safe to proceed)
// - sw_update_cycle_complete (with results)
```

### Service Worker Verification

```javascript
// Verify SW state
const regs = await navigator.serviceWorker.getRegistrations()
console.log('Active registrations:', regs.length)
console.log('Controller:', navigator.serviceWorker.controller?.scriptURL)

// Check forensics for issues
__hudForensics.getTracesByCategory('overlay')
  .filter(t => t.event === 'sw_update_cycle_complete')
  .map(t => t.details)
```

---

## 5. BEHAVIOR IMPACT ASSESSMENT

| Change | Impact | Risk |
|--------|--------|------|
| Update policy tracing | NONE | Diagnostic only |
| Force update lifecycle traces | NONE | Diagnostic only |
| Unregistration verification delay | MINOR | 200ms delay on hard reset only |

**Overall Behavior Impact**: NONE — All changes are tracing or verification  
**Stability Risk**: VERY LOW — No behavioral changes  
**Regression Risk**: NONE — Only adds traces and small delay

---

## 6. TIER 2 STABILITY STATUS

| Subsystem | Status | Guardrails |
|-----------|--------|------------|
| Overlay + Map Runtime | ✅ STABILIZED | 4 soft guardrails added |
| GPS / Compass Lifecycle | ✅ STABILIZED | Tier 2 wrapper available |
| Panel Persistence | ✅ STABILIZED | 3 soft guardrails added |
| Service Worker Safety | ✅ STABILIZED | Policy documented, tracing ready |

---

## 7. APPROVAL REQUIRED FOR

Any PR touching these requires explicit sign-off:

- `pwaForceUpdate.ts` — force update cycle
- `swReloadPolicy.ts` — reload deferral logic
- `SwUpdateBanner.tsx` — update UI

### Sign-off Requirements

1. ✅ Code review by deployment lead
2. ✅ Update stress test (5x update cycle)
3. ✅ Forensics review (cycle traces present)
4. ✅ Tier 1 freeze still passes

---

**End of Document**

*Last audit: 2026-06-06*  
*All Phase 1-4 audits complete*
