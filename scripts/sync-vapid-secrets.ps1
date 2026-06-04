# Sync VAPID secrets using Supabase CLI + Windows credential from `supabase login`.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

. "$PSScriptRoot\get-supabase-access-token.ps1"

npm run env:sync-vapid
if ($LASTEXITCODE -ne 0) {
  Write-Host '[sync-vapid] CLI failed — trying Management API...'
  node "$PSScriptRoot\sync-vapid-secrets-api.mjs"
}
exit $LASTEXITCODE
