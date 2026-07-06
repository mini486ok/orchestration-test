# Rail-Brain Test Lab — 아키텍처 명세 (SPEC)

철도·교통 분야 MCP 오케스트레이션 기술을 개발·테스트하는 **순수 정적 SPA**.
GitHub Pages 배포(빌드 스텝 없음, Node 없음). ES Modules + Vanilla JS. UI 언어: 한국어.

## 0. 절대 규칙

- 프레임워크/번들러/외부 JS 라이브러리 금지. 폰트(Google Fonts)만 외부 허용.
- 모든 상태는 `store`(localStorage) 경유. 직접 localStorage 접근 금지(core/store.js 내부 제외).
- 모든 LLM 호출은 `services/ollama.js` 경유.
- 모든 MCP 실행(모의)은 `services/mockEngine.js` 경유.
- XSS 방지: 사용자 입력을 innerHTML에 넣지 말 것. `ui.el()` 헬퍼 또는 textContent 사용.
- 각 view 모듈은 `export function render(container, ctx)` 하나를 노출. cleanup이 필요하면 함수 반환.
- CSS는 assets/css/main.css의 디자인 토큰(CSS 변수)과 기존 컴포넌트 클래스를 재사용. 뷰 전용 스타일은 main.css 하단의 해당 뷰 섹션에 추가.
- 주석/문구/라벨은 한국어.

## 1. 디렉토리

```
index.html
assets/css/main.css
assets/js/app.js                # 엔트리: 인증 게이트 → 셸 → 라우터 (샘플 시드/버전 병합 포함)
assets/js/core/store.js         # 상태/영속화 (pub/sub)
assets/js/core/router.js        # 해시 라우터
assets/js/core/ui.js            # DOM/컴포넌트 헬퍼 (el, toast, modal, confirm, jsonEditor, ...)
assets/js/core/auth.js          # PBKDF2 계정/세션 (로컬 모드)
assets/js/core/charts.js        # SVG 차트 (bar, groupedBar, radar, donut)
assets/js/services/ollama.js    # Ollama 클라이언트 (chat/chatJSON/embed, 게이트웨이 중계 겸용)
assets/js/services/gateway.js   # 중앙 게이트웨이 클라이언트 — 서버 모드 계정/쿼터/데이터 공유 (SPEC-GATEWAY.md)
assets/js/services/mockEngine.js# MCP 모의 실행 엔진
assets/js/services/mcpUtils.js  # 서버/도구/스키마 정규화·검증 공용 (빌더·가져오기)
assets/js/services/orchestrator.js # 전략 실행 엔진 (prompt/skill/rule/db 4종)
assets/js/services/catalogIndex.js # 카탈로그 벡터/키워드 인덱스 — db(vector) 전략 (SPEC-GRAPH.md)
assets/js/services/catalogGraph.js # 도구 관계 그래프 — db(graph) 전략 (SPEC-GRAPH.md)
assets/js/services/benchmarkGen.js # LLM 벤치마크 자동 생성
assets/js/services/evaluator.js # 평가 지표 계산 + 평가 실행
assets/js/data/sampleMcps.js    # 샘플 MCP — 기본 30종 + mcpsExt 병합 = 총 100서버·311도구
assets/js/data/mcpsExt/*.js     # 분야별 확장 샘플 MCP (10개 분야 × 각 7종)
assets/js/data/samples.js       # 샘플 전략(6종)/벤치마크 시드 — 총 12세트·140문항
assets/js/data/benchmarksExt/*.js # 분야별 검증 세트 10개(각 10문항) + 복합 시나리오 세트(complex.js, 30문항)
assets/js/views/{login,dashboard,mcps,mcpBuilder,orchestration,playground,benchmarks,evaluation,settings,guide}.js
server/gateway.py               # 중앙 게이트웨이 서버 (선택 실행 — SPEC-GATEWAY.md)
docs/SPEC.md · docs/SPEC-GRAPH.md · docs/SPEC-GATEWAY.md
README.md
```

## 2. store.js (구현 완료 — 계약)

