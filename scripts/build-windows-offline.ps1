$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$package = Get-Content '.\package.json' -Raw | ConvertFrom-Json
$version = $package.version
Write-Host "=== COPEC ISAHA - Windows Offline-first $version ==="
Write-Host '1/5 Preparation PostgreSQL embarque...'
& "$PSScriptRoot\prepare-postgresql-vendor.ps1"
Write-Host '2/5 Installation des dependances racine...'
npm ci
Write-Host '3/5 Installation des dependances backend + frontend...'
npm ci --prefix backend
npm ci --prefix frontend
Write-Host '4/5 Build frontend + Electron...'
npm run frontend:build
npx electron-builder --win nsis
$exe = Join-Path (Get-Location) "dist-electron\COPEC-Setup-$version.exe"
if (-not (Test-Path $exe)) { throw "Build termine sans installer: $exe" }
Write-Host "OK - Installer: $exe"