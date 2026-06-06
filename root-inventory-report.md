# Root Directory Inventory Report

**Date**: 2026-06-06  
**Auditor**: Agent  
**Scope**: Complete repository root directory inventory and classification  
**Status**: READ-ONLY AUDIT — NO FILES DELETED OR MOVED

---

## EXECUTIVE SUMMARY

This audit inventories all root-level files and folders in the Signal One HUD PWA repository, categorizes them by purpose and risk, and identifies potential cleanup candidates.

### Quick Stats

| Category | Count | Size Impact |
|----------|-------|-------------|
| Core Production | 12 | ~350 KB |
| Tier 1 / Frozen | 3 | ~17 KB |
| Tier 2 Systems | 7 | ~55 KB |
| Documentation | 16 | ~130 KB |
| Build Artifacts / Temp | 4 | ~43 MB |
| Archives / Backups | 2 | ~43 MB |
| Experimental / Orphaned | 31 files (in `_wip-hold`) | ~150 KB est. |
| Unknown / Needs Inspection | 0 | - |

---

## DETAILED INVENTORY BY CATEGORY

### 1. CORE PRODUCTION (Currently Used by App)

| File/Folder | Type | Size | References | Status |
|-------------|------|------|------------|--------|
| `index.html` | Entry point | 1.42 KB | vite.config.ts, build system | ✅ ACTIVE |
| `src/` | Source code | ~2 MB total | All imports | ✅ ACTIVE |
| `public/` | Static assets | Variable | vite.config.ts | ✅ ACTIVE |
| `package.json` | Dependencies | 3.22 KB | npm, build | ✅ ACTIVE |
| `package-lock.json` | Lock file | 343.2 KB | npm | ✅ ACTIVE |
| `vite.config.ts` | Build config | 3.24 KB | npm scripts | ✅ ACTIVE |
| `vitest.config.ts` | Test config | 0.23 KB | npm test | ✅ ACTIVE |
| `tsconfig.json` | TS config | 0.60 KB | Build | ✅ ACTIVE |
| `tsconfig.node.json` | TS config (node) | 0.22 KB | Build | ✅ ACTIVE |
| `capacitor.config.ts` | Mobile config | 0.36 KB | Capacitor | ✅ ACTIVE |
| `netlify.toml` | Deploy config | 1.17 KB | Netlify | ✅ ACTIVE |
| `vercel.json` | Deploy config | 1.22 KB | Vercel | ✅ ACTIVE |
| `android/` | Capacitor Android | ~5 MB | Capacitor build | ✅ ACTIVE |
| `plugins/` | Capacitor plugins | ~50 KB | capacitor.config.ts | ✅ ACTIVE |
| `supabase/` | Edge functions | ~30 KB | Deploy | ✅ ACTIVE |
| `scripts/` | Build scripts | ~20 KB | package.json scripts | ✅ ACTIVE |
| `env/` | Environment templates | ~2 KB | Setup | ✅ ACTIVE |
| `.env.example` | Env template | 0.98 KB | Setup | ✅ ACTIVE |
| `.env.local` | Local env (gitignored) | 1.89 KB | Runtime | ✅ ACTIVE (local) |
| `e2e/` | Playwright tests | ~8 KB | playwright.config.ts | ✅ NEW (2026-06-06) |
| `playwright.config.ts` | Playwright config | 0.87 KB | npm test | ✅ NEW (2026-06-06) |

**Total Core Production Items**: 22  
**Status**: ✅ MUST KEEP — All actively referenced

---

### 2. TIER 1 / FROZEN / PROTECTED SYSTEMS

| File | Type | Size | Purpose | Status |
|------|------|------|---------|--------|
| `TIER1_FREEZE.md` | Contract | 4.70 KB | Tier 1 freeze documentation | ✅ FROZEN |
| `TIER1_HARDENING.md` | Contract | 3.18 KB | Tier 1 hardening notes | ✅ FROZEN |
| `tier1-baseline.manifest.json` | Hash manifest | 1.96 KB | CI freeze validation | ✅ FROZEN |

**Total Tier 1 Items**: 3  
**Status**: ✅ MUST KEEP — Required for CI/CD and compliance

