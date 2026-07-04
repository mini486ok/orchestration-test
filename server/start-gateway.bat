@echo off
chcp 65001 >nul
title Rail-Brain Gateway
cd /d "%~dp0"

rem 최초 관리자 생성 보호용 setup 토큰: data\setup-token.txt 에 1회 생성해 재사용.
rem (터널을 거치면 모든 요청이 loopback 으로 보여 IP 기반 보호가 무력화되므로 토큰으로 보호한다)
set "TOKENFILE=%~dp0data\setup-token.txt"
if not exist "%~dp0data" mkdir "%~dp0data" >nul 2>&1
if not exist "%TOKENFILE%" (
  for /f "usebackq delims=" %%T in (`python -c "import secrets;print(secrets.token_hex(16))"`) do set "RBTL_SETUP_TOKEN=%%T"
  >"%TOKENFILE%" echo %RBTL_SETUP_TOKEN%
) else (
  set /p RBTL_SETUP_TOKEN=<"%TOKENFILE%"
)

echo ============================================================
echo   Rail-Brain Gateway 를 시작합니다.
echo   (종료하려면 이 창에서 Ctrl+C 를 누르세요)
echo ============================================================
echo.
python "%~dp0gateway.py" --setup-token "%RBTL_SETUP_TOKEN%" %*
echo.
echo 게이트웨이가 종료되었습니다.
pause
