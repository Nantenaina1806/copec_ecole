@echo off
setlocal
if "%DATABASE_URL%"=="" (
  echo DATABASE_URL est requis.
  exit /b 1
)
if not exist "%COPEC_BACKUP_DIR%" mkdir "%COPEC_BACKUP_DIR%"
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set D=%%c-%%b-%%a
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set T=%%a-%%b
set OUT=%COPEC_BACKUP_DIR%\copec-backup-%D%-%T%.sql
pg_dump "%DATABASE_URL%" --no-owner --no-privileges --file "%OUT%"
if errorlevel 1 exit /b 1
certutil -hashfile "%OUT%" SHA256
echo Backup cree: %OUT%
endlocal
