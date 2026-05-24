# Creates a fresh .env.local from env/local.template (backs up existing file).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$template = Join-Path $root 'env\local.template'
$dest = Join-Path $root '.env.local'

if (-not (Test-Path $template)) {
  Write-Error "Template not found: $template"
}

if (Test-Path $dest) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = "$dest.backup-$stamp"
  Copy-Item -Path $dest -Destination $backup -Force
  Write-Host "Backed up existing .env.local -> $backup"
}

Copy-Item -Path $template -Destination $dest -Force
Write-Host "Created fresh .env.local"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Edit .env.local and paste your four required keys"
Write-Host "  2. npm run env:check"
Write-Host "  3. npm run dev"
Write-Host ""
Write-Host "See env/SETUP.md for where each key comes from."