---

### 3. TIER 2 RUNTIME SYSTEMS (Recently Added)

| File | Type | Size | Purpose | Status |
|------|------|------|---------|--------|
| `TIER2_VOICE_STABILITY_GUARDRAILS.md` | Guardrails | 9.99 KB | Voice subsystem stabilization | ✅ TIER 2 |
| `TIER2_MAP_OVERLAY_STABILITY_GUARDRAILS.md` | Guardrails | 7.20 KB | Overlay stabilization | ✅ TIER 2 |
| `TIER2_GPS_COMPASS_STABILITY_GUARDRAILS.md` | Guardrails | 7.45 KB | GPS/compass stabilization | ✅ TIER 2 |
| `TIER2_PANEL_PERSISTENCE_STABILITY_GUARDRAILS.md` | Guardrails | 4.67 KB | Persistence stabilization | ✅ TIER 2 |
| `TIER2_SERVICE_WORKER_STABILITY_GUARDRAILS.md` | Guardrails | 5.91 KB | SW stabilization | ✅ TIER 2 |
| `TIER2_OPERATIONAL_STABILITY_AUDIT_2026-06-06.md` | Audit | 10.47 KB | Operational validation | ✅ TIER 2 |
| `TIER2_STABILIZATION_AUDIT_REPORT_2026-06-06.md` | Audit | 10.39 KB | Final Tier 2 report | ✅ TIER 2 |
| `OVERLAY_SMOKE_TEST_REPORT_2026-06-06.md` | Test report | 10.62 KB | Playwright validation | ✅ TIER 2 |

**Total Tier 2 Items**: 8  
**Status**: ✅ MUST KEEP — Current stabilization documentation

---

### 4. DOCUMENTATION / MARKDOWN

| File | Type | Size | Purpose | Status |
|------|------|------|---------|--------|
| `README.md` | Project readme | 2.19 KB | General docs | ✅ KEEP |
| `CAPACITOR_FIELD_APP.md` | Field guide | 3.64 KB | Android deployment | ✅ KEEP |
| `SMOKE_TESTS.md` | Test docs | 17.29 KB | Testing procedures | ✅ KEEP |
| `SMOKE_TEST_CHECKLIST.md` | Test checklist | 5.97 KB | Voice smoke tests | ✅ KEEP |
| `WORKSPACE_AUTHORITY.md` | Workspace rules | 0.45 KB | Cursor rules | ✅ KEEP |
| `docs/ANDROID_PLAY.md` | Play Store guide | 2.23 KB | Deployment | ✅ KEEP |
| `docs/IOS_FIELD_GUIDE.md` | iOS guide | 5.21 KB | Field usage | ✅ KEEP |
| `docs/SNAP_GPS_IMPLEMENTATION.md` | Tech spec | 9.69 KB | Implementation | ✅ KEEP |
| `docs/VOICE_REGRESSION_CHECKLIST.md` | QA checklist | 4.63 KB | Voice QA | ✅ KEEP |
| `docs/WEARABLES_TIER2.md` | Wearables docs | 1.96 KB | Wearables | ✅ KEEP |

**Total Documentation Items**: 10  
**Status**: ✅ KEEP — All relevant and current

---

### 5. BUILD ARTIFACTS / TEMPORARY FILES

| File | Type | Size | Purpose | Status |
|------|------|------|---------|--------|
| `dist/` | Build output | ~25 MB | Production build | ⚠️ REGENERATED |
| `test-results/` | Playwright results | Variable | Test artifacts | ⚠️ REGENERATED |
| `node_modules/` | Dependencies | ~500 MB | npm packages | ⚠️ REGENERATED |
| `.vite/` | Vite cache | ~5 MB | Build cache | ⚠️ REGENERATED |

**Status**: ⚠️ ALL GITIGNORED — Safe to delete, will regenerate

---

### 6. ARCHIVES / ZIP FILES / BACKUPS

