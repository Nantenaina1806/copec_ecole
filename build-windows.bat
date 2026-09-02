@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   COPEC ISAHA - BUILD APPLICATION WINDOWS
echo ============================================
echo.

echo [1/3] Installation des outils Electron...
call npm install
if errorlevel 1 goto :error

echo.
echo [2/3] Installation des dependances frontend...
cd frontend
call npm install
if errorlevel 1 goto :error
cd ..

echo.
echo [3/3] Construction de COPEC-Setup.exe...
call npm run desktop:dist
if errorlevel 1 goto :error

echo.
echo ============================================
echo   BUILD TERMINE !
echo ============================================
echo.
echo Installeur :
echo dist-electron\COPEC-Setup-1.0.0.exe
echo.
pause
exit /b 0

:error
cd /d "%~dp0"
echo.
echo ============================================
echo   ERREUR PENDANT LE BUILD
echo ============================================
echo Verifiez le message ci-dessus.
echo.
pause
exit /b 1