@echo off
rem Double-click to open Everstreet on this computer. Close this window to stop it.
cd /d "%~dp0"
title Everstreet
if not exist node_modules (
  echo Installing for the first time, this takes a minute...
  call npm install --no-audit --no-fund
)
if not exist data\runtime\everstreet.db call npm run --silent seed:demo
start "" cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:8800"
call npm run app
