@echo off
chcp 65001 >nul
echo ============================================================
echo  Ollama Cloudflare Quick Tunnel
echo  - 아래에 표시되는 https://xxxx.trycloudflare.com 주소를
echo    웹앱 설정(Ollama 서버 주소)에 입력하거나,
echo    설정 화면의 "공유 링크 복사"로 팀에 공유하세요.
echo  - 이 창을 닫으면 터널이 종료됩니다. 주소는 재시작 시 바뀝니다.
echo ============================================================
cloudflared tunnel --url http://localhost:11434 --no-autoupdate
pause
