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
assets/js/app.js                # 엔트리: 인증 게이트 → 셸 → 라우터
assets/js/core/store.js         # 상태/영속화 (pub/sub)
assets/js/core/router.js        # 해시 라우터
assets/js/core/ui.js            # DOM/컴포넌트 헬퍼 (el, toast, modal, confirm, jsonEditor, ...)
assets/js/core/auth.js          # PBKDF2 계정/세션
assets/js/core/charts.js        # SVG 차트 (bar, groupedBar, radar, donut)
assets/js/services/ollama.js    # Ollama 클라이언트
assets/js/services/mockEngine.js# MCP 모의 실행 엔진
assets/js/services/orchestrator.js # 전략 실행 엔진 (3종)
assets/js/services/benchmarkGen.js # LLM 벤치마크 자동 생성
assets/js/services/evaluator.js # 평가 지표 계산
assets/js/data/sampleMcps.js    # 샘플 MCP 30개
assets/js/data/samples.js       # 샘플 전략/벤치마크 시드
assets/js/views/{login,dashboard,mcps,mcpBuilder,orchestration,benchmarks,evaluation,settings,guide}.js
docs/SPEC.md
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
- `settings`: `{ ollamaUrl: 'http://localhost:11434', defaultModel: 'exaone3.5:7.8b', temperature: 0.2, maxSteps: 6, numCtx: 8192 }`
- `accounts`: `[{ id, username, role: 'admin'|'user', salt, hash, iterations, createdAt }]`
- `session`: `{ username, role, loginAt } | null`
- `mcps`: `McpServer[]`
- `strategies`: `Strategy[]`
- `benchmarks`: `BenchmarkSet[]`
- `runs`: `EvalRun[]` (최신이 앞)

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
  type: 'prompt' | 'skill' | 'rule',
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

### BenchmarkSet / BenchmarkItem
```js
BenchmarkSet { id, name, description, createdAt, items: BenchmarkItem[] }
BenchmarkItem {
  id, query: '내일 아침 서울에서 부산 가는 KTX 알려줘',
  expected: [{ serverId, toolName, params?: object }],   // 정답 워크플로우(기본: 순서 있음)
  ordered?: boolean,          // false면 순서무관 채점(멀티셋 기준). 기본 true
  alternatives?: [[...]],     // 대안 정답 워크플로우 배열(있으면 각 정답에 채점 후 F1 최대 채택)
  category?: string, difficulty: 'easy'|'medium'|'hard',
  source: 'auto'|'manual', notes?: string
}
```

### ExecutionResult (orchestrator 반환)
```js
{
  ok: boolean,               // plan/skill/rule: 단계 오류 발생 시 false로 강등. react: final_answer 미도달 시 false
  steps: [{ serverId, toolName, params, output, latencyMs, error? }],
  trace: [TraceEvent],   // {ts, type:'info'|'llm-request'|'llm-response'|'tool-call'|'tool-result'|'error', label, detail?}
  llmCalls: number,          // 실제 HTTP 호출 수(chatJSON 재시도 포함)
  hasStepErrors?: boolean,   // 단계 오류 존재 여부(모든 경로에서 기록)
  usedFallback?: boolean,    // rule 전략이 LLM 폴백으로 실행된 경우 true
  totalLatencyMs: number, error?: string, finalAnswer?: string
}
```

