# HUD V.1 — canonical deploy

Single field build. Use this doc when anything says “clean-build-lite” or “Tactical HUD” and you are not sure which URL is live.

## Identity

| Item | Value |
|------|--------|
| Product | **HUD V.1** |
| Package slug | `hud-v1` |
| Vercel project (target) | **`hud-v1`** |
| Git branch | `stable/2026-05-23` |
| Repo (upstream) | `tjbunker133133-ship-it/clean-build-lite` |

## Vercel cleanup (do once)

1. **Keep one project** — rename `clean-build-lite` → `hud-v1` in Vercel (Settings → General → Project Name), **or** create `hud-v1` and connect the same repo/branch.
2. **Delete or disconnect** duplicate projects: `clean-build-lite-ictz`, `clean-build-lite-jd5o`, `clean-build-lite-xn62`, and any other `clean-build-lite-*` on the same repo.
3. **Production Branch** = `stable/2026-05-23` on the canonical project only.
4. **Environment variables** on that project only: `VITE_MAPTILER_KEY` (required), other `VITE_*` from `.env.example`.
5. Optional until rename finishes: set `VERCEL_CANONICAL_PROJECT=1` on the one project you keep.

`scripts/vercel-should-build.sh` reads `projects/hud-v1/canonical.vercel` and still allows legacy name `clean-build-lite` until you remove it from `project.json`.

## Local folder (optional)

You can rename the folder on disk for clarity; Git and Vercel do not require it:

```text
Desktop/projects/HUD-V.1/    ← was "clean build lite"
```

Re-open that folder in Cursor after renaming.

## After each deploy

1. Open the **Production** URL for project `hud-v1` (not an old preview alias).
2. Preflight → confirm build stamp matches latest commit.
3. iPhone: **Force Update** once if maps or install copy look stale.
