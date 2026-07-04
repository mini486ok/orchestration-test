# SPEC-GRAPH — DB 전략 (vector / graph 카탈로그 db 오케스트레이션)

오케스트레이션 전략에 **4번째 타입 `db`**를 추가한다(기존 `prompt`·`skill`·`rule`과 나란히).
DB 전략은 MCP 카탈로그를 **vector db**(임베딩 인덱스) 또는 **graph db**(도구 관계 그래프)로 구축하고,
질의로 관련 도구를 검색해 플래너(LLM)에 공급하는 방식으로 동작한다.

- **vector db**: 기존 `catalogIndex.js`(임베딩 인덱스 + vector/keyword/hybrid 검색) 재사용.
- **graph db**: 신규 `catalogGraph.js`. 도구=노드, 도구 간 관계=엣지 그래프를 브라우저에 구축하고,
  질의 시드에서 그래프를 순회해 관련 도구를 찾는다.

**핵심 원칙**: db 종류 선택과 모든 파라미터(vector: method·topK·임계값·가중치 / graph: 엣지 유형 on-off·가중치·임계값·hop 수)는
**DB 전략 편집기에서 설정**하여 다양하게 테스트한다. graph의 무거운 후보 엣지 계산은 그래프 구축 시 1회 수행(모든 후보 저장)하고,
파라미터는 검색·시각화 시점에 즉시 조합한다.

> 참고: 기존 `prompt` 전략의 `catalogMode`(retrieval) 코드 경로는 하위호환으로 남기되, 신규 UI에서는 검색 기반을
> DB 전략으로 이관한다. 기존 샘플 "검색증강 플래너"는 DB(vector) 전략 샘플로 재작성한다.

## 0. 원칙 / 제약

- 순수 정적 SPA, Vanilla JS ES modules. 외부 라이브러리·외부 DB 금지(브라우저 내장 경량 구현).
- 그래프는 store 키 `catalogGraph`에 저장. 임베딩 벡터는 `catalogIndex.js`의 인덱스를 재사용(semantic 엣지용).
- 한국어 UI, `ui.el` 사용(innerHTML 금지). SPEC.md §0 절대 규칙 준수.
- 로컬 Ollama 미연결이어도 semantic 이외 엣지(io/server/category/cooccur)만으로 그래프 구축·검색이 동작해야 한다.

## 1. services/catalogGraph.js (신규) — 그래프 엔진

임베딩 접근은 `catalogIndex.js`의 인덱스(store `catalogIndex`)를 읽어 재사용한다.
도구 식별자 = `${serverId}/${toolName}`. 노드 목록은 `flattenTools(mcps)` 순서(등록 순).

### 저장 형태 (store `catalogGraph`)
```js
{
  builtAt: ISO,
  fingerprint: string,          // mcps + benchmarks + (semantic 사용 시 embedModel) 기반
  usedEmbed: boolean,           // semantic 후보를 계산했는지(인덱스 존재 여부)
  embedModel: string|null,
  nodes: [{ serverId, toolName, category, serverNameKo }],   // 인덱스 = 노드 id
  // 후보 엣지: 유형별로 "가능한 모든" 관계를 저장(파라미터는 런타임 적용).
  edges: [{ a: int, b: int, type: 'io'|'semantic'|'server'|'category'|'cooccur',
            directed: bool, raw: number }],
  // raw 의미: io=매칭 필드수 기반 0~1, semantic=코사인 0~1, server/category=1,
  //           cooccur=공출현 횟수(정수, 런타임에 정규화)
  stats: { nodeCount, edgeCountByType: {io, semantic, server, category, cooccur} }
}
```

### 엣지 후보 계산 규칙 (buildGraph)
엣지 유형은 6종: io, semantic, server, category, cooccur, **llm**. 계산 비용에 따라 두 부류로 나뉜다.
- **경량(항상 계산)**: io, server, category, cooccur — 스키마·메타데이터·벤치마크만으로 계산(LLM/임베딩 불필요, 수십 ms).
- **임베딩 필요**: semantic — `catalogIndex` 인덱스 벡터 재사용(인덱스 없으면 생략).
- **LLM 추출 필요(옵션, 무거움)**: llm — `buildGraph`의 `includeLlm:true`일 때만 계산. 도구당 1회 LLM 호출(O(n)), 수십 초~수 분 소요이므로 **기본 미포함**.