### EvalRun
```js
{
  id, name, createdAt, benchmarkSetId, benchmarkSetName, strategyIds: [],
  status: 'running'|'done'|'cancelled'|'error',
  perStrategy: {
    [strategyId]: {
      strategyName, items: [{ itemId, query, expected, actual: steps, metrics: ItemMetrics, error?, latencyMs, llmCalls }],
      summary: SummaryMetrics
    }
  }
}
ItemMetrics { precision, recall, f1, seqAccuracy, exactMatch: 0|1, paramScore: number|null }
SummaryMetrics { avgPrecision, avgRecall, avgF1, avgSeqAccuracy, exactMatchRate, avgParamScore, avgLatencyMs, avgLlmCalls, errorRate, itemCount }
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
export function getOllamaUrl()                 // settings에서. num_ctx는 settings.numCtx(기본 8192) 사용
```
주의: exaone3.5는 tool-calling 미지원 → 모든 구조화 출력은 JSON 텍스트 파싱으로 처리.

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
// 반환: ExecutionResult. 내부에서 타입별 실행기 분기.
export function buildToolCatalog(mcps)   // LLM 프롬프트용 도구 카탈로그 텍스트(간결, 토큰 절약형)
export const DEFAULT_PLANNER_PROMPT      // {{TOOL_CATALOG}} 등 포함 기본 시스템 프롬프트(한국어)
```
실행 공통: 각 단계에서 mockEngine.executeTool 호출, trace 이벤트 방출, maxSteps 초과 시 중단.
LLM 응답 파싱 실패 시 1회 재요청("JSON만 출력") 후 실패 처리. signal abort 시 즉시 중단(cancelled).

## 8. evaluator.js (계약)

```js
export function scoreItem(expected, actualSteps, { ordered = true, alternatives } = {})  // ItemMetrics
// ordered=false: seqAccuracy=멀티셋 유사도, exactMatch=멀티셋 동일성. alternatives: 각 정답 채점 후 F1 최대 채택.
// 파라미터 비교는 도메인 정규화 적용(공백/대소문자, 역명 끝 '역' 제거, 영숫자 ID 공백·하이픈 무시)
// 도구 식별자 = `${serverId}/${toolName}`.
// precision/recall/f1: 멀티셋 교집합 기준. seqAccuracy: 1 - (레벤슈타인(expectedSeq, actualSeq) / max(len)).
// exactMatch: 시퀀스 완전 일치(파라미터 제외). paramScore: expected[i].params 있는 항목만 키별 일치율 평균(없으면 null).
export function summarize(items)                  // SummaryMetrics
export async function runEvaluation({ benchmarkSet, strategies, mcps, model, temperature, onProgress, signal })
// model 지정 시 모든 전략에 강제 적용(공정 비교). temperature 지정 시 config.temperature 강제.
// 항목에 hasStepErrors/usedFallback 기록. summarize에 fallbackRate·avgF1Matched(폴백 제외 F1) 추가.
// errorRate = (ok===false 또는 hasStepErrors) 항목 비율. EvalRun 반환(저장은 호출측)
```

## 9. 라우트

| 해시 | 뷰 | 내용 |
|---|---|---|
| `#/dashboard` | dashboard | 통계 카드, 시스템 상태(Ollama 연결/모델), 최근 실행, 빠른 시작 |
| `#/mcps` | mcps | MCP 카탈로그(검색/카테고리 필터/카드 그리드/상세 패널/삭제/샘플 복원) |
| `#/mcps/new` | mcpBuilder | 수동 폼 + AI 생성 탭 |
| `#/mcps/edit/:id` | mcpBuilder | 기존 서버 수정 |
| `#/orchestration` | orchestration | 전략 목록 + 편집기(3타입) + 테스트 콘솔 + 가져오기/내보내기 |
| `#/benchmarks` | benchmarks | 세트 목록/상세, 자동 생성 마법사, 수동 항목 작성기 |
| `#/evaluation` | evaluation | 실행 설정(세트+전략 다중선택) → 진행 → 결과(리더보드/차트/상세) + 이력 |
| `#/settings` | settings | Ollama 연결, 모델 선택, 계정 관리, 데이터 백업/복원/초기화 |
| `#/guide` | guide | 사용 가이드 + OLLAMA_ORIGINS 설정 안내 |

라우터: `registerRoute('/mcps/edit/:id', renderFn)` 지원, `navigate(path)`, 파라미터는 `ctx.params`.

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