```js
import { store } from '../core/store.js';
store.get(key)                    // 깊은 복사본 반환
store.set(key, value)             // 저장 + 구독자 알림 + localStorage 영속화
store.update(key, fn)             // fn(현재값)=>새값
store.subscribe(key, cb)          // cb(newValue); 반환값 = 구독해제 함수
store.export()                    // 전체 데이터 JSON 객체
store.import(obj, { includeAccounts = false })
// 키별 타입 검증(위반 키 건너뜀) + __proto__/constructor/prototype own key 재귀 제거.
// accounts는 includeAccounts=true이고 항목 스키마 검증 통과 시에만 반영.
// 반환: { applied: string[], skipped: string[], accountsIncluded: bool }
```
- persist 실패 시 `window`에 `rbtl:persist-failed` CustomEvent(detail.key) 방출 — app.js가 토스트로 통지.
- 멀티탭: window 'storage' 이벤트 수신 시 해당 키 cache 무효화 + 구독자 알림.

키와 값 형태(초기값은 app.js에서 시드):
- `settings`: `{ ollamaUrl: 'http://localhost:11434', defaultModel: 'exaone3.5:7.8b', temperature: 0.2, maxSteps: 6, numCtx: 16384, llmTimeoutSec: 300 }`
  - `numCtx`: LLM num_ctx(기본 16384 — 100서버 카탈로그 프롬프트 대응).
  - `llmTimeoutSec`: LLM 호출당 타임아웃 초(기본 300, 0=무제한) — chat/embed에 적용, 초과 시 `LLM 응답 시간 초과(N초)` 오류.
- `accounts`: `[{ id, username, role: 'admin'|'user', salt, hash, iterations, createdAt }]`
- `session`: `{ username, role, loginAt } | null`
- `mcps`: `McpServer[]` (기본 시드 100서버·311도구)
- `strategies`: `Strategy[]` (기본 시드 6종 — prompt 2·skill 1·rule 1·db 2)
- `benchmarks`: `BenchmarkSet[]` (기본 시드 12세트·140문항 = 기본 1세트 10문항 + 분야별 10세트 각 10문항 + 복합 1세트 30문항)
- `runs`: `EvalRun[]` (최신이 앞)
- `catalogIndex` / `catalogGraph`: db 전략의 벡터 인덱스/도구 관계 그래프 (형태는 SPEC-GRAPH.md)
- `sampleSeedVersion`: 샘플 병합 버전(신규 기본 샘플을 기존 저장소에 1회 병합)

## 3. 데이터 모델

### McpServer
```js
{
  id: 'kr-train-schedule',        // kebab-case 고유
  name: 'KR Train Schedule',      // 영문명
  nameKo: '열차 운행정보 조회',    // 한글명
  icon: '🚆',                     // 이모지 1개
  category: '운행정보',            // §4 카테고리 중 하나
  description: '전국 열차 시간표·실시간 운행 상태를 제공하는 MCP 서버',
  version: '1.0.0',
  tags: ['KTX', '실시간', '시간표'],
  author: 'sample',               // 'sample' | 사용자명
  isSample: true,
  createdAt: '2026-07-04T00:00:00Z',
  tools: [ Tool, ... ]            // 2~4개
}
```

### Tool
```js
{
  name: 'search_trains',          // snake_case
  description: '출발역·도착역·날짜로 열차 편성을 검색한다',
  inputSchema: {                  // JSON Schema (draft-07 부분집합)
    type: 'object',
    properties: {
      from: { type: 'string', description: '출발역 이름', examples: ['서울'] },
      to:   { type: 'string', description: '도착역 이름', examples: ['부산'] },
      date: { type: 'string', format: 'date', description: '출발일 (YYYY-MM-DD)' },
      trainType: { type: 'string', enum: ['KTX','ITX','무궁화','전체'], default: '전체' }
    },
    required: ['from','to']
  },
  outputSchema: {
    type: 'object',
    properties: {
      trains: { type: 'array', items: { type: 'object', properties: {
        trainNo: { type: 'string' }, type: { type: 'string' },
        departure: { type: 'string' }, arrival: { type: 'string' },
        duration: { type: 'string' }, fare: { type: 'number' }
      } } },
      count: { type: 'integer' }
    }
  },
  mock: {                         // 선택. 모의 실행 힌트
    latencyMs: [120, 600],        // [min,max] 범위
    samples: [ { /* outputSchema에 부합하는 예시 출력 1~2개 */ } ]
  }
}
```

