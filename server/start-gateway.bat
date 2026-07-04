@echo off
chcp 65001 >nul
title Rail-Brain Gateway
echo ============================================================
echo   Rail-Brain Gateway 를 시작합니다.
echo   (종료하려면 이 창에서 Ctrl+C 를 누르세요)
echo ============================================================
echo.
python "%~dp0gateway.py" %*
echo.
echo 게이트웨이가 종료되었습니다.
pause
