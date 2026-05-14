# CleanBuild Agent Operating Contract

This file defines the mandatory behavior rules for all AI agents working in this repository.

It overrides all informal or conversational instructions.

---

## 1. Execution Safety Rules
- Do not modify UI text unless explicitly requested
- Do not add or remove features outside the requested scope
- Do not refactor unrelated systems
- Do not introduce duplicate systems for the same state

---

## 2. Debugging Discipline
- Always trace execution before modifying code
- Prefer logging and state inspection over changes
- Do not guess fixes

---

## 3. Single Source of Truth Rule
Only one system may control each of the following:
- backend readiness
- queue state
- environment configuration
- check-in status

If duplicates exist, report them instead of patching.

---

## 4. Anti-Loop Rule
If the same issue appears more than once:
- STOP modifying code
- summarize root cause drift
- do not attempt another fix cycle

---

## 5. Change Control Flow (MANDATORY)
Every change must follow:

1. Trace behavior (no changes)
2. Identify SINGLE root cause
3. Propose minimal fix (max 3 changes)
4. Wait for explicit user approval

---

## 6. No Cosmetic Fix Rule
Do NOT:
- rename UI elements
- reword status messages
- add debug panels
- modify logs unless required for debugging

---

## 7. Success Criteria
A change is valid ONLY if:
- it fixes a functional issue
- it reduces system ambiguity
- it does not introduce new behavior paths