지원 스키마 기능(이 부분집합만 사용): `type`(object/array/string/number/integer/boolean),
`properties`, `required`, `items`, `enum`, `default`, `description`, `examples`, `format`(date/date-time/time만), `minimum`, `maximum`.

### Strategy (오케스트레이션 전략)
```js
{
  id: 'uuid', name: '기본 플래너 v1', description: '...',
  type: 'prompt' | 'skill' | 'rule' | 'db',
  model: null | 'exaone3.5:7.8b',   // null이면 settings.defaultModel
  createdAt, updatedAt,
  config: { ... }                    // 타입별 아래 참조
}
```

- `type:'prompt'` → `config = { systemPrompt: string, planningMode: 'plan'|'react', temperature: number, maxSteps: number }`
  - systemPrompt 안에서 플레이스홀더 `{{TOOL_CATALOG}}`, `{{QUERY}}`, `{{DATE}}` 사용 가능.
  - `plan`: 1회 호출로 전체 계획 JSON 수립 후 순차 실행. `react`: 단계마다 LLM 호출(관찰 포함) 반복.
- `type:'skill'` → `config = { skills: [{ id, name, trigger, description, steps: [Step] }], selectorPrompt: string, paramFill: 'llm'|'template' }`
  - Step: `{ serverId, toolName, paramsTemplate: object }` — paramsTemplate 값에 `{{QUERY}}`, `{{step1.output.xxx}}` 참조 가능.
  - 실행: LLM이 selectorPrompt+스킬 목록으로 스킬 1개 선택 → steps 순차 실행(파라미터는 paramFill 방식으로 채움).
- `type:'rule'` → `config = { rules: [{ id, name, priority: number, matchMode: 'any'|'all', conditions: [{ type: 'keyword'|'regex', value }], steps: [Step] }], onNoMatch: 'error'|'llmFallback', fallbackPrompt?: string }`
  - LLM 없이 결정적으로 매칭(우선순위 오름차순 정렬 후 첫 매치). onNoMatch='llmFallback'이면 기본 플래너로 폴백.
- `type:'db'` → `config = { store: 'vector'|'graph', planningMode: 'plan'|'react', temperature, maxSteps, systemPrompt, vector?: {...}, graph?: {...} }`
  - 실행 전 카탈로그를 db 검색으로 축소해 `{{TOOL_CATALOG}}`에 **질의 관련 도구만** 주입하고, 이후 prompt 전략과 동일한 plan/react 경로를 공유한다.
  - `store:'vector'` → `vector = { method: 'vector'|'keyword'|'hybrid', topK, threshold, hybridAlpha, expandServer, expandCategory, embedModel }` (catalogIndex.js — 도구당 벡터 1개, MMR·docFields 등 상세는 SPEC-GRAPH.md).
  - `store:'graph'` → `graph = { edges: { io|semantic|server|category|cooccur|llm: {on,weight,threshold?} }, seedMethod, seedK, hops, decay, topK, embedModel, extractModel }` (catalogGraph.js — 상세는 SPEC-GRAPH.md).
  - 인덱스/그래프 미구축·stale·검색 0건이면 keyword/vector/전체 카탈로그로 자동 폴백하며, 폴백 사유는 ExecutionResult의 `retrievalFallback`에 기록된다.

### BenchmarkSet / BenchmarkItem
```js
BenchmarkSet { id, name, description, createdAt, items: BenchmarkItem[] }
BenchmarkItem {
  id, query: '내일 아침 서울에서 부산 가는 KTX 알려줘',
  expected: [{ serverId, toolName, params?: object }],   // 정답 워크플로우(기본: 순서 있음)
  ordered?: boolean,          // false면 순서무관 채점(멀티셋 기준). 기본 true
  alternatives?: [            // 대안 정답 워크플로우 배열(본 정답과 함께 채점 후 F1 최대 후보 채택)
    [{ serverId, toolName, params? }, ...]                            // ① 배열 형태(기존)
    | { steps: [{ serverId, toolName, params? }, ...],                // ② 객체 형태 — 대안별 goal 지원
        goal?: { serverId, toolName, params? } }
  ],
  goal?: { serverId, toolName, params? },  // 목표 도구(목표 달성률 기준). 생략 시 채택 정답의 마지막 step,
                                           // 단 ordered:false && goal 없음 → 정답 도구 전부 완수(집합 모드)
  category?: string, difficulty: 'easy'|'medium'|'hard',
  source: 'auto'|'manual', notes?: string
}
```
- alternatives 두 형태는 evaluator가 정규화해 동일하게 취급하며, `matchedAlternative` 인덱스 의미는 형태와 무관하게 동일하다.
- 대안이 채택된 경우 goalAchieved 목표 결정 우선순위: ①채택 대안의 goal(유효하고 그 대안 steps에 포함) → ②item.goal(채택 후보에 포함 시) → ③기존 규칙(ordered:false&goal없음=집합완수 / 채택 정답의 마지막 step).

