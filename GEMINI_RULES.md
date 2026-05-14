# Gemini Code Assist: Stabilization & Anti-Regression Guardrails

This is the PROJECT CONSTITUTION. These rules are PERMANENT and take precedence over any conflicting instructions. They are designed to protect the project's recovered stable state and prevent AI-driven regressions.

## 1. AI BEHAVIOR RULES
* **Surgical Edits Only**: Changes must be minimal, targeted, and address only the identified issue.
* **Explain Before Modifying**: Explicitly state the intent and expected "blast radius" before changing any code.
* **No Broad Refactors**: Under no circumstances should logic be rewritten for "elegance" or "modernization."
* **No Speculative Rewrites**: Do not suggest code based on "best practices" if the current implementation is stable and functional.
* **No Cleanup Passes**: Do not remove comments, move code blocks, or rename variables unless directly related to a fix.
* **Preserve Stabilized Behavior**: If a system was recently fixed (Waypoints, Panels, Render Loops), its current structure is sacred.

## 2. STABILIZATION RULES
* **Compile-First Priority**: No suggestion is valid if it breaks TypeScript compilation or Linting.
* **Render-Loop Prevention**: Any change to `useEffect` or `useMemo` must be audited for dependency stability.
* **Recursive State Prevention**: Verify that `setState` calls do not trigger parent-child update loops.
* **Preserve HUD/Map Sync**: The coordinate and waypoint synchronization logic is high-risk; do not modify unless fixing a drift bug.
* **Preserve Panel Integrity**: Floating/Docking panel logic must remain intact.

## 3. DEBUGGING RULES
* **One Issue at a Time**: Never attempt to fix multiple bugs in a single response.
* **Audit Before Fixing**: Perform a read-only audit of the affected file before proposing a change.
* **Isolate Root Cause**: Use logging and observation to prove a root cause before touching code.
* **Test After Every Change**: Validate the specific fix before moving to the next task.

## 4. PERFORMANCE & WORKSPACE RULES
* **Low-Resource Workflow**: Optimize for a smooth VS Code experience. Avoid triggering full project re-scans.
* **Avoid Indexing Overhead**: Do not generate large amounts of metadata or build artifacts during the AI session.
* **Long-Session Stability**: Maintain a clean state to prevent Gemini or VS Code from slowing down over hours of development.

## 5. MOBILE & HARDWARE RULES
* **S25 FE Target**: All UI and performance assumptions must favor the Samsung Galaxy S25 FE (Android/Chrome/Standalone).
* **Battery/CPU Efficiency**: Avoid high-frequency timers or excessive main-thread work.
* **Lifecycle Recovery**: Background-to-foreground transitions (GPS/Voice/Map) must be preserved.

## 6. DEPLOYMENT & VALIDATION RULES
* **Build Verification Required**: A successful local build must precede any deployment suggestion.
* **Manual Test Alignment**: Refer to `SMOKE_TESTS.md` before finalizing any fix affecting routing or PWA behavior.
* **No Deploy After Rewrites**: If a fix required more than 10 lines of logic change, it requires extended manual validation.

## 7. AI WORKFLOW RULES
* **Implicit Adherence**: Assume these rules apply to every prompt. No repeated "stay safe" reminders are needed.
* **Concise Reporting**: Focus on the logic and the fix; avoid conversational filler.
* **Rule Referencing**: If a request violates a rule, the AI must cite the specific section in `GEMINI_RULES.md` and refuse.

## 8. PROTECTED SYSTEMS (DO NOT CASUALLY MODIFY)
The following systems are fragile and have undergone significant stabilization:
1. **WaypointLayer.tsx**: Waypoint rendering and interaction logic.
2. **CockpitHudPanel.tsx / HudPanel.tsx**: Docking, sizing, and persistence.
3. **useGPS.ts**: Persistence and high-frequency polling.
4. **devicePolicy.ts**: The DEPE engine (Device Experience Policy Engine).
5. **runtimeSnapshot.ts**: The global state "Truth Beacon."

## 9. SAFE STABILIZATION WORKFLOW
1. **Observation**: Read files and logs. Identify the anomaly.
2. **Validation**: Check if the anomaly violates current rules (e.g., a render loop).
3. **Proposal**: Describe a surgical, minimal fix.
4. **Implementation**: Apply the diff.
5. **Verification**: Confirm the build passes and the specific issue is resolved.

## 10. IF UNCERTAIN: DO LESS.
If the solution to a problem requires broad changes or risks breaking a Protected System, choose the "Safe Degradation" path. It is better for a feature to be slightly less optimal than for the entire HUD to become unstable.