- **io (입출력 스키마 연결, 방향 A→B)**: 도구 A의 outputSchema.properties 키 집합과 도구 B의 inputSchema.properties/required 키 집합의 교집합. 겹치는 키가 1개 이상이면 엣지. raw = 겹친 키 수 / max(1, B의 필수 키 수). 키 비교는 소문자+trim. 같은 서버 내 자기 자신 제외. 상한: 노드당 out-degree 상위 12개만 저장(과밀 방지).
- **semantic (무방향)**: 인덱스 벡터 코사인. `buildSemanticThreshold`(기본 0.55) 이상인 쌍만 저장. 노드당 상위 8개만(kNN). 인덱스 없으면 semantic 후보 없음(usedEmbed=false).
- **server (무방향)**: 같은 serverId 도구쌍. raw=1.
- **category (무방향)**: 같은 category(서버 기준) 도구쌍. 단 server 엣지와 중복되는 동일서버쌍은 category에서 제외(서버가 이미 연결). raw=1. 과밀 방지: 카테고리 노드가 40개 초과면 카테고리 엣지는 "카테고리 대표(서버별 첫 도구)" 간에만 저장하고 그 사실을 stats에 표기.
- **cooccur (무방향)**: 모든 benchmarks의 각 item.expected(및 alternatives) 워크플로우에서 함께 등장한 도구쌍의 등장 횟수. raw=횟수. 인접뿐 아니라 같은 워크플로우 내 모든 쌍.
- **llm (LLM 의미 관계 추출, 방향 A→B)**: `includeLlm:true`일 때만. 각 도구에 대해 `extractModel` LLM으로 1회 호출하여 그 도구가 **소비(requires)**하는 개념과 **생산(produces)**하는 개념을 키워드로 추출(chatJSON, `{requires:[...], produces:[...]}`). 이후 A.produces ∩ B.requires 교집합이 있으면 방향 엣지 A→B, raw = 겹친 개념 수(정규화 전). io의 "의미 버전"으로, 스키마 필드명이 달라도 개념이 이어지면 연결한다. onProgress로 도구별 진행률 방출, signal abort 지원. 실패한 도구는 건너뜀(경고). 추출 결과(도구별 requires/produces)도 graph에 함께 저장해 재계산 없이 재사용 가능하면 저장.

### API
```js
export const GRAPH_KEY = 'catalogGraph';
export function graphFingerprint(mcps, benchmarks, embedModel) // 문자열
export function graphStatus(mcps, benchmarks, embedModel)
// → { exists, stale, builtAt, nodeCount, edgeCountByType, usedEmbed, embedModel }
export async function buildGraph({ mcps, benchmarks, embedModel='bge-m3:latest',
    buildSemanticThreshold=0.55, onProgress, signal })
// 인덱스가 있으면 semantic 후보 계산(코사인). 없으면 생략. onProgress({phase, done, total}).
// store.set(GRAPH_KEY, graph). 반환: graphStatus 결과.

// 런타임 파라미터로 유효 엣지(가중 인접리스트) 구성
export function effectiveAdjacency(graph, edgeParams)
// edgeParams: { io:{on,weight,threshold}, semantic:{on,weight,threshold},
//   server:{on,weight}, category:{on,weight}, cooccur:{on,weight,threshold} }
// 각 엣지: type이 on이고 raw≥threshold(threshold 없는 유형은 무시)이면 채택,
//   가중치 = weight * normalized(raw)  (cooccur는 전체 최대값으로 정규화, io/semantic은 raw 그대로,
//   server/category는 1). 방향 io는 a→b, 나머지는 양방향.
// 반환: Map<nodeIdx, Array<{to, w, type, directed}>>

export async function graphRetrieve(query, {
  mcps, graph, edgeParams, seedMethod='hybrid', seedK=5, hops=2,
  decay=0.5, topK=8, embedModel, index?, signal })
// 1) 시드: catalogIndex.retrieve(query,{method:seedMethod,topK:seedK,...})로 시드 도구 선택
//    (인덱스 없거나 seedMethod=keyword면 BM25 시드). 시드 점수 = 검색 점수(정규화 0~1).
// 2) 전파: 시드에서 hops 단계 가중 확산 — score[n] += seedScore * (decay^dist) * edgeWeightProduct(경로).
//    구현은 hops회 반복의 가중 BFS/relaxation(개인화 PageRank의 유한 홉 근사): 각 단계에서
//    이웃에 score * decay * w 를 더함. 누적 상한 없음, 수렴 불필요(hops 작음).
// 3) 최종 점수 = α*시드검색점수 + (1-α)*그래프전파점수 (α=0.5 고정 또는 decay와 별개 파라미터 blend).
//    간단히: final = seedScore(있으면) + graphScore. 정렬 내림차순.
// 4) topK 반환. 각 결과에 source: 'seed' | 'graph'(hop≥1), viaEdges(주요 엣지 타입) 정보.
// 반환: { results:[{serverId,toolName,score,source,hop}], seeds:[...], usedEmbed, fallbackReason }

export async function recommendPaths(query, {
  mcps, graph, edgeParams, seedMethod='hybrid', seedK=3, maxLen=4, index?, embedModel, signal })
// async — 시드 확보에 catalogIndex.retrieve(async)를 쓰므로 반드시 await. graphRetrieve도 async.
// io(방향) 엣지 중심으로 시드에서 시작하는 가중 경로(최대 maxLen 노드)를 탐욕/빔서치로 탐색.
// 반환: { paths: [{ steps:[{serverId,toolName}], score }], note }  (최대 5개)
// io 엣지가 하나도 없으면 paths=[] + note.
```