### ExecutionResult (orchestrator 반환)
```js
{
  ok: boolean,               // plan/skill/rule: 단계 오류 발생 시 false로 강등. react: final_answer 미도달 시 false
  steps: [{ serverId, toolName, params, output, latencyMs, error? }],
  trace: [TraceEvent],   // {ts, type:'info'|'llm-request'|'llm-response'|'tool-call'|'tool-result'|'error', label, detail?}
  llmCalls: number,          // 실제 HTTP 호출 수(chatJSON 재시도 포함)
  hasStepErrors?: boolean,   // 단계 오류 존재 여부(모든 경로에서 기록)
  usedFallback?: boolean,    // rule 전략이 LLM 폴백으로 실행된 경우 true
  inputTokens: number,       // LLM 입력 토큰 합(prompt_eval_count, 없으면 글자수/2.2 추정)
  outputTokens: number,      // LLM 출력 토큰 합(eval_count, 없으면 추정)
  tokensEstimated: boolean,  // 하나라도 추정치가 섞이면 true
  ctxOverflow: boolean,      // 기본 false — 프롬프트 전체 추정(chars/2.2) > numCtx 또는 실측 promptTokens ≥ numCtx×0.98(절단 의심)
  retrievalFallback: string|null, // 기본 null — db 전략 검색 폴백 사유(예: 'graph→vector', 'vector→keyword(stale)', '검색 0건→전체 카탈로그')
  totalLatencyMs: number, error?: string, finalAnswer?: string
}
```

### EvalRun
```js
{
  id, name, createdAt, benchmarkSetId, benchmarkSetName, strategyIds: [],
  status: 'running'|'done'|'cancelled'|'error',
  model: string|null,        // 모델 오버라이드(공정 비교) 사용 시 기록
  temperature: number|null,  // 온도 통일 사용 시 기록
  maxSteps: number|null,     // maxSteps 통일 사용 시 기록
  perStrategy: {
    [strategyId]: {
      strategyName, strategyType,
      items: [{ itemId, query, difficulty, category, expected, actual: steps(절단),
                metrics: ItemMetrics, error?, hasStepErrors, usedFallback,
                latencyMs, llmCalls, trace(절단), finalAnswer? }],
      summary: SummaryMetrics
    }
  }
}
ItemMetrics {
  precision, recall, f1, seqAccuracy, exactMatch: 0|1, paramScore: number|null,
  matchedAlternative: number|null,   // 채택된 대안 인덱스(null=본 정답 채택)
  callSuccessRate: number|null,      // 도구 호출 성공률 = (전체−실패)/전체. 호출 0건이면 null
  extraToolRate: number,             // 잉여 도구 호출률 = 1 − precision (호출 0건이면 0)
  goalAchieved: 1|0|null,            // 목표 도구 달성(오류 없이 호출 && params 매칭≥0.5). N/A=null
  compositeScore: number,            // 품질점수 = 0.4·F1 + 0.3·목표달성 + 0.15·도구성공률 + 0.15·파라미터
                                     //   (null 지표는 가중치 제외 후 재정규화)
  inputTokens, outputTokens, totalTokens, tokensEstimated: boolean, // 토큰 계측(runEvaluation이 병합)
  ctxOverflow: boolean,              // 프롬프트 numCtx 초과(절단 의심) — 신뢰도 플래그
  retrievalFallback: string|null     // db 검색 폴백 사유 — 신뢰도 플래그
}
SummaryMetrics {
  avgPrecision, avgRecall, avgF1, avgSeqAccuracy, exactMatchRate, avgParamScore: number|null,
  avgLatencyMs, avgLlmCalls, itemCount,
  errorRate,                 // (error 또는 hasStepErrors) 항목 비율(부분 오류 포함)
  hardErrorRate,             // 실행 자체 실패(error)만
  fallbackRate, avgF1Matched: number|null,   // rule 전략 폴백 분리 해석용
  avgCallSuccessRate: number|null, avgExtraToolRate, goalAchievementRate: number|null, // null(N/A) 항목 제외 평균
  avgInputTokens, avgOutputTokens, avgTotalTokens, totalTokens, anyTokensEstimated: boolean,
  avgComposite,
  ctxOverflowCount: number,          // 컨텍스트 초과 문항 수(ctxOverflow=true)
  retrievalFallbackCount: number,    // 검색 폴백 문항 수(retrievalFallback≠null)
  tokenEfficiency,           // finalizeScores 주입 — 가장 적은 평균총토큰/이 전략의 평균총토큰(run 내 상대, [0,1])
  orchestrationScore         // finalizeScores 주입 — 0.85·avgComposite + 0.15·tokenEfficiency
}
```

