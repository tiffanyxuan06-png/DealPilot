@echo off
title CashChase Test Suite (LM Studio + WhatsApp + Stock Hold Flow)
cd /d "%~dp0"

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