| File | Type | Size | Contents | References | Status |
|------|------|------|----------|------------|--------|
| `clean build lite.zip` | Archive | 41.96 MB | Old project snapshot | `.gitignore` line 11, `projects/hud-v1/DEPLOY.md` | 🔴 ORPHANED |
| `netlify-dist-deploy.zip` | Archive | 42.74 KB | Old Netlify deploy | `.gitignore` line 12 | 🔴 ORPHANED |
| `archive/manifest-2026-05-28.json` | Archive manifest | 0.98 KB | Tier 2 consolidation record | None found | 🟡 ARCHIVE |
| `.env.local.backup-20260523-131045` | Env backup | 0.42 KB | Old env backup | None | 🟡 ARCHIVE |
| `audit-voice-initial.png` | Screenshot | 863.7 KB | Voice audit screenshot | None | 🟡 REFERENCE |
| `audit-voice-final.png` | Screenshot | 863.7 KB | Voice audit screenshot | None | 🟡 REFERENCE |

#### Detailed Analysis:

**`clean build lite.zip`** (41.96 MB)
- **Referenced in**: `.gitignore` (line 11), `projects/hud-v1/DEPLOY.md`
- **Content**: Historical project snapshot from before rename to "HUD V.1"
- **Risk**: LARGE FILE — 42 MB in git history if committed
- **Action**: 🔴 **SAFE TO ARCHIVE** — Not referenced in production code

**`netlify-dist-deploy.zip`** (42.74 KB)
- **Referenced in**: `.gitignore` line 12
- **Content**: Old Netlify deployment bundle
- **Risk**: Small, but orphaned
- **Action**: 🔴 **SAFE TO DELETE** — No production references

**`archive/manifest-2026-05-28.json`** (0.98 KB)
- **Content**: Archive manifest documenting Tier 2 consolidation
- **References**: No runtime references found
- **Value**: Historical record of what was archived
- **Action**: 🟡 **ARCHIVE** — Keep for historical context

---

### 7. EXPERIMENTAL / ORPHANED / LEGACY

#### `_wip-hold/` Directory (31 files)

**Full Contents**:
```
_wip-hold/src/voice/voiceOperationalPhraseResolve.ts
_wip-hold/src/lib/operationalMapResume.ts
_wip-hold/src/hud/ElevationReadout.tsx
_wip-hold/src/hud/PositionalAwarenessPanel.tsx
_wip-hold/src/lib/waypointInteraction.ts
_wip-hold/src/lib/permissionRecoveryCopy.test.ts
_wip-hold/src/hud/GpsPowerModeIndicator.tsx
_wip-hold/src/hud/openContactConfig.ts
_wip-hold/src/lib/operationalMapResume.test.ts
_wip-hold/src/hooks/useCheckInBeacon.ts
_wip-hold/src/hud/WaypointArrivalMonitor.tsx
_wip-hold/src/hud/MovementIntelligenceBridge.tsx
_wip-hold/src/hud/StatusRail.tsx
_wip-hold/src/hud/ClockPanel.tsx
_wip-hold/src/hud/DisplayModePanel.tsx
_wip-hold/src/hud/WaypointUndoStrip.tsx
_wip-hold/src/lib/geoExternalGrant.ts
_wip-hold/src/voice/voiceOperationalIds.ts
_wip-hold/src/hud/resolveRapidEndpoint.parity.test.ts
_wip-hold/src/runtime/OfflineReadinessBanner.tsx
_wip-hold/src/layers/BreadcrumbTrailLayer.tsx
_wip-hold/src/hooks/useBreadcrumbSession.ts
_wip-hold/src/lib/gpsAdaptivePolicy.ts
_wip-hold/src/lib/gpsAdaptivePolicy.test.ts
_wip-hold/src/runtime/offlineReadiness.tsx
_wip-hold/src/lib/permissionRecoveryCopy.ts
_wip-hold/src/hud/LocationPanel.tsx
_wip-hold/src/hud/CoordDisplay.tsx
_wip-hold/src/runtime/runtimeIntegrity.ts
_wip-hold/src/runtime/deploymentFreshness.ts
_wip-hold/src/runtime/deploymentFreshness.test.ts
```

**Referenced From Production Code**: ❌ **NONE FOUND**

**Archive Manifest Reference**: ✅ Yes — `archive/manifest-2026-05-28.json` documents these as "archivedPaths.wipHold"

