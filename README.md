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

## Deploy (Netlify — production)

This repo is built and published with **Netlify** (`netlify.toml` at the repo root).

1. Connect the Git repo to a Netlify site (build branch: `main`).
2. Netlify runs `npm ci && npm run build` and publishes `dist/`.
3. Set environment variables in **Site settings → Environment variables** (see `.env.example`). `VITE_*` values are inlined at build time — redeploy after changing them.

`vercel.json` is kept for a possible future host only; **do not use Vercel for production** until explicitly switched.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (runs `ensure:index` first) |
| `npm run build` | Production bundle to `dist/` |
| `npm run test` | Vitest unit tests |
| `npm run verify` | `tsc --noEmit`, tests, and `vite build` |
