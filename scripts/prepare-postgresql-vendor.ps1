$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'vendor\postgresql'
$roots = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
$source = $roots | Where-Object { Test-Path (Join-Path $_.FullName 'bin\postgres.exe') } | Select-Object -First 1
if (-not $source) { throw 'PostgreSQL Windows introuvable dans C:\Program Files\PostgreSQL. Installez PostgreSQL sur le PC développeur.' }
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item (Join-Path $source.FullName 'bin') (Join-Path $dest 'bin') -Recurse -Force
Copy-Item (Join-Path $source.FullName 'lib') (Join-Path $dest 'lib') -Recurse -Force
Copy-Item (Join-Path $source.FullName 'share') (Join-Path $dest 'share') -Recurse -Force
Write-Host "PostgreSQL embarqué préparé depuis $($source.FullName)"
