@echo off
rem TALON one-click start (Windows). Double-click this file.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [talon] Node.js is not installed. Get Node 22.12+ from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)
node scripts\launch.mjs %*
if errorlevel 1 (
  echo.
  echo [talon] launcher exited with an error ^(see above^)
  pause
)
endlocal
