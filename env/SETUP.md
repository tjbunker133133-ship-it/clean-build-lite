# Environment setup (local + Netlify)

Vite reads **one file at the project root**: `.env.local`  
Do not put secrets in a subfolder unless you copy them to `.env.local`.

## Quick start (Windows)

From the project folder in PowerShell:

```powershell
npm run env:init
```

That backs up any existing `.env.local` and opens a fresh template. Fill in the four **required** lines, then:

```powershell
npm run env:check
npm run dev
```

Or answer prompts interactively (nothing is printed back except OK/missing):

```powershell
npm run env:setup
```

## Required keys (frontend)

| Variable | Where to get it |
|----------|-----------------|
| `VITE_SUPABASE_URL` | Supabase → **Project Settings** → **API** → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → **API** → **Publishable key** (`sb_publishable_…`) |
| `VITE_RESCUE_SIGNING_KEY` | You choose a long random string; set the **same** value as Supabase secret `RESCUE_SIGNING_KEY` |
| `VITE_RESCUE_EMAIL_URL` | `https://<project-ref>.supabase.co/functions/v1/send-rescue-email` |

## Required Supabase dashboard (one-time)

1. **Edge Functions** → `send-rescue-email` → turn **OFF** “Verify JWT”  
   (Rescue uses HMAC signatures, not user login tokens.)
2. **Edge Functions** → **Secrets** (server-side only — never put these in `.env.local` except for `npm run env:sync-gmail` on your machine):
   - `RESCUE_SIGNING_KEY` — must match `VITE_RESCUE_SIGNING_KEY`
   - `GMAIL_USER` — sending mailbox (production: `signalonehud@gmail.com`)
   - `GMAIL_APP_PASSWORD` — Google App Password for that mailbox (not the account password)

### Change rescue email sender (safe — no app redeploy)

The **From** address is read from Supabase secret `GMAIL_USER` only. The app code does not hardcode a sender.

1. On the Gmail account (e.g. `signalonehud@gmail.com`): enable **2-Step Verification**, then create an **App Password** at https://myaccount.google.com/apppasswords
2. In `.env.local` (gitignored), add:
   ```
   GMAIL_USER=signalonehud@gmail.com
   GMAIL_APP_PASSWORD=your16charapppassword
   ```
3. Log in once: `npx supabase login`
4. Push secrets: `npm run env:sync-gmail`

Or set the same two secrets in **Supabase Dashboard → Edge Functions → Secrets**.

Reply-To on each alert still uses the **operator’s reply-to email** from Preflight (their personal address).

## Push alerts (replaces SMS for v1)

Contacts receive **Web Push** on any Signal One HUD install (same Supabase project). Email alerts still send in parallel.

1. Generate keys: `npm run env:generate-vapid`
2. Add `VITE_VAPID_PUBLIC_KEY` (+ `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) to `.env.local`
3. `npx supabase login` then `npm run env:sync-vapid` (Windows: reads CLI token from Credential Manager automatically)
4. Sync frontend: `node scripts/syncVercelEnvProduction.mjs` (includes `VITE_VAPID_PUBLIC_KEY`)
5. Supabase **Edge Functions → Secrets** (if not using sync script):
   - `VAPID_PUBLIC_KEY` (same as frontend)
   - `VAPID_PRIVATE_KEY` (never in frontend)
   - `VAPID_SUBJECT=mailto:signalonehud@gmail.com`
6. Deploy + verify: `npm run deploy:push` (migration, functions JWT off, smoke test)
   - Health check in browser: `https://<ref>.supabase.co/functions/v1/register-alert-push` → `{"ok":true,...}`
7. Run migration `20260528120000_alert_push_subscriptions.sql` (`npx supabase db push` or SQL in dashboard)
8. Field lead: Preflight → **Share push invite** per contact; set **Alert delivery** (email / push / both)
9. Contact: open invite link → setup wizard **Notifications** step → confirm email → enable push

iOS: requires installed PWA (Add to Home Screen) on iOS 16.4+. See `docs/IOS_FIELD_GUIDE.md` for iPhone limits (trail snap, mesh, overlays).

## Situational map overlays (Tier 2)

Overlays are **checkbox toggles** in **Map & display** — they draw **on top of** the basemap and **under** your route/waypoints. They do not change Streets/Topo/Outdoor/Satellite.

| Overlay | Key? |
|---------|------|
| Active fire (NASA FIRMS) | **Yes** — [free MAP_KEY](https://firms.modaps.eosdis.nasa.gov/api/map_key/) → `VITE_FIRMS_MAP_KEY` |
| Shaded relief, USFS forest, BLM lands | No |
| Bike paths, abandoned rail, mines, hiking paths (OSM) | No (Overpass; caches in viewport for offline) |

1. Register MAP_KEY with `signalonehud@gmail.com` at the link above.
2. **Windows (PowerShell):** do **not** run `VITE_FIRMS_MAP_KEY=abc` (that is bash-only). Use either:
   ```powershell
   npm run env:set-firms -- YOUR_MAP_KEY_HERE
   ```
   or edit `.env.local` and add a line: `VITE_FIRMS_MAP_KEY=your_key`
3. Run `npm run env:check` — should show `OK  VITE_FIRMS_MAP_KEY`.
4. **Restart** dev server (`Ctrl+C`, then `npm run dev`). Vite only reads `.env.local` at startup.
5. Production: `node scripts/syncVercelEnvProduction.mjs` then redeploy Vercel.
6. Toggle **Active fire (24h)** in Map & display.

**Offline:** Outdoor corridor tiles are unchanged. OSM vector overlays use last cached fetch per area; raster overlays (fire, relief, land) need network.

## Netlify production

Add the same four `VITE_*` variables under **Site configuration → Environment variables**, then trigger a new deploy (Vite bakes them in at build time).

## After changing keys

Always restart the dev server (`Ctrl+C`, then `npm run dev`).