## 4. MCP 카테고리 (10종 고정)

`운행정보`, `예매·발권`, `안전·관제`, `시설·유지보수`, `물류·화물`, `도시교통`, `여객서비스`, `기상·환경`, `데이터분석`, `요금·정산`

## 5. ollama.js (계약)

```js
export async function checkConnection()        // {ok, version?, error?}
export async function listModels()             // [{name, size, family}] — 실패 시 throw
export async function chat({ model, messages, temperature, format })
// messages: [{role:'system'|'user'|'assistant', content}] , format: 'json' 전달 시 Ollama format=json
// 반환: { content: string, durationMs, model } — /api/chat 사용, stream:false
export async function chatJSON(opts)          // chat 후 JSON 강건 추출(코드펜스 다중 후보 + 모든 {..}/[..] 시작 위치 순회, 재시도 1회). 반환: {data, raw, durationMs, retried, calls: 1|2}
export async function embed({ model, input, signal })  // 임베딩 벡터 — db 전략(catalogIndex/catalogGraph) 구축·검색용
export function getOllamaUrl()                 // settings에서. num_ctx는 settings.numCtx(기본 16384) 사용
```
주의: exaone3.5는 tool-calling 미지원 → 모든 구조화 출력은 JSON 텍스트 파싱으로 처리.
- 모든 LLM 호출(chat/embed, 게이트웨이 중계 포함)에 settings.llmTimeoutSec(기본 300초, 0=무제한)의 **호출당 타임아웃**이 적용된다 — 기존 signal과 결합, 초과 시 `LLM 응답 시간 초과(N초)` 오류.
- 서버 모드(settings.gatewayUrl)에서는 Ollama 직접 호출 대신 게이트웨이 중계를 사용한다(SPEC-GATEWAY.md).

## 6. mockEngine.js (계약)

```js
export async function executeTool(server, toolName, params, { signal } = {})
// signal abort 시 대기 중이라도 즉시 AbortError로 reject
// 반환: { output, latencyMs }  — output은 outputSchema에 부합
// 1) tool.mock.samples 있으면: 시드 기반으로 샘플 선택 + params 값을 출력 문자열 필드에 자연스럽게 반영(치환 가능한 필드)
// 2) 없으면: outputSchema 순회하며 결정적 의사난수(시드 = hash(serverId+toolName+JSON(params)))로 도메인 인지 값 생성
//    - 필드명 휴리스틱: *station*→역명 풀, *time*/*departure*→시각, *fare*/*price*→금액, *train*→열차번호 등
// latencyMs: mock.latencyMs 범위 내 또는 80~500 랜덤, 실제 setTimeout으로 대기(체감 시뮬레이션), AbortSignal 지원 X
export function validateParams(tool, params)   // {ok, errors: string[]} — required/type/enum/min·max + 중첩 1단계/배열 원소 검사
```
신규 모듈 `services/mcpUtils.js`: normalizeServer/normalizeTool/normalizeSchema/validateSchema/
nearestCategory/slugify/sanitizeKeys/normalizeImportedServer + CATEGORIES — 빌더·가져오기 공용 정규화.

## 7. orchestrator.js (계약)

