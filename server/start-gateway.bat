@echo off
chcp 65001 >nul
title Rail-Brain Gateway
echo ============================================================
echo   Rail-Brain Gateway - starting...
echo   - The "setup token" is shown in the banner below.
echo   - Press Ctrl+C in this window to stop.
echo ============================================================
echo.
python "%~dp0gateway.py" %*
echo.
echo Gateway stopped. You can close this window.
pause
