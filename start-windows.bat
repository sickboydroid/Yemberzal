@echo off
REM Yemberzal one-click start (Windows).
REM Requires Node.js 22.13+ / 24 LTS: https://nodejs.org
cd /d "%~dp0server"
where node >nul 2>nul || (echo Node.js not found. Install it from https://nodejs.org and re-run. & pause & exit /b 1)
if not exist node_modules (
  echo Installing server dependencies...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
if not exist .env if exist .env.example copy .env.example .env >nul
echo.
echo Starting Yemberzal... URLs will be printed below. Ctrl+C to stop.
echo.
node src/index.js
pause
