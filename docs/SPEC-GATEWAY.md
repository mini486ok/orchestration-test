# Rail-Brain Gateway — 서버 모드 명세

이 PC에서 실행되는 경량 게이트웨이 서버(Python 3.11, **표준 라이브러리만 사용**)가
① 중앙 계정·세션 관리, ② LLM 호출 쿼터 강제, ③ Ollama 프록시, ④ 공유 데이터 저장소를 제공한다.
cloudflared 터널은 Ollama(11434) 대신 **게이트웨이(포트 8799)** 를 노출한다.

## 0. 동작 모드

- **로컬 모드(기존)**: settings.gatewayUrl 이 비어 있으면 지금과 완전히 동일(localStorage 계정, Ollama 직접 호출). 기존 기능 회귀 금지.
- **서버 모드**: settings.gatewayUrl 설정 시 — 로그인/계정/쿼터/공유 데이터/LLM 호출이 모두 게이트웨이 경유.
- 접속 파라미터 `?gateway=<url>` 로 자동 설정(기존 `?ollama=` 패턴과 동일한 방식·검증).

## 1. 서버 (server/gateway.py)

- 실행: `python server/gateway.py [--port 8799] [--ollama http://localhost:11434] [--data server/data] [--setup-token SECRET] [--embed-daily-limit 2000]`
  - `--setup-token`(env RBTL_SETUP_TOKEN): 지정 시 /auth/setup에 X-Setup-Token 헤더(또는 body.setupToken) 일치 요구. 미지정 시 /auth/setup은 loopback에서만 허용(원격 403).
  - `--embed-daily-limit`(기본 2000): 계정별 일일 임베딩 호출 한도(채팅 쿼터와 별개, 인메모리).
- 저장: `server/data/` 하위 JSON 파일 (**저장소에 커밋 금지** — .gitignore 처리됨)
  - accounts.json: [{ username, role: 'admin'|'user', salt, hash(PBKDF2-SHA256 15만회 hex), createdAt,
    quota: { dailyLimit: int(기본 200), usedToday: int, dateKey: 'YYYY-MM-DD' } }]
  - tokens.json: { token: { username, role, expiresAt(ISO, 발급+7일) } } — 서버 시작 시 만료분 정리
  - shared/{mcps,strategies,benchmarks}.json: { updatedAt: ISO, updatedBy: username, items: [...] }
