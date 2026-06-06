# Voice Subsystem Regression Checklist

**Purpose**: Lightweight verification before any Tier 2 voice deployment  
**Scope**: HUD wake/command/TTS (NOT mission voice)  
**Target**: Android field stability  
**Time Required**: 15-20 minutes

---

## QUICK CHECK (5 min)

Run in terminal:

```bash
npm run verify:tier1    # Must pass
npx tsc --noEmit        # Must pass
npm run build           # Must succeed
```

| Check | Command | Expected | Result |
|-------|---------|----------|--------|
| Tier 1 freeze | `npm run verify:tier1` | ✅ PASS | ⬜ |
| TypeScript | `npx tsc --noEmit` | 0 errors | ⬜ |
| Build | `npm run build` | Success | ⬜ |

**Any failure = STOP. Do not proceed.**

---

## LIVE ANDROID TEST (15 min)

### Setup

1. Deploy to preview URL
2. Open on Android device (Chrome)
3. Tap voice button once to arm
4. Wait for "Yes." acknowledgment

### Test Sequence

#### Test 1: Basic Wake
**Say**: "HUD"  
**Expected**: Audible "Yes." within 2 seconds  
**Pass**: ⬜  
**Notes**: ________________

#### Test 2: Weather Command
**Say**: "HUD weather"  
**Expected**: 
- Single weather response spoken
- No second/unexpected speech
- No "unknown command" error
**Pass**: ⬜  
**Notes**: ________________

#### Test 3: Situation Command (Long-form TTS)
**Say**: "HUD situation"  
**Expected**:
- Full situation report spoken completely
- No interruption mid-speech
- Returns to idle after completion
**Pass**: ⬜  
**Notes**: ________________

#### Test 4: Satellite Map Alias
**Say**: "HUD sat map"  
**Expected**:
- Map switches to satellite
- Spoken confirmation
**Pass**: ⬜  
**Notes**: ________________

#### Test 5: Outdoor Map Alias
**Say**: "HUD outdoor map"  
**Expected**:
- Map switches to outdoor
- Spoken confirmation
**Pass**: ⬜  
**Notes**: ________________

#### Test 6: Flashlight Command
**Say**: "HUD flashlight on"  
**Expected**:
- Executes once
- No "flashlight on flashlight" replay
- No duplicate execution
**Pass**: ⬜  
**Notes**: ________________

#### Test 7: Rapid Command Sequence
**Say**: 
1. "HUD weather"
2. Wait for completion
3. "HUD situation"

**Expected**:
- Both execute cleanly
- No contamination between commands
- No replay of first command during second
**Pass**: ⬜  
**Notes**: ________________

#### Test 8: Background Recovery
1. Minimize app for 30 seconds
2. Return to app
3. **Say**: "HUD"

**Expected**:
- Wake still works
- "Yes." acknowledgment
**Pass**: ⬜  
**Notes**: ________________

---

## FORENSICS VERIFICATION (5 min)

In browser console (on Android device):

```javascript
// Check for regressions
const traces = __hudForensics.getBuffer();

// Should be ZERO of these:
const replays = traces.filter(t => 
  t.event?.includes('replay') || 
  t.event?.includes('duplicate')
);
console.log('Replays:', replays.length);  // Expected: 0

// Should have these (good signs):
const cleanups = traces.filter(t =>
  t.event === 'continuation_window_closed' ||
  t.event === 'command_cleaned'
);
console.log('Cleanups:', cleanups.length);  // Expected: >0

// Should have NO numeric rejections during normal use:
const numericRejections = traces.filter(t =>
  t.event === 'continuation_rejected_numeric'
);
console.log('Numeric rejections:', numericRejections.length);  // Expected: 0 during test
```

| Check | Expected | Result |
|-------|----------|--------|
| Replay traces | 0 | ⬜ |
| Duplicate traces | 0 | ⬜ |
| Cleanup traces | >0 | ⬜ |
| Numeric rejections | 0 (during test) | ⬜ |

---

## FAILURE DECISION MATRIX

| Failure | Severity | Action |
|---------|----------|--------|
| Tier 1 freeze fail | 🔴 BLOCK | Fix and retest |
| TypeScript error | 🔴 BLOCK | Fix and retest |
| Build fail | 🔴 BLOCK | Fix and retest |
| No "Yes." acknowledgment | 🔴 BLOCK | Debug wake path |
| Silent TTS (Android) | 🔴 BLOCK | Check minimal path |
| Duplicate command execution | 🔴 BLOCK | Check cleanup logic |
| Transcript replay | 🔴 BLOCK | Check post-command reset |
| Command contamination | 🔴 BLOCK | Check continuation window |
| Missing alias (sat/outdoor) | 🟡 DEGRADED | Add alias, retest |
| Wake needs 2-3 tries | 🟢 ACCEPTABLE | Known limitation |
| Forensics missing traces | 🟡 DEGRADED | Check instrumentation |

---

## SIGN-OFF

| Role | Name | Date | Result |
|------|------|------|--------|
| Code Review | ________ | ________ | ⬜ PASS / ⬜ FAIL |
| Android Field Test | ________ | ________ | ⬜ PASS / ⬜ FAIL |
| Forensics Review | ________ | ________ | ⬜ PASS / ⬜ FAIL |

**Overall Result**: ⬜ **APPROVED FOR DEPLOY** / ⬜ **BLOCKED**

**Blocker Notes**: _________________________________

---

## VERSION

**Template Version**: 1.0  
**Last Updated**: 2026-06-06  
**Field Verified**: 2026-06-06
