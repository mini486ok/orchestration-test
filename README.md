# 🚆 Rail-Brain Test Lab

**철도·교통 분야 MCP(Model Context Protocol) 오케스트레이션 기술 개발·테스트 플랫폼**

테스트용 MCP 서버(메타정보 + 스키마 기반 모의 실행)를 등록하고, 프롬프트 엔지니어링·스킬·룰 기반의
다양한 오케스트레이션 전략을 설계한 뒤, 자동/수동 생성 벤치마크로 성능을 정량 검증·비교하는 웹 애플리케이션입니다.

**배포 주소**: https://mini486ok.github.io/orchestration-test/

## 주요 기능

| 기능 | 설명 |
|---|---|
| 🧩 MCP 카탈로그 | 철도·교통 샘플 MCP 30종 기본 제공. 검색·필터·상세 조회·삭제·복원, 스키마 기반 도구 직접 실행 |
| 🛠 MCP 빌더 | 수동 폼(스키마 직접 정의) + AI 자동 생성(텍스트 설명 → LLM이 서버 설계) |
| 🧠 오케스트레이션 스튜디오 | 프롬프트 엔지니어링(플랜/ReAct), 스킬 기반, 룰 기반 워크플로우 — 3가지 전략 설계·테스트·저장/불러오기 |
| 📏 벤치마크 랩 | LLM 자동 생성(질의+정답 워크플로우) + 수동 작성, 세트 관리, 가져오기/내보내기 |
| 🏁 평가·비교 | 다중 전략 동시 평가, P/R/F1·시퀀스 정확도·완전일치·지연시간 지표, 차트 시각화, 실행 이력 |
| 🔐 접근 제어 | 최초 실행 시 관리자 계정 생성(브라우저 로컬 저장), 개별 계정 로그인 |

## 아키텍처

- **순수 정적 SPA** — 프레임워크/빌드 도구 없음 (Vanilla JS ES Modules). GitHub Pages 직배포.
- **LLM** — 브라우저에서 로컬 [Ollama](https://ollama.com) API 직접 호출 (기본: `exaone3.5:7.8b`, 변경 가능).
- **MCP 모의 실행** — 실제 서버 없이 inputSchema 검증 → outputSchema에 부합하는 결정적 랜덤 출력 생성.
- **데이터** — 전부 브라우저 localStorage (JSON 백업/복원 지원). 서버 전송 없음.

## 시작하기

1. **Ollama 준비** (이 페이지를 여는 PC에서):
   ```powershell
   # 모델 설치
   ollama pull exaone3.5:7.8b
   # GitHub Pages(https)에서 접근 허용 (PowerShell, 1회)
   [System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
   # 이후 Ollama 재시작
   ```
2. 배포 페이지 접속 → 최초 실행 시 관리자 계정 생성 → 로그인.
3. 앱 내 **가이드** 메뉴에서 상세 사용법을 확인하세요.

### 로컬 실행

```bash
git clone https://github.com/mini486ok/orchestration-test.git
cd orchestration-test
python -m http.server 8000   # 또는 아무 정적 서버
# http://localhost:8000 접속
```

## 디렉토리 구조

```
index.html
assets/
  css/main.css          # 디자인 시스템 (관제센터 다크 테마)
  js/
    app.js              # 엔트리 (인증 게이트 → 셸 → 라우터)
    core/               # store, router, ui, auth, charts
    services/           # ollama, mockEngine, orchestrator, benchmarkGen, evaluator
    data/               # 샘플 MCP 30종, 샘플 전략/벤치마크
    views/              # 화면별 뷰 모듈
docs/SPEC.md            # 아키텍처 명세
```

## 보안 관련 주의

정적 호스팅 특성상 로그인은 **클라이언트 측 접근 제어**입니다(PBKDF2 해시, localStorage 저장).
서버 수준의 보안이 아니므로 민감한 데이터는 저장하지 마세요.
계정 정보는 저장소(repo)에 포함되지 않으며 각 브라우저에만 존재합니다.
