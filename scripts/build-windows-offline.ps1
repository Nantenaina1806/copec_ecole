$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host '=== COPEC ISAHA — Windows Offline-first 1.0.2 ==='
Write-Host '1/5 Préparation PostgreSQL embarqué...'
& "$PSScriptRoot\prepare-postgresql-vendor.ps1"
Write-Host '2/5 Installation des dépendances racine...'
npm ci
Write-Host '3/5 Installation des dépendances backend + frontend...'
npm ci --prefix backend
npm ci --prefix frontend
Write-Host '4/5 Build frontend + Electron...'
npm run frontend:build
npx electron-builder --win nsis
Write-Host '5/5 Vérification...'
$exe = Join-Path (Get-Location) 'dist-electron\COPEC-Setup-1.0.2.exe'
if (-not (Test-Path $exe)) { throw "Build terminé sans installer: $exe" }
Write-Host "OK — Installer: $exe"
