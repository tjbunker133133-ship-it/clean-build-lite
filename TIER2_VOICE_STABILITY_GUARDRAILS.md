# Tier 2 Voice Subsystem — Soft Stability Guardrails

**Date**: 2026-06-06  
**Scope**: HUD Voice (Wake/Command/TTS) — NOT Mission Voice Messaging  
**Status**: Field-Tested Stable on Android

---

## 1. CURRENT WORKING CONTRACT

### ✅ Verified Working Behaviors (Android Field Test)

| Behavior | Status | Verification |
|----------|--------|--------------|
| Wake acknowledgment ("Yes.") | ✅ STABLE | Audible on Android |
| Weather command | ✅ STABLE | Clean execution |
| Situation command | ✅ STABLE | Long-form TTS completes |
| Satellite map alias | ✅ STABLE | "sat map" works |
| Outdoor map alias | ✅ STABLE | "outdoor map" works |
| Base map switching | ✅ STABLE | Confirmed |
| No "unknown command 135" | ✅ STABLE | Numeric rejection active |
| No replay-loop contamination | ✅ STABLE | Post-command reset works |
| Two-lane TTS | ✅ STABLE | Minimal path default |
| Minimal TTS on Android | ✅ STABLE | Audio context preserved |

### ⚠️ Known Acceptable Limitations

| Limitation | Status | Notes |
|------------|--------|-------|
| Wake acquisition repeat | ⚠️ ACCEPTABLE | May require 2-3 "HUD" attempts |
| "H-U-D" vs "HUD" inconsistency | ⚠️ ACCEPTABLE | SR-dependent, not code issue |
| Power save mode latency | ⚠️ ACCEPTABLE | 14s restart gap on tablet |

**These are NOT to be solved in Tier 2 stabilization.**

---

## 2. FORBIDDEN REGRESSION CATEGORIES

### 🚫 ABSOLUTELY FORBIDDEN

These are **hard stop** regressions that must block deployment:

| Regression | Why Forbidden | Detection |
|------------|-------------|-----------|
| Transcript replay | Causes duplicate command execution | Forensics: `command_matched` 2x for same utterance |
| Continuation contamination | Post-command noise processed as new command | Forensics: `continuation_rejected_*` missing |
| Android silent TTS | User response path broken | Android field test: no audio |
| Duplicate command execution | Same command runs twice | Forensics: `handler_resolved` 2x per utterance |
| Runaway unknown command loops | Numeric/fragment noise floods | Console: repeated "Unknown command" |
| Command alias removal | Breaks user workflow | Voice test: alias fails |
| Minimal TTS path bypass | Reintroduces cancel+delay pattern | Code review: `speakHudPhrase` for user response |
| Mission voice cross-contamination | Isolation breach | Code review: shared state with mission voice |

### ⚠️ REQUIRES EXPLICIT APPROVAL

These changes need runtime verification before deployment:

| Change Category | Approval Required From |
|-----------------|------------------------|
| Wake word sensitivity tuning | Voice regression test on Android |
| Continuation window timing | Forensics verification |
| TTS rate/pitch changes | Android audio context test |
| New command aliases | Voice test checklist |
| transcript normalization changes | Full regression checklist |

---

## 3. ARCHITECTURE INVARIANTS (DO NOT VIOLATE)

### Two-Lane TTS Architecture

```
USER RESPONSE LANE (Default)
├── Trigger: Normal HUD commands (weather, situation, map, etc.)
├── Path: speakHandsFree() → speakMinimal()
├── Constraints:
│   ├── NO speechSynthesis.cancel()
│   ├── NO setTimeout before speak()
│   ├── NO authority controller priority queue
│   └── Direct utterance → speak() only
└── Preserves: Android audio context

SYSTEM INTERRUPT LANE (Emergency only)
├── Trigger: SOS, emergency alerts, safety-critical
├── Path: speakHandsFree({emergency: true}) → authority controller
├── Allowed:
│   ├── cancel() for priority override
│   └── Priority queue management
└── Requires: Explicit emergency flag
```

### Command Processing Pipeline

```
STT Final Transcript
    ↓
normalizeVoiceTranscript()
    ↓
stripWakeAckEchoFromContinuation()
    ↓
stripRepeatedWakePrefix()
    ↓
stripTrailingFragmentRepetition()  ← REPLAY PROTECTION
    ↓
cleanCommandPhrase()
    ↓
DISPATCH (one command only)
    ↓
POST-COMMAND RESET:
    ├── pendingWakeUntilRef = null
    ├── ignoreSrUntilRef = now + 500ms
    └── traceVoice('continuation_window_closed')
```

### Post-Command Cleanup Contract

**REQUIRED after EVERY successful command:**

```typescript
// 1. Close continuation window
pendingWakeUntilRef.current = null

// 2. Brief ignore for trailing fragments
ignoreSrUntilRef.current = performance.now() + 500

// 3. Trace for forensics visibility
traceVoice('continuation_window_closed', { reason: 'post_command_reset' })
```

**VIOLATION = regression**

---

## 4. ALLOWED MODIFICATION ZONES

### Safe to Modify (with checklist)

| Zone | Safe Changes | Unsafe Changes |
|------|--------------|----------------|
| `voiceListenProfile.ts` | Timing constants (test on device) | Changing mode semantics |
| `useHudCommands.ts` | Adding new command aliases | Removing existing aliases |
| `normalizeVoiceTranscript.ts` | New cleanup patterns | Removing existing patterns |
| `runtimeForensics.ts` | New trace events | Removing trace calls |
| `voiceRegressionDebug.ts` | New debug flags | Changing default values |
| Command handlers | New command implementations | Changing dispatch contract |

