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

Production is deployed on **Vercel** (`vercel.json` at the repo root). Netlify remains configured in `netlify.toml` as a fallback when credits are available.

1. Connect the Git repo to your Vercel project (production branch: `stable/2026-05-23` or `main`).
2. Vercel runs `npm ci`, then `npm run ensure:index && npx vite build`, and publishes `dist/`.
3. Set environment variables in **Project Settings → Environment Variables** (see `.env.example`). `VITE_*` values are inlined at build time — redeploy after changing them.

`netlify.toml` is kept for optional Netlify hosting; do not rely on it while Netlify credits are exhausted.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (runs `ensure:index` first) |
| `npm run build` | Production bundle to `dist/` |
| `npm run test` | Vitest unit tests |
| `npm run verify` | `tsc --noEmit`, tests, and `vite build` |