```js
export async function executeStrategy(strategy, query, opts)
// opts: { mcps: McpServer[], onTrace?: (TraceEvent)=>void, signal?: AbortSignal }
// 반환: ExecutionResult. 내부에서 타입별(prompt/skill/rule/db) 실행기 분기.
// db 타입은 catalogIndex(vector)/catalogGraph(graph) 검색으로 카탈로그를 축소한 뒤 plan/react 경로를 공유.
export function buildToolCatalog(mcps)   // LLM 프롬프트용 도구 카탈로그 텍스트(간결, 토큰 절약형)
export function estimateCatalogTokens(mcps) // 전체 카탈로그 프롬프트의 추정 토큰 수(≈글자수/2.2, LLM 호출 없음)
                                            // — 평가 화면 사전 점검(preflight)이 numCtx와 비교하는 데 사용
export const DEFAULT_PLANNER_PROMPT      // {{TOOL_CATALOG}} 등 포함 기본 시스템 프롬프트(한국어)
```
실행 공통: 각 단계에서 mockEngine.executeTool 호출, trace 이벤트 방출, maxSteps 초과 시 중단.
LLM 응답 파싱 실패 시 1회 재요청("JSON만 출력") 후 실패 처리. signal abort 시 즉시 중단(cancelled).
토큰 계측: 각 LLM 호출의 promptTokens/outputTokens를 result.inputTokens/outputTokens에 합산(실측 없으면 추정 + tokensEstimated=true).
신뢰도 플래그: 프롬프트 전체 추정(chars/2.2) > numCtx 또는 실측 promptTokens ≥ numCtx×0.98 시 `ctxOverflow=true`,
db 검색이 폴백으로 실행되면 `retrievalFallback='<사유>'`(최초 1회) 기록 — evaluator가 item.metrics로 옮긴다.

## 8. evaluator.js (계약)

```js
export function scoreItem(expected = [], actualSteps = [], { ordered = true, alternatives, goal } = {})  // ItemMetrics(토큰 필드 제외)
// ordered=false: seqAccuracy=멀티셋 유사도, exactMatch=멀티셋 동일성.
// alternatives: 각 항목은 step 배열 또는 {steps, goal?} 객체(정규화) — 본 정답과 함께 채점 후 F1 최대 후보 채택,
//   채택 인덱스는 matchedAlternative(null=본 정답). goal: 목표 도구 — goalAchieved 판정 기준(§3 BenchmarkItem 우선순위 참조).
// 파라미터 비교는 도메인 정규화 적용(공백/대소문자, 역명 끝 '역' 제거, 영숫자 ID 공백·하이픈 무시)
// 도구 식별자 = `${serverId}/${toolName}`.
// precision/recall/f1: 멀티셋 교집합 기준. seqAccuracy: 1 - (레벤슈타인(expectedSeq, actualSeq) / max(len)).
// exactMatch: 시퀀스 완전 일치(파라미터 제외). paramScore: expected[i].params 있는 항목만 키별 일치율 평균(없으면 null).
// 추가 산출: callSuccessRate / extraToolRate / goalAchieved / compositeScore (§3 ItemMetrics 정의 참조).
// 토큰(inputTokens/outputTokens/totalTokens/tokensEstimated)과 ctxOverflow/retrievalFallback은
//   scoreItem이 아니라 runEvaluation이 ExecutionResult에서 metrics로 병합한다.
export function summarize(items)                  // SummaryMetrics
export async function runEvaluation({ benchmarkSet, strategies, mcps, model, temperature, maxSteps, onProgress, signal })
// model 지정 시 모든 전략에 강제 적용(공정 비교). temperature 지정 시 config.temperature 강제.
// maxSteps: 유한 양수이면 prompt/db 전략의 config.maxSteps를 실행용 클론에서 오버라이드(원본 전략 무변경, rule/skill 제외).
// 항목에 hasStepErrors/usedFallback 기록, metrics에 토큰·ctxOverflow·retrievalFallback 병합.
// summarize에 fallbackRate·avgF1Matched(폴백 제외 F1)·ctxOverflowCount·retrievalFallbackCount 포함.
// errorRate = (ok===false 또는 hasStepErrors) 항목 비율. EvalRun 반환(저장은 호출측)
export function finalizeScores(run)               // run 레벨 후처리(runEvaluation 종료 시 자동 호출)
// 전략 간 avgTotalTokens 비율로 tokenEfficiency(가장 적은 전략=1, run 내 상대)와
// orchestrationScore(0.85·avgComposite + 0.15·tokenEfficiency)를 각 perStrategy.summary에 주입.
```

