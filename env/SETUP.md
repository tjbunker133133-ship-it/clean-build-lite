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
2. **Edge Functions** → **Secrets** (server-side only — never put these in `.env.local`):
   - `RESCUE_SIGNING_KEY` — must match `VITE_RESCUE_SIGNING_KEY`
   - `GMAIL_USER` / `GMAIL_APP_PASSWORD` — for sending email

## Netlify production

Add the same four `VITE_*` variables under **Site configuration → Environment variables**, then trigger a new deploy (Vite bakes them in at build time).

## After changing keys

Always restart the dev server (`Ctrl+C`, then `npm run dev`).
