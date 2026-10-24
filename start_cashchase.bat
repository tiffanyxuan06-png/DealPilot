@echo off
title CashChase Smart SME Server (WebApp + WhatsApp Extension + LM Studio)
cd /d "%~dp0"

echo ============================================================================
echo   CASHCHASE SMART SME SERVER - ONE-CLICK LAUNCHER
echo ============================================================================
echo   - Configuration File : %~dp0.env
echo   - Live Website URL   : http://localhost:8000
echo   - API Docs URL       : http://localhost:8000/docs
echo ============================================================================
echo.

REM Open the Live Website in the default browser after 2 seconds
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000"

REM Install any missing backend packages (no-op when already installed)
python -m pip install -q -r requirements.txt

REM Start the FastAPI + SQLite + LM Studio Bridge Server
python run_server.py

pause
