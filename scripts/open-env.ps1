# Opens .env.local in Notepad (easiest way to paste keys).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root '.env.local'
$template = Join-Path $root 'env\local.template'

if (-not (Test-Path $dest)) {
  Copy-Item $template $dest
  Write-Host "Created .env.local from template."
}

notepad $dest
Write-Host "After saving Notepad: npm run env:check  then  npm run dev"
