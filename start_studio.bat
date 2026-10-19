@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=5178"

set "LISTENING="
for /f "tokens=2" %%A in ('netstat -ano -p TCP ^| findstr /I "LISTENING"') do (
  echo %%A | findstr /E /C:":%PORT%" >nul && set "LISTENING=1"
)

if not defined LISTENING (
  start "Shorts Studio" /MIN cmd /k node server.js
  ping -n 2 127.0.0.1 >nul
)

start "" "http://localhost:%PORT%/"
endlocal
