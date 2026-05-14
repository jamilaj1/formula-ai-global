@echo off
REM Formula AI Global — Windows one-command launcher
SETLOCAL ENABLEDELAYEDEXPANSION

cd /d %~dp0..

IF NOT EXIST .env (
  echo [ERROR] .env missing. Copy .env.example to .env and fill the values.
  pause
  exit /b 1
)

echo Launching Formula AI Global v3.0.0...

REM ---- Backend ----
cd backend
IF NOT EXIST venv (
  echo Creating Python venv...
  python -m venv venv
)
call venv\Scripts\activate.bat
pip install -q -r requirements.txt

start "Formula AI Backend" cmd /k "venv\Scripts\activate.bat && uvicorn main:app --host 0.0.0.0 --port 8080 --reload"
echo Backend - http://localhost:8080

REM ---- Frontend ----
cd ..\frontend
IF NOT EXIST node_modules (
  echo Installing npm packages...
  call npm install
)
start "Formula AI Frontend" cmd /k "npm run dev"
echo Frontend - http://localhost:3000

cd ..
echo.
echo Both services launched in separate windows. Close them to stop.
pause
