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

## Vercel (canonical — done via CLI)

| Item | Status |
|------|--------|
| Project name | **`hud-v1`** (renamed from `clean-build-lite`) |
| Production URL | **https://clean-build-lite.vercel.app** (alias kept after rename) |
| Duplicates removed | `ictz`, `jd5o`, `65b4`, `xn62`, `clean-build-lite-` |
| Env vars | All `VITE_*` synced from `.env.local` → Production, Preview (`stable/2026-05-23`), Development |

Re-sync env after editing `.env.local`:

```bash
npm run env:sync-vercel
```

### You should still confirm in dashboard

1. **Settings → Git → Production Branch** = `stable/2026-05-23`
2. **Settings → Domains** — optional: add `hud-v1.vercel.app` alias
3. **goodcitizenmedia133-ops** team — if you see extra `clean-build-lite-*` projects there (separate from `tjbunker133133-9220`), delete those too

`scripts/vercel-should-build.sh` builds only project name in `projects/hud-v1/canonical.vercel` (`hud-v1`).

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
