@echo off
chcp 65001 >nul
title Rail-Brain Gateway - Cloudflare Tunnel
echo ============================================================
echo   Cloudflare tunnel for the gateway - starting...
echo ------------------------------------------------------------
echo   - Run start-gateway.bat first (gateway on localhost:8799).
echo   - Copy the https://....trycloudflare.com URL shown below.
echo   - Use it as the gateway URL in the app settings, or share
echo     a link of the form:  ...?gateway=THAT_URL
echo   - Anyone who knows this URL can reach the login page,
echo     so share it only with people you trust.
echo ============================================================
echo.
cloudflared tunnel --url http://localhost:8799 --no-autoupdate
echo.
echo Tunnel stopped. You can close this window.
pause
