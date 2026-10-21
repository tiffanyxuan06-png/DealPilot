@echo off
title CashChase Test Suite (LM Studio + WhatsApp + Stock Hold Flow)
cd /d "%~dp0"

echo ============================================================================
echo   FAST RULE TESTS (pytest, temp database, no LM Studio needed)
echo   First time: pip install -r requirements-dev.txt
echo ============================================================================
echo.

python -m pytest -q

echo.
echo ============================================================================
echo   RUNNING CASHCHASE END-TO-END FLOW ^& LM STUDIO TEST SUITE (/test)
echo ============================================================================
echo.

python test\test_lmstudio_and_flow.py

echo.
echo ============================================================================
echo   RUNNING LIVE WHATSAPP PROMPT PLAYGROUND (/test/test_lmstudio_live_chat.py)
echo ============================================================================
echo.

python test\test_lmstudio_live_chat.py

echo.
pause