- CORS: 모든 응답에 Access-Control-Allow-Origin(허용 목록: https://mini486ok.github.io, http://localhost:*, http://127.0.0.1:* — Origin 헤더가 목록에 맞으면 echo), -Headers: Authorization, Content-Type, X-Setup-Token, -Methods: GET,POST,PUT,DELETE,OPTIONS, -Expose-Headers: X-Quota-Remaining. OPTIONS 프리플라이트 204.
- 주의: cloudflared 터널을 거치면 클라이언트 IP가 항상 loopback으로 보이므로, 터널로 노출할 때는 반드시 --setup-token(start-gateway.bat이 자동 생성)으로 초기 설정을 보호해야 한다. health.setupTokenRequired가 true면 클라이언트 초기설정 화면이 토큰 입력 필드를 표시한다.
- 인증: `Authorization: Bearer <token>`. 실패 401 { error }. 만료 토큰 401.
  - 보호 엔드포인트(/llm/*, /data/*, /admin/*, /auth/{logout,me,password})는 **본문 파싱 전 토큰 검증**. 인증 전 본문 상한 64KB(초과 413), 인증 후 6MB. (DoS 완화)
- 클라이언트 토큰 저장: localStorage `rbtl:gwtoken:<gateway-origin>` (게이트웨이 origin별 분리 — 주소 변경 시 이전 토큰 미전송). gwFetch 401은 첫 건만 이벤트 방출(디바운스).
- 스레드 안전: 파일 쓰기는 전역 락으로 직렬화. rate-limit·임베딩 카운터는 전용 락(인메모리, 재시작 시 초기화). ThreadingHTTPServer 사용.

### 엔드포인트

| 메서드/경로 | 인증 | 설명 |
|---|---|---|
| GET /health | 없음 | { ok: true, app: 'rail-brain-gateway', version, accountsInitialized: bool, ollama: bool(내부 Ollama 연결 여부) } |
| POST /auth/setup | 없음* | 최초 1회(계정 0개일 때만) 관리자 생성 { username, password } → 201. *setup-token 지정 시 X-Setup-Token 헤더/body.setupToken 일치 필요(불일치 403), 미지정 시 loopback만 허용(원격 403 — 초기화 상태 비노출). 이미 있으면 409 |
| POST /auth/login | 없음 | { username, password } → { token, ..., quota }. 실패 401(계정/비번 구분 없는 메시지). (username, IP) 기준 지수 백오프 — 6회째 실패부터 429 + Retry-After, 성공 시 리셋 |
| POST /auth/logout | ✔ | 토큰 폐기 → 204 |
| GET /auth/me | ✔ | { username, role, quota } (dateKey 지났으면 usedToday 리셋 후 반환) |
| POST /auth/password | ✔ | { currentPassword, newPassword(6자↑) } → 204 |
| GET /admin/accounts | admin | 계정 목록(해시 제외) + quota |
| POST /admin/accounts | admin | { username(2~32 영숫자._-), password(6자↑), role, dailyLimit? } → 201 |
| DELETE /admin/accounts/{username} | admin | 본인·마지막 admin 삭제 거부(409) → 204. 해당 사용자 토큰 전부 폐기 |
| PUT /admin/accounts/{username}/quota | admin | { dailyLimit: int>=0 } → 200 { quota } |
| POST /llm/chat | ✔ | **쿼터 검사(remaining<=0 → 429 { error: '오늘의 LLM 호출 한도...' })** → body 그대로 Ollama /api/chat 전달(stream 강제 false) → 응답 그대로 반환 + 헤더 X-Quota-Remaining. 성공/실패 무관 전달 시도마다 usedToday+1 |
| POST /llm/embed | ✔ | 채팅 쿼터 무소모로 Ollama /api/embed 프록시. body는 JSON 객체 필수, input 개수 ≤64·총 ≤200,000자(초과 413), 계정별 일일 임베딩 한도(--embed-daily-limit) 초과 시 429 |
| GET /llm/tags | ✔ | Ollama /api/tags 프록시 (쿼터 무소모) |
| GET /llm/version | ✔ | Ollama /api/version 프록시 (쿼터 무소모) |
| GET /data/versions | ✔ | { mcps: updatedAt|null, strategies: ..., benchmarks: ... } |
| GET /data/{key} | ✔ | key ∈ mcps/strategies/benchmarks → { updatedAt, updatedBy, items } (없으면 items: null) |
| PUT /data/{key} | ✔ | { items: [...] } → 저장(last-write-wins) → { updatedAt }. 배열 아니면 400. 5MB 초과 413 |

- 일일 쿼터 리셋: 요청 처리 시 dateKey ≠ 오늘이면 usedToday=0 으로 갱신.
- 로그: 콘솔에 [시각] username 메서드 경로 상태코드 (비밀번호·본문 미출력).

## 2. 클라이언트 (assets/js/services/gateway.js — 신규)

```js
export function getGatewayUrl()            // settings.gatewayUrl || null (끝 슬래시 제거)
export function isServerMode()             // !!getGatewayUrl()
export function getToken() / setToken(t)   // localStorage 'rbtl:gwtoken' (store 경유 아님 — 세션성)
export async function gwFetch(path, init)  // fetch(getGatewayUrl()+path, Authorization 자동 부착). 401 시 토큰 폐기 + 'rbtl:gw-unauthorized' 이벤트
export async function health() / setup(u,p) / login(u,p) / logout() / me() / changePassword(cur,nw)
export async function adminListAccounts() / adminCreateAccount(...) / adminDeleteAccount(u) / adminSetQuota(u, dailyLimit)
export async function pullShared()         // versions 비교 후 mcps/strategies/benchmarks GET → store.set (반환: 갱신된 키 목록)
export function schedulePush(key)          // 공유 키 변경 debounce 2초 후 PUT (서버 모드에서만). 푸시 실패 시 warn 토스트
export function quotaState()               // 마지막으로 알려진 { dailyLimit, usedToday, remaining } 캐시 + 'rbtl:gw-quota' 이벤트로 갱신 방송
```

## 3. 앱 통합 규칙

- **ollama.js**: 서버 모드면 checkConnection→GET {gw}/llm/version, listModels→/llm/tags, chat→POST /llm/chat, embed→POST /llm/embed (모두 Bearer 부착, gwFetch 재사용). 429 응답이면 "오늘의 LLM 호출 한도를 모두 사용했습니다(남은 호출 0). 관리자에게 한도 상향을 요청하세요." 오류. 응답 헤더 X-Quota-Remaining 읽어 quotaState 갱신. 로컬 모드는 기존 코드 그대로.
- **app.js**: `?gateway=` 파라미터 처리(기존 ?ollama= 패턴). 부트 분기 — 서버 모드: health() → accountsInitialized=false면 renderSetup(서버 대상), 토큰 없거나 me() 실패면 renderLogin(서버 대상), 성공 시 pullShared() 후 셸 렌더. 셸 사이드바에 쿼터 pill(예: "LLM 87/200") 표시('rbtl:gw-quota' 이벤트 구독). 게이트웨이 접근 불가 시 명확한 오류 화면 + "로컬 모드로 전환" 버튼(gatewayUrl 제거).
- **login.js**: onSubmit 콜백이 로컬/서버를 분기할 수 있도록 파라미터화(화면 문구에 서버 모드 표시: "중앙 서버 계정으로 로그인").
- **store.js는 수정 금지.** 공유 푸시는 각 뷰가 store.set 하는 것을 gateway.js 가 store.subscribe('mcps'|'strategies'|'benchmarks')로 감지해 schedulePush (앱 부트 시 1회 구독 설정, pullShared 중에는 push 억제 플래그).
- **settings.js**: "중앙 게이트웨이(서버 모드)" 카드 — 주소 입력/저장(검증: http/https)/해제, 상태 표시(health), 공유 링크 복사(?gateway=), [지금 동기화] 버튼(pullShared), 서버 모드일 때: 내 쿼터 표시, 비밀번호 변경은 서버로, admin이면 계정·쿼터 관리 테이블(생성/삭제/한도 변경). 로컬 계정 관리 카드는 로컬 모드에서만 표시.
- **runs(평가 이력)는 공유하지 않음** — 개인 로컬 유지.
- 동시 편집은 last-write-wins — 설정·가이드에 명시.

## 4. 카탈로그 리트리버 (Q3 — assets/js/services/catalogIndex.js 신규)

프롬프트 전략(plan/react)의 도구 카탈로그 공급 방식:
- Strategy.config에 추가: `catalogMode: 'full'(기본) | 'retrieval'`, `retrieval: { method: 'vector'|'keyword'|'hybrid', topK: 8, threshold: 0.0, hybridAlpha: 0.5, expandServer: true, expandCategory: false, embedModel: 'bge-m3:latest' }`
- catalogIndex.js:
  - `buildIndex({ mcps, embedModel, onProgress })` — 도구 단위 문서(서버명/설명 + 도구명/설명 + 파라미터명·설명) 임베딩(ollama.embed, 배치 16) → store 'catalogIndex' 저장 { builtAt, embedModel, dim, docs: [{ serverId, toolName, text, vec(소수4자리) }], mcpsFingerprint(서버id+도구명 정렬 해시) }
  - `indexStatus(mcps)` — { exists, stale(핑거프린트 불일치), builtAt, docCount, embedModel }
  - `retrieve(query, { mcps, ...retrieval파라미터 })` — vector: 질의 임베딩 후 코사인 top-K / keyword: BM25(간이: 토큰화는 한글 2-gram + 영숫자 단어) / hybrid: alpha*vecScore + (1-alpha)*bm25 정규화 — threshold 미달 제외 → expandServer: 선택된 도구와 같은 서버의 나머지 도구 포함, expandCategory: 같은 카테고리 서버의 도구 포함(그래프 이웃 확장) → 반환 [{ serverId, toolName, score }]
  - vector/hybrid인데 인덱스 없음·stale이면 keyword로 폴백하고 사유 반환
- orchestrator.js: prompt 실행 시 catalogMode='retrieval'이면 retrieve() 결과 도구만으로 buildToolCatalog 축소판 생성, trace에 `검색된 도구 N개 (method, topK)` + 목록 emit. 검색 결과 0개면 전체 카탈로그 폴백 + 경고 trace.
- orchestration.js(프롬프트 편집기): "도구 카탈로그" 세그먼트(전체/검색 기반) + 검색 파라미터 폼(method 세그먼트, topK, threshold, hybridAlpha(hybrid일 때), expandServer/Category 체크, embedModel select) + 인덱스 상태 카드(구축/재구축 버튼, 진행률, stale 경고).
- samples.js에 5번째 샘플 전략 'sample-strategy-5' "검색증강 플래너 (RAG)": 전략1과 동일 프롬프트, catalogMode='retrieval', hybrid/topK 8/expandServer true.
- evaluator 수정 불필요(전략 비교 축으로 자연 편입).
