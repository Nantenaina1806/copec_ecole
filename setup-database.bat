@echo off
setlocal
echo === COPEC3 - Initialisation base de donnees ===
cd /d "%~dp0backend"
call npm run db:setup
if errorlevel 1 (
  echo.
  echo [ERREUR] Verifiez backend\.env et PostgreSQL/Neon.
  exit /b 1
)
echo.
echo [OK] Base initialisee avec les donnees COPEC3.
call npm run db:verify