## 2. Strategy 데이터 모델 — type 'db'

```js
Strategy { id, name, description, type: 'db', model, createdAt, updatedAt, config }
config = {
  store: 'vector' | 'graph',        // db 종류
  planningMode: 'plan' | 'react',   // 검색된 도구로 계획 수립
  temperature: 0.1, maxSteps: 6,
  systemPrompt: string,             // 플래너 프롬프트({{TOOL_CATALOG}}는 검색된 도구로 치환됨)
  vector: {                          // store==='vector'일 때
    method: 'vector'|'keyword'|'hybrid', topK: 8, threshold: 0,
    hybridAlpha: 0.5, expandServer: true, expandCategory: false, embedModel: 'bge-m3:latest',
  },
  graph: {                           // store==='graph'일 때
    edges: {
      io:       { on:true,  weight:1.0, threshold:0.0 },
      semantic: { on:true,  weight:1.0, threshold:0.55 },
      server:   { on:true,  weight:0.5 },
      category: { on:false, weight:0.3 },
      cooccur:  { on:true,  weight:1.0, threshold:1 },
      llm:      { on:false, weight:1.0, threshold:1 },   // 무거움 → 기본 off
    },
    seedMethod: 'hybrid', seedK: 5, hops: 2, decay: 0.5, topK: 8,
    embedModel: null,      // null → settings.defaultModel 대신 임베딩 기본 'bge-m3:latest' 사용. 선택 가능
    extractModel: null,    // null → settings.defaultModel 사용. llm 엣지 추출용 LLM. 선택 가능
  },
}
```

### 파라미터 기본값 원칙 (시간효율 최적화 + 일반적)
- **일반적으로 많이 쓰는 값 + 시간효율**을 기본값으로 하되 모두 사용자 조절 가능.
- 무거운 옵션은 기본 **off/보수적**: `edges.llm.on=false`(도구당 LLM 호출), `edges.category.on=false`(과밀). `hops=2`·`seedK=5`(과도한 확산 방지). vector는 `method='hybrid'`(품질·속도 균형)·`topK=8`.
- 켜면 유용하지만 인덱스/벤치마크 의존: `semantic`(인덱스 있을 때 자동 활용), `cooccur`(벤치마크 있을 때). 인덱스·벤치마크 없으면 해당 엣지는 자동으로 비게 되며 나머지로 동작.
- 임베딩 모델·추출 LLM 모델은 **드롭다운으로 설치된 모델 중 선택**(`ollama.listModels`), 미선택 시 위 기본값.

## 3. services/orchestrator.js — db 전략 실행