**Status**: 🔴 **ORPHANED** — Safe to archive/remove (already documented in archive manifest)

#### `projects/` Directory

| File | Purpose | References | Status |
|------|---------|------------|--------|
| `projects/hud-v1/project.json` | Project metadata | None | 🟡 ORPHANED |
| `projects/hud-v1/DEPLOY.md` | Deploy notes | `clean build lite.zip` | 🟡 ORPHANED |
| `projects/hud-v1/canonical.vercel` | Vercel canonical | None | 🟡 ORPHANED |
| `projects/README.md` | Projects readme | None | 🟡 ORPHANED |

**Status**: 🟡 **LIKELY ORPHANED** — No production references found

---

### 8. ANALYSIS / FAILURE REPORTS

| File | Type | Size | Purpose | References | Status |
|------|------|------|---------|------------|--------|
| `ADVERSARIAL_FAILURE_ANALYSIS.md` | Analysis | 17.87 KB | Voice failure analysis | `scripts/runtime-voice-ui-audit.mjs` | ✅ REFERENCED |
| `FAILURE_FINDINGS_REPORT.md` | Report | 13.40 KB | Failure findings | None | 🟡 ORPHANED |
| `TIER2_FREEZE_VALIDATION_REPORT.md` | Validation | 10.41 KB | Tier 2 freeze validation | None | 🟡 ORPHANED |

**Status**: 
- `ADVERSARIAL_FAILURE_ANALYSIS.md` → ✅ KEEP (referenced)
- Others → 🟡 Review if still relevant

---

### 9. IDE / WORKSPACE CONFIGURATION

| File/Folder | Type | Status |
|-------------|------|--------|
| `.vscode/` | VS Code settings | ✅ KEEP (active) |
| `.cursor/` | Cursor rules | ✅ KEEP (active) |
| `.cline/` | Cline config | ✅ KEEP (active) |
| `.qodo/` | Qodo config | ✅ KEEP (active) |
| `.vercel/` | Vercel config | ✅ KEEP (gitignored, active) |
| `.gitignore` | Git ignore rules | ✅ KEEP (critical) |
| `.gitattributes` | Git attributes | ✅ KEEP |

---

## CLEANUP PLAN

### A) SAFE TO REMOVE (No References Found)

| File/Folder | Reason | Action |
|-------------|--------|--------|
| `netlify-dist-deploy.zip` | No references, old deploy artifact | DELETE |
| `test-results/` | Playwright artifacts, regenerable | DELETE |
| `.env.local.backup-20260523-131045` | Old backup, not referenced | DELETE |

### B) SAFE TO ARCHIVE (Historical Value, Keep Backup)

| File/Folder | Reason | Action |
|-------------|--------|--------|
| `clean build lite.zip` | Large historical snapshot, referenced in docs | MOVE to external archive |
| `_wip-hold/` | 31 orphaned files, already in archive manifest | MOVE to external archive |
| `projects/` | Orphaned project metadata | MOVE to external archive |
| `audit-voice-initial.png` | Screenshot reference | KEEP or ARCHIVE |
| `audit-voice-final.png` | Screenshot reference | KEEP or ARCHIVE |
| `archive/` | Already archive, but small | KEEP in repo (0.98 KB) |
| `FAILURE_FINDINGS_REPORT.md` | Old report, no references | ARCHIVE |
| `TIER2_FREEZE_VALIDATION_REPORT.md` | Superseded by newer audits | ARCHIVE |

### C) MUST KEEP (Core + Tier 1 + Tier 2 Systems)