### Danger Zones (approach with extreme caution)

| File | Danger Zone | Why Dangerous |
|------|-------------|---------------|
| `VoicePanel.tsx` | `speakHandsFree()` lane selection | Wrong lane = silent TTS on Android |
| `VoicePanel.tsx` | `parseAndRun()` dispatch loop | Missing cleanup = replay contamination |
| `VoicePanel.tsx` | Continuation window management | Timing changes = wake failures |
| `voiceMinimal.ts` | `speakMinimal()` implementation | Any orchestration = audio context loss |
| `voiceAuthorityController.ts` | `executeTTS()` cancel timing | Cancel+delay = Android silence |

---

## 5. PROTECTED RUNTIME ASSUMPTIONS

### Assumption 1: Minimal Path is Default

```typescript
// CORRECT — always default to minimal for user responses
if (!isSystemInterrupt) {
  return speakMinimal(trimmed)  // ✅ SAFE
}
```

```typescript
// WRONG — bypasses minimal path for user response
await speakHudPhrase(trimmed, rate, VOICE_PRIORITY.USER_COMMAND)  // ❌ DANGER
```

### Assumption 2: No Cancel on User Response Lane

```typescript
// CORRECT — minimal path never cancels
function speakMinimal(text) {
  if (isSpeaking) return { started: false }  // ✅ SKIP, don't cancel
  synth.speak(utterance)  // ✅ DIRECT
}
```

```typescript
// WRONG — cancel breaks Android audio context
synth.cancel()
setTimeout(() => synth.speak(utterance), 50)  // ❌ DANGER
```

### Assumption 3: Fragment Cleanup is Non-Negotiable

```typescript
// REQUIRED — transcript replay protection
cleanedPart = stripTrailingFragmentRepetition(p)  // ✅ REQUIRED
cleanedPart = cleanCommandPhrase(cleanedPart)      // ✅ REQUIRED
```

### Assumption 4: Continuation Window Closes After Command

```typescript
// REQUIRED — prevents contamination
if (commandsExecuted > 0) {
  pendingWakeUntilRef.current = null  // ✅ REQUIRED
  ignoreSrUntilRef.current = performance.now() + 500  // ✅ REQUIRED
}
```

### Assumption 5: Numeric Commands are Invalid

```typescript
// REQUIRED — prevents "unknown command 135"
if (/^\d+$/.test(continuationCmd)) {
  traceVoice('continuation_rejected_numeric')  // ✅ REQUIRED
  return  // ✅ REQUIRED
}
```

---

## 6. MISSION VOICE ISOLATION BOUNDARY

### HUD Voice Scope (this document)

- Wake word detection
- Command parsing
- User response TTS
- Map/layer commands
- Status commands

### Mission Voice Scope (EXCLUDED from this document)

- Device-to-device voice messaging
- Mission chat voice input
- Cross-device voice delivery
- Team comms voice features

### Isolation Contract

| Rule | Enforcement |
|------|-------------|
| HUD voice changes do NOT touch mission voice | Code review |
| Mission voice bugs do NOT block HUD voice deploy | Process |
| Shared TTS API only — no shared state | Architecture |
| Mission voice has separate debug namespace | `__hudMissionVoice` vs `__hudDebug` |

---

## 7. VERIFICATION PROTOCOL

### Pre-Deployment Checklist

```markdown
□ TypeScript: npx tsc --noEmit
□ Tests: npm run verify
□ Build: npm run build
□ Tier 1 freeze: npm run verify:tier1
```

### Voice Regression Checklist (Manual Android Test)

| Test | Command | Expected | Verify |
|------|---------|----------|--------|
| 1 | "HUD" | Audible "Yes." | 🔊 Heard |
| 2 | "HUD weather" | Single response | No replay |
| 3 | "HUD situation" | Long-form completes | Returns idle |
| 4 | "HUD sat map" | Map switches + speech | Both work |
| 5 | "HUD outdoor map" | Map switches + speech | Both work |
| 6 | "HUD flashlight on" | Single execution | No duplicate |
| 7 | Rapid commands (3x) | All execute | No contamination |
| 8 | Background 30s → "HUD" | Wake works | No state corruption |

### Forensics Verification

```javascript
// In browser console after test session:
__hudForensics.getTracesByCategory('voice')
  .filter(t => t.event.includes('replay') || 
               t.event.includes('contamination') ||
               t.event.includes('duplicate'))
  .length === 0  // ✅ Should be 0
```

---

## 8. DOCUMENT OWNERSHIP

| Document | Owner | Update Trigger |
|----------|-------|----------------|
| This guardrail | Voice system lead | After each stabilization pass |
| TIER2_FREEZE_VALIDATION_REPORT.md | QA lead | After freeze validation |
| SMOKE_TEST_CHECKLIST.md | QA lead | New features added |

---

## 9. APPROVAL REQUIRED FOR

### Tier 2 Voice Changes

Any PR touching these requires **explicit sign-off**:

- `VoicePanel.tsx` — any change
- `voiceMinimal.ts` — any change
- `normalizeVoiceTranscript.ts` — logic changes
- `voiceAuthorityController.ts` — execution path changes
- `useHudCommands.ts` — alias changes

### Sign-off Requirements

1. ✅ Code review by voice system lead
2. ✅ Android field test (minimum 20 commands)
3. ✅ Forensics review (no replay/contamination traces)
4. ✅ Regression checklist complete
5. ✅ Tier 1 freeze still passes

---

**End of Document**

*This is a LIVING document. Update when working contract changes.*
*Last field verification: 2026-06-06*
