# Tactical HUD

Single-page **tactical field HUD** for map-centric navigation: MapLibre basemaps, waypoint route planning, floating/dockable cockpit panels, voice commands, GPS/weather/elevation readouts, PWA/offline shell, and safety-oriented panels (preflight, SOS, dead-man timer).

## Run locally

```bash
npm install
npm run env:init    # once: creates .env.local from template (backs up old file)
# edit .env.local — see env/SETUP.md
npm run env:check
npm run dev
```

Interactive key entry (PowerShell): `npm run env:setup`

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Architecture note

The file `src/.cursorrules` is the **architectural contract** for tiers, map/panel invariants, and UX constants. Treat it as the source of truth when changing behavior or layout.

## Deploy (Vercel — production)

Production is on **Vercel** (`vercel.json`). **One git push should produce one production deployment.**

1. Connect **only one** Vercel project to **one** repo remote (recommended: `upstream` → `tjbunker133133-ship-it/clean-build-lite`, branch `stable/2026-05-23`). Delete or disconnect extras (`clean-build-lite-ictz`, `clean-build-lite-jd5o`, etc.) — each duplicate fires on every push.
2. Canonical preview project name: **`clean-build-lite`** (exact). Other projects on the same repo are skipped by `scripts/vercel-should-build.sh`. If your live project uses a different name, set env var **`VERCEL_CANONICAL_PROJECT=1`** on that project only (Preview + Production).
3. Set **Production Branch** to `stable/2026-05-23` on the canonical project so Production (not only Preview) serves field builds with map fixes.
4. `netlify.toml` skips Netlify CI (`ignore = exit 0`) so Netlify does not also build on every push.
4. Vercel runs `npm ci` then `npm run build` (includes `ensure:index` via `prebuild`).
5. Set **`VITE_MAPTILER_KEY`** and other `VITE_*` vars in Vercel → Environment Variables (see `.env.example`). Without the MapTiler key, all basemap layers degrade to the same emergency tiles.

`netlify.toml` remains for manual Netlify hosting only; it is intentionally disabled for auto-build.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (runs `ensure:index` first) |
| `npm run build` | Production bundle to `dist/` |
| `npm run test` | Vitest unit tests |
| `npm run verify` | `tsc --noEmit`, tests, and `vite build` |
