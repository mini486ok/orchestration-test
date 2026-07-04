@echo off
chcp 65001 >nul
title Rail-Brain Gateway - Cloudflare Tunnel
echo ============================================================
echo   게이트웨이용 Cloudflare 터널을 시작합니다.
echo ------------------------------------------------------------
echo   * 먼저 다른 창에서 start-gateway.bat 이 실행 중이어야 합니다
echo     (게이트웨이가 localhost:8799 에서 대기 중이어야 함).
echo   * 아래에 출력되는 https://....trycloudflare.com 주소를
echo     웹앱 설정의 "중앙 게이트웨이(서버 모드)" 주소로 사용하거나,
echo     팀원에게 ?gateway=<주소> 형태의 링크로 공유하세요.
echo   * 이 주소를 아는 사람은 누구나 로그인 화면에 접근할 수 있으니
echo     신뢰하는 사람에게만 공유하세요.
echo ============================================================
echo.
cloudflared tunnel --url http://localhost:8799 --no-autoupdate
echo.
echo 터널이 종료되었습니다.
pause