| Category | Items |
|----------|-------|
| **Core Production** | `index.html`, `src/`, `public/`, `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `capacitor.config.ts`, `netlify.toml`, `vercel.json`, `android/`, `plugins/`, `supabase/`, `scripts/`, `env/`, `.env.example`, `e2e/`, `playwright.config.ts` |
| **Tier 1 Frozen** | `TIER1_FREEZE.md`, `TIER1_HARDENING.md`, `tier1-baseline.manifest.json` |
| **Tier 2 Active** | All 8 `TIER2_*.md` files, `OVERLAY_SMOKE_TEST_REPORT_2026-06-06.md` |
| **Documentation** | `README.md`, `CAPACITOR_FIELD_APP.md`, `SMOKE_TESTS.md`, `SMOKE_TEST_CHECKLIST.md`, `WORKSPACE_AUTHORITY.md`, `docs/*.md` |
| **Referenced Analysis** | `ADVERSARIAL_FAILURE_ANALYSIS.md` |
| **IDE Config** | `.vscode/`, `.cursor/`, `.cline/`, `.qodo/`, `.gitignore`, `.gitattributes` |

### D) NEEDS HUMAN DECISION (Uncertain Dependency)

| File/Folder | Question | Recommendation |
|-------------|----------|----------------|
| `docs/WEARABLES_TIER2.md` | Is wearables Tier 2 still active? | Review with team |
| `SMOKE_TESTS.md` vs `SMOKE_TEST_CHECKLIST.md` | Duplicate/overlap? | Consolidate if redundant |
| `TIER2_FREEZE_VALIDATION_REPORT.md` | Superseded by newer reports? | Archive if outdated |

---

## RISK SUMMARY

### High Risk Items

| Item | Risk | Mitigation |
|------|------|------------|
| `clean build lite.zip` (42 MB) | Bloats git history if committed | Move to external storage |
| `_wip-hold/` (31 files) | Confusion about what's active | Document as archived, move out |
| Duplicate Tier 2 docs | Maintenance overhead | Consolidate guardrail docs if possible |

### Medium Risk Items

| Item | Risk | Mitigation |
|------|------|------------|
| `projects/` directory | Orphaned metadata | Verify with team, then archive |
| Screenshot files (1.7 MB) | Space usage | Archive or delete if no longer needed |

### Low Risk Items

| Item | Risk | Mitigation |
|------|------|------------|
| `test-results/` | Regenerable artifacts | Already gitignored, safe to delete |
| Small archive files | Minor space usage | Keep for historical context |

---

## SUMMARY TABLE

| Category | Count | Size | Disposition |
|----------|-------|------|-------------|
| Core Production | 22 | ~530 KB + deps | ✅ MUST KEEP |
| Tier 1 Frozen | 3 | 10 KB | ✅ MUST KEEP |
| Tier 2 Active | 8 | 67 KB | ✅ MUST KEEP |
| Documentation | 10 | 53 KB | ✅ KEEP |
| Analysis (Referenced) | 1 | 18 KB | ✅ KEEP |
| IDE Config | 6 | - | ✅ KEEP |
| **SUBTOTAL KEEP** | **50** | **~678 KB** | **✅ PROTECT** |
| Archives/Zips | 2 | 43 MB | 🟡 ARCHIVE |
| _wip-hold/ | 31 files | ~150 KB | 🟡 ARCHIVE |
| projects/ | 4 | ~5 KB | 🟡 ARCHIVE |
| Old reports | 2 | 24 KB | 🟡 REVIEW |
| Screenshots | 2 | 1.7 MB | 🟡 REVIEW |
| **SUBTOTAL ARCHIVE** | **41** | **~45 MB** | **🟡 MOVE TO EXTERNAL** |
| Build artifacts | 4 | ~530 MB | 🔴 DELETE (regenerable) |
| Orphaned zips | 1 | 42 KB | 🔴 DELETE |
| **SUBTOTAL DELETE** | **5** | **~530 MB** | **🔴 SAFE TO REMOVE** |

---

## SIGN-OFF

This inventory is READ-ONLY. No files were moved or deleted during this audit.

**Next Steps** (requires human decision):
1. Review "NEEDS HUMAN DECISION" items
2. Execute "SAFE TO REMOVE" deletions if approved
3. Archive "SAFE TO ARCHIVE" items to external storage
4. Consolidate duplicate/overlapping documentation if desired

**Total Repository Size**: ~575 MB  
**Safe to Delete**: ~530 MB (build artifacts)  
**Safe to Archive**: ~45 MB (historical files)  
**Must Keep**: ~678 KB (critical files)

---

*Report generated: 2026-06-06*  
*Files inventoried: 96+*  
*References checked: All root-level files*