## 9. 라우트

| 해시 | 뷰 | 내용 |
|---|---|---|
| `#/dashboard` | dashboard | 통계 카드, 시스템 상태(Ollama 연결/모델), 최근 실행, 빠른 시작 |
| `#/mcps` | mcps | MCP 카탈로그(검색/카테고리 필터/카드 그리드/상세 패널/삭제/샘플 복원) |
| `#/mcps/new` | mcpBuilder | 수동 폼 + AI 생성 탭 |
| `#/mcps/edit/:id` | mcpBuilder | 기존 서버 수정 |
| `#/orchestration`, `#/orchestration/:id` | orchestration | 전략 목록 + 편집기(4타입) + 테스트 콘솔 + 가져오기/내보내기 |
| `#/playground` | playground | 실시간 테스트 — 전략 다중 선택 즉석 질의·나란히 비교, 벤치마크 문항 대조 모드(문항 채점) |
| `#/benchmarks`, `#/benchmarks/:id` | benchmarks | 세트 목록/상세, 자동 생성 마법사, 수동 항목 작성기, 세트 조합(중복 제거) |
| `#/evaluation`, `#/evaluation/:runId` | evaluation | 실행 설정(세트+전략 다중선택, 사전 점검) → 진행 → 결과(리더보드/차트/상세) + 이력 |
| `#/settings` | settings | Ollama 연결, 모델 선택, num_ctx·LLM 타임아웃, 계정 관리, 데이터 백업/복원/초기화 |
| `#/guide` | guide | 사용 가이드 + OLLAMA_ORIGINS 설정 안내 |

라우터: `router.register('/mcps/edit/:id', renderFn)` 지원, `navigate(path)`, 파라미터는 `ctx.params`.

## 10. ui.js (계약 — 구현 완료)

```js
el(tag, attrs, ...children)   // attrs: {class, dataset, onclick, ...}; children: Node|string|array
toast(message, type='info')   // 'info'|'success'|'warn'|'error'
modal({ title, body, actions, wide })  // body: Node, actions: [{label, class, onClick}] — 반환 {close}
confirmDialog(message)        // Promise<boolean>
jsonEditor({ value, onChange, height })  // JSON 텍스트에어리어+유효성 표시 — 반환 {root, get, set, isValid}
badge(text, kind)             // 카테고리/상태 뱃지 Node
emptyState({ icon, title, desc, action })
spinner(size)
field({ label, hint, input })  // 폼 필드 래퍼
segmented(options, value, onChange)   // 세그먼트 컨트롤
schemaTable(schema)           // JSON Schema를 사람이 읽기 좋은 테이블 Node로
workflowChips(steps, mcps)    // [{serverId,toolName}] → 노선도풍 단계 칩 시각화 Node
```

## 11. 디자인 시스템 요약

관제센터(Control Room) 다크 테마. 토큰은 main.css `:root` 정의 — 재사용할 것:
`--bg0/--bg1/--bg2/--bg3`(배경 계층), `--line`(보더), `--tx0/--tx1/--tx2`(텍스트),
`--sig-green`(#31d07c 계열 주 액센트=철도 녹색 신호), `--sig-amber`, `--sig-red`, `--sig-blue`,
`--font-sans`(IBM Plex Sans KR), `--font-mono`(IBM Plex Mono), `--r1/--r2/--r3`(radius).
컴포넌트 클래스: `.card`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.input`, `.select`,
`.chip`, `.tbl`, `.panel-title`, `.kpi`, `.trace-log` 등 main.css 참조.

## 12. 품질 기준

- 빈 상태(데이터 없음)마다 emptyState + 행동 유도 버튼.
- 모든 비동기 작업에 로딩 표시 + 실패 toast(원인 포함).
- Ollama 미연결 시에도 앱 전체가 동작해야 함(LLM 기능 버튼에만 경고).
- 삭제는 confirmDialog 필수. 샘플 MCP는 "샘플 복원" 버튼으로 재시드 가능.
- localStorage 5MB 한계 고려: 실행 이력(runs)은 최근 20개만 유지.