- `executeStrategy`에 `type==='db'` 분기 추가(`runDb`). 동작:
  1. `store==='vector'`이면 `catalogIndex.retrieve(query, {...config.vector})`, `store==='graph'`이면
     `catalogGraph.graphRetrieve(query, {...config.graph, graph, index})`로 관련 도구 검색.
  2. 검색 결과 도구들로 축소 카탈로그(`reduceMcps`) 구성 → 이후는 prompt/plan(또는 react)과 동일하게 플래너 실행.
  3. trace emit: `DB 검색(vector|graph): N개 도구` + 상세(도구·점수·source·hop). 인덱스/그래프 없음·stale이면
     가능한 폴백(vector→keyword, graph→vector 또는 keyword) + 경고 trace. 검색 임베딩은 llmCalls 미집계(totalLatencyMs만).
- 축소 카탈로그·플래너 로직은 기존 것을 재사용(prompt 실행 경로 공유). 기존 prompt/skill/rule 회귀 금지.
- `ExecutionResult`는 동일. 결과 카드에 검색된 도구 수를 표기할 수 있게 trace로 노출.

## 4. views/orchestration.js — DB 전략 타입 추가

- **전략 타입 등록**: 새 전략 모달·`TYPE_META`에 `db` 추가(아이콘 🗄️, 색 violet, 설명: "카탈로그를 vector/graph db로 구축해 관련 도구만 플래너에 공급"). `defaultConfig('db')`, `validateStrategy`(db: systemPrompt 필수, store 유효, graph면 최소 1개 엣지 on) 추가.
- **DB 전략 편집기**(`dbEditor(draft)`):
  1. 공통: db 종류 세그먼트(**vector db / graph db**), planningMode 세그먼트(plan/react), temperature, maxSteps, systemPrompt textarea(기본값 = 플래너 프롬프트, {{TOOL_CATALOG}} 안내).
  2. **vector db 선택 시**: method 세그먼트, topK, threshold, hybridAlpha(hybrid만), expandServer/Category 체크, embedModel + **인덱스 상태 카드**([구축/재구축] 버튼·진행률·stale 경고, `catalogIndex.indexStatus/buildIndex` 재사용).
  3. **graph db 선택 시**:
     - **엣지 설정 카드**: 6종(io/semantic/server/category/cooccur/**llm**) 각 [on/off]+[가중치 0~2 슬라이더]+[임계값](io·semantic·cooccur·llm). 유형별 한국어 설명. **llm 엣지**는 "LLM으로 도구 간 의미 관계를 추출(그래프 구축 시 도구당 1회 LLM 호출, 시간 소요)"이라는 경고 포함.
     - **순회 파라미터**: 시드 방식(vector/keyword/hybrid), seedK(1~20), hops(1~4), decay(0~1), topK(1~30).
     - **모델 선택**: 임베딩 모델(embedModel)·추출 LLM(extractModel) 각각 `ollama.listModels` 드롭다운(기본값 표기, 미선택 시 임베딩=bge-m3, 추출=settings.defaultModel). Ollama 미연결이면 인풋으로 폴백.
     - **그래프 db 상태 카드**: `graphStatus`(구축 여부·노드 수·유형별 엣지 수(llm 포함)·semantic/llm 사용 여부·구축 시각·stale) + [그래프 구축/재구축](진행률). llm 엣지가 on이면 구축 시 `includeLlm:true`로 LLM 추출 수행 + "도구당 1회 LLM 호출로 시간이 걸립니다" 확인. 인덱스 없으면 "의미 유사 엣지 제외하고 구축" 안내. mcps·benchmarks 변경 시 stale.
     - **그래프 시각화**: 현재 엣지 파라미터로 `effectiveAdjacency` 반영 SVG(노드=도구·색=카테고리, 엣지=유형별 색). 유효 엣지 있는 노드 위주, 카테고리 원형/경량 force 배치, hover 툴팁·클릭 강조. 파라미터 변경 시 재구축 없이 즉시 다시 그림. 노드 과다 시 상위 엣지 샘플 + 안내.
     - **검색 결과 미리보기**: 질의 입력 → `graphRetrieve` → 선택 도구(점수·source·hop) `workflowChips` + 시각화에서 시드/선택 강조.
     - **워크플로우 경로 추천**: 같은 질의 → `recommendPaths` → 경로 칩(`workflowChips`).
  4. **테스트 콘솔 공용**: 기존 테스트 콘솔(executeStrategy)로 db 전략도 단건 실행 가능.
- 저장 시 config 저장. CSS는 main.css 최하단 `/* --- DB 전략 (graph) --- */` append.

## 5. data/samples.js — DB 전략 샘플 2개

- **sample-strategy-5** 재작성: **"벡터 DB 플래너"** — type 'db', store 'vector', vector 기본값(hybrid/topK 8/expandServer), planningMode plan, systemPrompt=플래너. description: 임베딩 벡터 db로 관련 도구만 검색해 공급, "실행 전 벡터 인덱스 구축 필요".
- **sample-strategy-6** 신규: **"그래프 DB 플래너"** — type 'db', store 'graph', graph 기본값(§2), planningMode plan. description: 도구 관계 그래프를 순회해 연관 도구를 함께 공급, "실행 전 그래프 db 구축 필요".
- 두 샘플 모두 실제 존재하는 서버/도구만 참조하는 systemPrompt(전략1 프롬프트 복제 가능).

## 6. buildGraph LLM 추출 시그니처 (엔진 보강)

```js
export async function buildGraph({ mcps, benchmarks, embedModel='bge-m3:latest',
    buildSemanticThreshold=0.55, includeLlm=false, extractModel, onProgress, signal })
// includeLlm=true면 각 도구를 extractModel(미지정 시 ollama.getDefaultModel())로 chatJSON 호출해
//   {requires:[], produces:[]} 추출 → llm 후보 엣지 계산·저장. onProgress({phase:'llm', done, total}).
// graphStatus/그래프 저장에 usedLlm, extractModel 포함. graphFingerprint에 includeLlm·extractModel 반영
//   (llm 엣지 유무·추출 모델이 바뀌면 stale).
```

## 7. views/playground.js (신규) — 실시간 테스트 플레이그라운드

구축한 전략들을 골라 **실시간으로 질의·답변을 테스트/비교**하는 독립 화면. (기존 오케스트레이션 편집기 안의 테스트 콘솔과 별개의 전용 화면)

- **라우트/내비**: `#/playground`, 사이드바 WORKSPACE 그룹에 "실시간 테스트"(아이콘 ⚡) 추가. app.js에 라우트 등록 + NAV 항목.
- **전략 선택**: 등록된 전략 다중 선택(체크박스 목록, 타입 뱃지). 1개 이상 선택 시 실행 가능. 전체 선택/해제.
- **질의 입력 + 실행**: 입력창 + [실행](Enter). 선택된 전략들을 **동시에(병렬 Promise) 실행**하되 각 전략 카드에 개별 로딩·결과. 각 전략별 AbortController + 전체 [중단].
- **결과 비교 뷰**: 전략별 카드(그리드) — 전략명·타입 뱃지, 상태(성공/실패/부분), **호출된 워크플로우**(`workflowChips`), finalAnswer(있으면), LLM 호출 수·지연·검색된 도구 수(db 전략), 그리고 접이식 실행 트레이스(`.trace-log`). DB 전략이면 검색 방식·도구 수 표기.
- **대화 히스토리**: 여러 질의를 연속 실행하면 히스토리로 누적(질의별 섹션). 각 질의 재실행·삭제. (전략 실행은 무상태 단건이며, 히스토리는 UI 편의)
- **결과 내보내기**: 현재 질의의 전략별 결과를 JSON으로 내보내기(선택).
- Ollama 미연결 시 rule 등 LLM 불필요 전략은 실행 가능, LLM 필요 전략은 개별 카드에 친절한 오류. `executeStrategy(strategy, query, {mcps, onTrace, signal})` 사용. store 경유, ui.el, 한국어.

## 8. 가이드 (리드가 반영)

가이드에 "🗄️ DB 전략 (vector / graph db)" 섹션(vector/graph 선택, 엣지 6종·llm 추출 모델 선택·파라미터 튜닝, 시각화·경로추천, 평가 화면 비교)과 "⚡ 실시간 테스트" 섹션(전략 다중 선택 실시간 비교) 추가.
