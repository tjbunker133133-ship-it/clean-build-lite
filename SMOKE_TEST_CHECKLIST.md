# Voice Authority System — Production Smoke Test Checklist

**Deployed:** June 5, 2026  
**Branch:** stable/2026-05-23  
**Commit:** df9abd0

---

## Pre-Test Setup

### Device Preparation
- [ ] Android device charged > 50%
- [ ] Chrome browser updated
- [ ] Volume at 80% (audible TTS)
- [ ] Open DevTools → Console (keep visible)

### Environment
- [ ] Quiet room or headphones
- [ ] Stable internet connection
- [ ] Disable other audio apps

---

## 1. System Boot Test

### Visual Check
- [ ] Navigate to production URL
- [ ] Wait 10 seconds

**Verify:**
- [ ] No white screen after 5 seconds
- [ ] HUD panels visible (map, compass, status)
- [ ] Voice panel accessible
- [ ] No console error spam

**FAIL if:**
- [ ] Blank/white screen
- [ ] "Loading..." stuck > 10s
- [ ] Red console errors repeating
- [ ] Map doesn't render

---

## 2. Voice Core Function Test

### Commands to Speak
Say each command clearly, wait for full response before next:

1. [ ] **"HUD weather"**
   - Expected: Single weather report
   - Listen: No stutter, no repeat
   - Time: ~5-10 seconds

2. [ ] **"HUD status"**
   - Expected: GPS status + pin count
   - Listen: Clean single response
   - Time: ~3-5 seconds

3. [ ] **"HUD time"**
   - Expected: Current time spoken
   - Listen: Quick, clean
   - Time: ~2 seconds

**Verify:**
- [ ] Each triggers exactly ONE TTS response
- [ ] No overlapping speech between commands
- [ ] Each response completes fully
- [ ] No "echo" or repeated phrases

**FAIL if:**
- [ ] Two voices speaking simultaneously
- [ ] Same command triggers twice
- [ ] TTS cuts off mid-sentence (unless interrupted by design)

---

## 3. SAFETY INTERRUPT TEST ⭐ CRITICAL

### Setup
1. [ ] Prepare to speak "HUD weather" (long response)
2. [ ] Have safety trigger ready:
   - Option A: Wearable with heart rate simulation
   - Option B: Emergency button if available
   - Option C: Manual safety trigger in UI

### Execution
1. [ ] Speak: **"HUD weather"**
2. [ ] WHILE weather is speaking:
3. [ ] **IMMEDIATELY trigger safety event**

**Verify (CRITICAL):**
- [ ] Weather speech STOPS within 300ms
- [ ] Safety speech starts instantly
- [ ] NO moment of overlap (even brief)
- [ ] Weather does NOT resume after safety

**FAIL CRITERIA (Any = System Not Ready):**
- [ ] Both voices play simultaneously
- [ ] Weather continues after safety starts
- [ ] Delay > 300ms between stop and safety
- [ ] Weather resumes after safety finishes

---

## 4. Stop Speaking Command Test

### Execution
1. [ ] Speak: **"HUD weather"**
2. [ ] Immediately speak: **"HUD stop speaking"** (or "HUD quiet")

**Verify:**
- [ ] Speech cancels within 300ms
- [ ] No residual TTS continues
- [ ] System remains silent afterward

**FAIL if:**
- [ ] Weather continues playing
- [ ] Delay > 500ms before stop
- [ ] Partial phrase continues

---

## 5. Mission Voice Priority Test

### Setup
- [ ] Enter mission mode (if available)
- [ ] Connect to mission mesh (if available)

### Execution
1. [ ] Hold-to-talk (mission voice)
2. [ ] Speak a test message
3. [ ] WHILE message is sending/confirming:
4. [ ] Speak: **"HUD status"**

**Verify:**
- [ ] Mission voice uses authority system
- [ ] No overlap with HUD commands
- [ ] Safety still overrides mission voice

---

## 6. Overlay + Voice Conflict Test

### Execution
1. [ ] Speak: **"HUD show fire map"**
2. [ ] Wait for overlay to load
3. [ ] Speak: **"HUD status"**
4. [ ] WHILE status is speaking:
5. [ ] Speak: **"HUD hide fire map"**

**Verify:**
- [ ] No TTS duplication from overlay
- [ ] Status completes normally
- [ ] Overlay toggle doesn't affect voice
- [ ] No lag or stuck speech

---

## 7. Long Session Stability Test (5-10 Minutes)

### Random Command Sequence
Repeat this random sequence for 5-10 minutes:

- [ ] "HUD weather"
- [ ] "HUD status"  
- [ ] "HUD time"
- [ ] "HUD stop speaking"
- [ ] Toggle overlay ON
- [ ] Toggle overlay OFF
- [ ] (If available) trigger safety

**Every 2 minutes, check:**
- [ ] TTS response time still < 1s
- [ ] No audio lag or distortion
- [ ] Tab not slowing down
- [ ] No "ghost speech" (delayed playback)

**FAIL if:**
- [ ] Increasing delay over time
- [ ] Memory growth (tab sluggish)
- [ ] Audio quality degrades
- [ ] Commands start failing

---

## 8. Critical Failure Log Template

If ANY failure occurs, document:

```
FAILURE REPORT
===============
Timestamp: [HH:MM:SS]
Command Spoken: [exact phrase]
Device: [Android / iOS / Desktop]
Browser: [Chrome / Safari / etc]

Expected Behavior: [what should have happened]
Actual Behavior: [what actually happened]

Overlap Detected: [YES / NO]
Safety Violation: [YES / NO]
Delay: [measured in ms if possible]

Console Logs: [paste relevant errors]
Audio Recording: [if captured]
```

---

## 9. Final Decision Matrix

### ❌ NOT READY (Block Deployment)
- [ ] ANY overlap detected between two voices
- [ ] Safety interrupt fails to cut off current speech
- [ ] Stop speaking command ineffective
- [ ] Memory degradation observed
- [ ] Mission voice not respecting authority

### ⚠️ FIELD ACCEPTABLE (With Risk Acknowledged)
- [ ] Minor latency < 500ms (but correct ordering)
- [ ] Occasional TTS delay (no safety impact)
- [ ] No safety violations
- [ ] All stop commands work

### ✅ FIELD READY
- [ ] Zero overlap confirmed across all tests
- [ ] Safety interrupt perfect (< 300ms cutover)
- [ ] Stop/cancel behavior consistent
- [ ] Long session stable (10 min no degradation)

---

## Quick Test Summary

| Test | Result | Notes |
|------|--------|-------|
| Boot | ⬜ | |
| Core Voice | ⬜ | |
| Safety Interrupt | ⬜ | **CRITICAL** |
| Stop Command | ⬜ | |
| Mission Voice | ⬜ | |
| Overlay Conflict | ⬜ | |
| 10-min Stability | ⬜ | |

**Overall Decision:** ⬜ NOT READY / ⬜ FIELD ACCEPTABLE / ⬜ FIELD READY

---

## Post-Test Actions

### If READY:
1. Archive this test result
2. Monitor for 24 hours
3. Proceed with user rollout

### If NOT READY:
1. Document failures using template above
2. Revert to previous stable build
3. File bug report with:
   - Failure logs
   - Device info
   - Console output
   - Audio recording (if available)
