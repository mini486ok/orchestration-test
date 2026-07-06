// ============================================================================
// catalogGraph.js — MCP 도구 카탈로그의 그래프 기반 공급(graph db) 엔진
// SPEC-GRAPH §1 계약 구현. 순수 ES module.
//
//  buildGraph({mcps, benchmarks, embedModel, ...})   후보 엣지 전량 계산 → store 'catalogGraph'
//  graphStatus(mcps, benchmarks, embedModel)         존재/stale/노드수/유형별 엣지수/semantic 사용 여부
//  effectiveAdjacency(graph, edgeParams, {maxDegree,hubNorm})  런타임 파라미터로 유효 가중 인접리스트 구성
//  graphRetrieve(query, {..., maxDegree, hubNorm})   시드 → 그래프 확산 → topK 도구 검색
//    §F2 옵션: queries[](멀티 시드 — 부질의별 라운드로빈 시드 선정 + 전역 정규화 relevance 병합, §H1),
//    relBonus(기본 0.5)·relevanceK(기본 15)·includeRelTopN(기본 0 — >0이면 "시드(seedK) 제외" 관련도
//    상위 N을 최종 topK에 보장 포함(비후보는 rel*relBonus로 편입, 절단 탈락분은 시드·창이 아닌 최하위
//    후보와 교체 — 시드는 보호), 유효 상한 min(N, relevanceK−seedK), §H1)
//  recommendPaths(query, {..., edges, beamWidth, maxLen})  방향(io/llm) 엣지 빔서치 워크플로우 경로 추천
//
// 도구 식별자 = `${serverId}/${toolName}`. 노드 목록 = flattenTools(mcps) 순서(등록 순).
// 임베딩 벡터는 catalogIndex(store 'catalogIndex')를 재사용(semantic 엣지·시드 검색용).
// 엣지 유형 6종: io, semantic, server, category, cooccur, llm(옵션·무거움).
// 임베딩·llm 추출은 llmCalls로 집계하지 않는다(호출측이 지연만 반영).
// ============================================================================
import { store } from '../core/store.js';
import { retrieve, indexStatus, INDEX_KEY } from './catalogIndex.js';
import { chatJSON, getDefaultModel } from './ollama.js';

export const GRAPH_KEY = 'catalogGraph';
const DEFAULT_EMBED_MODEL = 'bge-m3:latest';

// 과밀 방지 상한
// §3: 방향 엣지(io/llm)는 빌드 시 "넉넉히" 저장하고, 실제 노드당 상한은 런타임 maxDegree로 축소한다.
// 이렇게 하면 maxDegree 축소는 재구축 없이 즉시 반영되고, UI 슬라이더 범위(4~30)까지 확대도 재구축 없이 가능하다.
const IO_STORE_CAP = 30;        // io: 빌드 저장 상한(노드당 출력 방향 상위 30개; 런타임 maxDegree로 축소)
const LLM_STORE_CAP = 30;       // llm: 빌드 저장 상한(io와 동일 정책)
const DEFAULT_MAX_DEGREE = 12;  // 런타임 기본 노드당 방향 out-degree 상한(구 IO_OUT_CAP/LLM_OUT_CAP=12와 동일)
const SEMANTIC_KNN = 8;         // semantic: 노드당 코사인 상위 8개(kNN)
const CATEGORY_OVERCROWD = 40;  // category: 노드 40개 초과 시 서버 대표 간에만 연결
const SEMANTIC_STORE_FLOOR = 0.30; // semantic 후보 "저장 하한"(런타임 threshold와 분리 — E3)

// 무거운 O(n²) 단계(io·semantic)에서 UI에 제어권을 양보해 진행바 갱신·프리즈 방지(E8)
const YIELD_EVERY = 24;
const yieldToUi = () => new Promise((r) => setTimeout(r));

// --- G1 워크플로우 노출 튜닝 (회귀 없는 가중) ---
// 핵심: io를 일괄 우대하지 않는다. "같은 서버 내 io"(같은 데이터의 대체 뷰: search_trains→get_train_detail)는
// 그대로 두고, "다른 서버로의 io"(워크플로우 핸드오프: search_trains→check_seat_availability)만 우대한다.
// 이 구분이 예약 도구를 같은 서버 io 형제(get_train_detail)와 분리해 다단계 워크플로우 하류를 끌어올린다.
// 크로스서버 io 부스트는 "목표 노드의 질의 관련도"로 게이팅한다. 워크플로우 핸드오프를 우대하되,
// 관련 있는 목적지로의 핸드오프만 우대해 무관한 강-io 이웃(예: 휠체어 요청)이 관련 도구를 밀어내지 않게 한다.
const SEED_RELEVANCE_K = 15;      // 시드보다 넓게 질의 관련도 맵을 확보(그래프 도달 노드 블렌드/게이팅용)
const REL_GATE = 0.45;            // 이 관련도 이상이면 크로스서버 io 부스트 full 적용(그 미만은 비례 감쇠)
const IO_SAME_SERVER_MUL = 1.0;   // graphRetrieve: 같은 서버 io(대체 뷰)는 가중 없음
const IO_XSERVER_HOP1_MUL = 2.6;  // graphRetrieve: 관련 목적지로의 io 핸드오프(hop1) 최대 배율
const IO_XSERVER_MUL = 1.8;       // graphRetrieve: 관련 목적지로의 io 핸드오프(그 외 홉) 최대 배율
const GRAPH_REL_BONUS = 0.5;      // graphRetrieve: 그래프 도달(비시드) 노드에 질의 관련도 블렌드(SPEC α 일반화)
const PATH_BEAM = 10;             // recommendPaths: 빔 폭(짧은 정답 워크플로우 생존)
const PATH_START_K = 8;           // recommendPaths: 빔 시작을 상위 관련 도구로 넓힘(관련 워크플로우가 자기 경로를 시드)
const PATH_W_EDGE = 0.4;          // recommendPaths: 길이정규화 평균 엣지가중 비중
const PATH_W_REL = 0.6;           // recommendPaths: 경로 노드 평균 질의 관련도 비중(관련 워크플로우 우선)
const PATH_XSERVER_IO_MUL = 2.0;  // recommendPaths: 관련 목적지로의 크로스서버 io 핸드오프 최대 엣지가중 배율

/** 크로스서버 io 부스트 배율 — 목표 관련도(rel 0~1)로 게이팅: rel≥REL_GATE면 full, 그 미만은 비례. */
function xserverIoMul(maxMul, rel) {
  return 1 + (maxMul - 1) * Math.min(1, (rel || 0) / REL_GATE);
}

/* ============================================================
   공용 유틸
   ============================================================ */

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // djb2
  return h.toString(16);
}

function abortError() {
  const e = new Error('사용자에 의해 중단됨');
  e.name = 'AbortError';
  return e;
}

function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const round4 = (x) => Math.round((Number(x) || 0) * 1e4) / 1e4;

/** 키 정규화: 소문자 + trim (도메인 정규화 없이 단순 비교) */
function normKey(k) { return String(k || '').trim().toLowerCase(); }

/** property의 1단계 하위 properties(배열 items.properties 우선, 없으면 객체 properties). 없으면 null. */
function nestedProps(prop) {
  if (!prop || typeof prop !== 'object') return null;
  if (prop.items && prop.items.properties && typeof prop.items.properties === 'object') return prop.items.properties;
  if (prop.properties && typeof prop.properties === 'object') return prop.properties;
  return null;
}

/**
 * 스키마 property 키를 정규화(소문자+trim)해 수집한다. 최상위 키만으로는 실제 워크플로우 체인을 놓치므로
 * (예: search_trains 출력 trains[].trainNo → check_seat_availability 입력 trainNo), 배열의 items.properties·
 * 객체의 properties를 "1단계"까지 재귀 포함한다(그 이상은 내려가지 않음). 중복은 호출측 Set이 합친다.
 */
function collectSchemaKeys(schema) {
  const keys = [];
  const props = schema?.properties;
  if (!props || typeof props !== 'object') return keys;
  for (const [k, prop] of Object.entries(props)) {
    const nk = normKey(k);
    if (nk) keys.push(nk);
    const nested = nestedProps(prop);
    if (nested) {
      for (const ck of Object.keys(nested)) {
        const nck = normKey(ck);
        if (nck) keys.push(nck);
      }
    }
  }
  return keys;
}

function inputKeySet(schema) {
  const keys = collectSchemaKeys(schema);
  const req = (schema?.required || []).map(normKey).filter(Boolean);
  return new Set([...keys, ...req]);
}
function outputKeySet(schema) {
  return new Set(collectSchemaKeys(schema));
}
/** io raw 분모용 — 도구의 (최상위) 필수 입력 키 수. 중첩 키는 분모에 포함하지 않는다. */
function requiredCount(schema) {
  return (schema?.required || []).map(normKey).filter(Boolean).length;
}

/** 스키마 필드명(원문) — 최상위 + 1단계 중첩(부모.자식 형태). llm 추출 프롬프트용(중첩 키까지 노출). */
function schemaFieldNames(schema) {
  const names = [];
  const props = schema?.properties;
  if (!props || typeof props !== 'object') return names;
  for (const [k, prop] of Object.entries(props)) {
    names.push(k);
    const nested = nestedProps(prop);
    if (nested) for (const ck of Object.keys(nested)) names.push(`${k}.${ck}`);
  }
  return names;
}

/** 개념 키워드 정규화(소문자+trim) + 중복 제거. LLM 추출 requires/produces 매칭용. */
function normConcepts(arr) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(arr) ? arr : []) {
    const k = normKey(x);
    if (k && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/** 도구 1개의 llm 추출용 문서 텍스트 — 서버명/도구명/설명 + 입력·출력 필드명 */
function toolPromptText(node, tool) {
  const parts = [`서버: ${node.serverNameKo}`, `도구: ${node.toolName}`];
  if (tool?.description) parts.push(`설명: ${tool.description}`);
  const inK = schemaFieldNames(tool?.inputSchema);
  const outK = schemaFieldNames(tool?.outputSchema);
  if (inK.length) parts.push(`입력 필드: ${inK.join(', ')}`);
  if (outK.length) parts.push(`출력 필드: ${outK.join(', ')}`);
  return parts.join('\n');
}

/**
 * 도구 노드 평탄화(등록 순서 보존). 각 노드는 저장용 메타 + io 계산용 스키마 키 집합 + llm 추출용 텍스트를 보유.
 */
function flattenToolNodes(mcps) {
  const out = [];
  for (const srv of mcps || []) {
    if (!srv || !srv.id) continue;
    for (const tool of srv.tools || []) {
      if (!tool || !tool.name) continue;
      const node = {
        serverId: srv.id,
        toolName: tool.name,
        category: srv.category || '',
        serverNameKo: srv.nameKo || srv.name || srv.id,
        outKeys: outputKeySet(tool.outputSchema),
        inKeys: inputKeySet(tool.inputSchema),
        reqCount: requiredCount(tool.inputSchema),
      };
      node.promptText = toolPromptText(node, tool);
      out.push(node);
    }
  }
  return out;
}

/** 벤치마크 워크플로우 목록(expected + 각 alternatives)을 평탄화 */
function collectWorkflows(benchmarks) {
  const flows = [];
  for (const set of benchmarks || []) {
    for (const item of set?.items || []) {
      if (Array.isArray(item?.expected)) flows.push(item.expected);
      for (const alt of item?.alternatives || []) if (Array.isArray(alt)) flows.push(alt);
    }
  }
  return flows;
}

/* ============================================================
   핑거프린트 · 상태
   ============================================================ */

/**
 * 그래프 콘텐츠 지문 — 도구(서버/도구/카테고리 + 입력·출력 스키마 키), 벤치마크 워크플로우,
 * 그리고 semantic 사용 시 embedModel을 함께 해시한다.
 * 따라서 도구 추가/삭제/스키마 변경·카테고리 변경·설명(description)/param 텍스트 변경·벤치마크 변경(cooccur),
 * (semantic 사용 시)모델 변경이면 stale. 설명 텍스트를 포함하는 이유: semantic/llm 엣지와 시드 검색이
 * 도구 설명에 의존하므로 설명만 바뀌어도 재구축 대상임을 알려야 한다(G2).
 * @param {Array} mcps
 * @param {Array} benchmarks
 * @param {string|null} [embedModel] semantic 미사용 그래프면 null을 넘겨 임베딩 모델 변경을 무시한다.
 * @param {string|null} [extractModel] llm 미사용 그래프면 null/undefined를 넘겨 추출 모델 변경을 무시한다.
 */
export function graphFingerprint(mcps, benchmarks, embedModel, extractModel) {
  const SEP = ''; // 필드 구분자
  const REC = ''; // 레코드 구분자
  const nodes = flattenToolNodes(mcps);
  const toolKeys = nodes.map(n =>
    `${n.serverId}${SEP}${n.toolName}${SEP}${n.category}` +
    `${SEP}${[...n.outKeys].sort().join(',')}${SEP}${[...n.inKeys].sort().join(',')}` +
    `${SEP}${hashStr(n.promptText || '')}`, // G2: 설명/필드 텍스트 해시 포함(설명만 바뀌어도 stale)
  );
  toolKeys.sort();

  const flowKeys = collectWorkflows(benchmarks).map(wf => {
    const ids = wf
      .map(s => `${s?.serverId}/${s?.toolName}`)
      .filter(Boolean)
      .sort();
    return ids.join(',');
  });
  flowKeys.sort();

  return `${hashStr(toolKeys.join(REC))}:${nodes.length}:${hashStr(flowKeys.join(REC))}` +
    `:${embedModel || ''}:${extractModel || ''}`;
}

const EMPTY_EDGE_COUNTS = () => ({ io: 0, semantic: 0, server: 0, category: 0, cooccur: 0, llm: 0 });

/**
 * 그래프 상태 조회.
 * @param {Array} mcps
 * @param {Array} benchmarks
 * @param {string} [embedModel] 현재 선택 임베딩 모델(그래프가 semantic을 썼을 때만 stale 판정에 반영)
 * @param {string} [extractModel] 현재 선택 추출 LLM(그래프가 llm 엣지를 썼을 때만 stale 판정에 반영).
 *   미지정 시 그래프에 저장된 값을 사용해 추출 모델 변경만으로 stale 되지 않게 한다.
 * @param {{wantSemantic?:boolean, wantLlm?:boolean}} [opts] 하위호환 선택 인자(미지정 시 stale만으로 판정).
 *   현재 전략이 semantic/llm 엣지를 켜고자 하는지를 넘기면, 재구축이 그 엣지를 "새로" 포함하게 되는지를
 *   needsRebuild/rebuildReasons로 알려준다(파라미터 필터/가중치 조절은 재구축 불필요, 신규 포함만 필요).
 * @returns {{exists, stale, builtAt, nodeCount, edgeCountByType, usedEmbed, embedModel,
 *   usedLlm, extractModel, categoryReduced, needsRebuild, rebuildReasons, llmFailed}}
 */
export function graphStatus(mcps = [], benchmarks = [], embedModel, extractModel, opts = {}) {
  // G4: 4번째 인자로 opts 객체를 잘못 넘긴 하위호환 호출 보정(extractModel 자리에 {wantSemantic,...}).
  if (extractModel && typeof extractModel === 'object' && !Array.isArray(extractModel)) {
    opts = extractModel; extractModel = undefined;
  }
  const g = store.get(GRAPH_KEY);
  if (!g || !Array.isArray(g.nodes) || !g.nodes.length) {
    return {
      exists: false, stale: false, builtAt: null, nodeCount: 0,
      edgeCountByType: EMPTY_EDGE_COUNTS(), usedEmbed: false, embedModel: null,
      usedLlm: false, extractModel: null, categoryReduced: null,
      needsRebuild: false, rebuildReasons: [], llmFailed: 0,
    };
  }
  // semantic/llm을 실제로 쓴 그래프만 해당 모델을 지문에 반영 — 미사용 축은 모델 변경으로 stale 되지 않게.
  // G6: embed 축은 그래프 자신의 embedModel(=구축에 쓴 인덱스 모델)로 고정 비교한다. config에서 넘어온
  // embedModel(질의 시드용)이 달라도 저장된 semantic 엣지는 인덱스 벡터 재사용이므로 stale로 보지 않는다.
  // 실제 인덱스 재빌드(벡터 변경)는 아래 rebuildReasons의 indexStatus().stale로 별도 노출한다(G2).
  const fpEmbed = g.usedEmbed ? (g.embedModel || '') : null;
  const fpExtract = g.usedLlm ? (extractModel || g.extractModel || '') : null;
  const stale = g.fingerprint !== graphFingerprint(mcps, benchmarks, fpEmbed, fpExtract);

  // 재구축 필요 사유(E9) — 켜려는 엣지가 현재 그래프에 "아직 없어" 재구축해야만 포함되는 경우를 짚는다.
  const wantSemantic = !!(opts && opts.wantSemantic);
  const wantLlm = !!(opts && opts.wantLlm);
  const idx = store.get(INDEX_KEY);
  const indexExists = !!(idx && Array.isArray(idx.docs) && idx.docs.length);
  const rebuildReasons = [];
  if (stale) rebuildReasons.push('MCP·벤치마크·모델 구성이 변경되어 그래프가 최신이 아닙니다(stale).');
  if (wantSemantic && indexExists && !g.usedEmbed) {
    rebuildReasons.push('의미 유사(semantic) 엣지가 켜져 있고 임베딩 인덱스도 있으나, 현재 그래프는 인덱스 없이 구축되어 semantic 엣지가 없습니다. 재구축하면 포함됩니다.');
  }
  if (wantLlm && !g.usedLlm) {
    rebuildReasons.push('LLM 엣지가 켜져 있으나 현재 그래프는 LLM 추출 없이 구축되었습니다. 재구축하면 LLM 엣지가 포함됩니다(도구당 1회 LLM 호출).');
  }
  // G2: semantic을 쓴 그래프인데 그 기반 임베딩 인덱스가 stale이면(벡터 재빌드 대상) 재구축 사유로 노출.
  if (g.usedEmbed) {
    const idxSt = indexStatus(mcps, embedModel || g.embedModel);
    if (idxSt.exists && idxSt.stale) {
      rebuildReasons.push('의미 유사(semantic) 엣지의 기반 임베딩 인덱스가 stale입니다. 인덱스를 재구축한 뒤 그래프도 재구축하면 최신 벡터로 semantic 엣지가 갱신됩니다.');
    }
  }

  return {
    exists: true,
    stale,
    builtAt: g.builtAt || null,
    nodeCount: g.nodes.length,
    edgeCountByType: g.stats?.edgeCountByType || EMPTY_EDGE_COUNTS(),
    usedEmbed: !!g.usedEmbed,
    embedModel: g.embedModel || null,
    usedLlm: !!g.usedLlm,
    extractModel: g.extractModel || null,
    categoryReduced: g.stats?.categoryReduced || null,
    needsRebuild: rebuildReasons.length > 0,
    rebuildReasons,
    llmFailed: g.stats?.llmFailed || 0,
  };
}

/* ============================================================
   그래프 구축 (후보 엣지 전량 계산)
   ============================================================ */

/**
 * 도구 관계 그래프를 구축해 store 'catalogGraph'에 저장한다.
 * 후보 엣지는 유형별로 "가능한 모든" 관계를 저장하고, 파라미터는 검색·시각화 시점에 즉시 조합한다.
 * 경량 엣지(io/server/category/cooccur)는 항상, semantic은 인덱스가 있을 때, llm은 includeLlm=true일 때만 계산.
 * @param {{mcps:Array, benchmarks?:Array, embedModel?:string, buildSemanticThreshold?:number,
 *          includeLlm?:boolean, extractModel?:string, onProgress?:({phase,done,total})=>void,
 *          signal?:AbortSignal}} opts
 *   embedModel null/미지정 → 'bge-m3:latest'. includeLlm=true이고 extractModel 미지정 → ollama.getDefaultModel().
 *   buildSemanticThreshold는 런타임 필터가 아니라 semantic 후보의 "저장 하한"이다(기본 0.30). 런타임
 *   threshold(edgeParams.semantic.threshold)로 재구축 없이 조절하려면 후보를 넉넉히 저장해야 하므로,
 *   저장 하한은 SEMANTIC_STORE_FLOOR(0.30) 이하로만 적용된다(더 큰 값을 넘겨도 0.30까지는 저장).
 * @returns {Promise<object>} graphStatus 결과
 */
export async function buildGraph({
  mcps = [], benchmarks = [], embedModel = DEFAULT_EMBED_MODEL,
  buildSemanticThreshold = SEMANTIC_STORE_FLOOR, includeLlm = false, extractModel, onProgress, signal,
} = {}) {
  const nodes = flattenToolNodes(mcps);
  const N = nodes.length;
  if (!N) throw new Error('그래프를 구축할 도구가 없습니다. MCP를 먼저 등록하세요.');
  embedModel = embedModel || DEFAULT_EMBED_MODEL; // config에서 null이 넘어오면 기본값으로
  // 저장 하한: 요청값이 0.30보다 크면 0.30으로 낮춰 후보를 넉넉히 저장(런타임 threshold가 위에서 필터).
  const semanticStoreFloor = Math.min(
    Number.isFinite(buildSemanticThreshold) ? buildSemanticThreshold : SEMANTIC_STORE_FLOOR,
    SEMANTIC_STORE_FLOOR,
  );
  const checkAbort = () => { if (signal?.aborted) throw abortError(); };

  const edges = [];

  // -------- io (입출력 스키마 연결, 방향 A출력→B입력) --------
  onProgress?.({ phase: 'io', done: 0, total: N });
  for (let a = 0; a < N; a++) {
    checkAbort();
    const A = nodes[a];
    if (A.outKeys.size) {
      const cands = [];
      for (let b = 0; b < N; b++) {
        if (a === b) continue; // 자기 자신 제외
        const B = nodes[b];
        if (!B.inKeys.size) continue;
        let overlap = 0;
        for (const k of A.outKeys) if (B.inKeys.has(k)) overlap++;
        // raw는 [0,1]로 클램프(E1): 겹친 키 수가 B의 필수 키 수를 넘어도 1을 초과하지 않게 해 확산 폭주 방지.
        if (overlap > 0) cands.push({ b, raw: round4(Math.min(1, overlap / Math.max(1, B.reqCount))) });
      }
      cands.sort((x, y) => y.raw - x.raw); // out-degree 상위 IO_STORE_CAP개 저장(런타임 maxDegree로 축소)
      for (const c of cands.slice(0, IO_STORE_CAP)) {
        edges.push({ a, b: c.b, type: 'io', directed: true, raw: c.raw });
      }
    }
    onProgress?.({ phase: 'io', done: a + 1, total: N });
    if (a % YIELD_EVERY === YIELD_EVERY - 1) await yieldToUi(); // E8: 진행바 갱신·프리즈 방지
  }

  // -------- semantic (무방향, 인덱스 벡터 코사인 kNN) --------
  let usedEmbed = false;
  let embedModelUsed = null;
  const idx = store.get(INDEX_KEY);
  const idxHasVecs = idx && Array.isArray(idx.docs) && idx.docs.length;
  if (idxHasVecs) {
    const vecByKey = new Map(idx.docs.map(d => [`${d.serverId}/${d.toolName}`, d.vec || []]));
    const nodeVecs = nodes.map(n => vecByKey.get(`${n.serverId}/${n.toolName}`) || null);
    if (nodeVecs.some(v => v && v.length)) {
      usedEmbed = true;
      embedModelUsed = idx.embedModel || embedModel;
      const seen = new Set(); // 'lo-hi' 무방향 중복 방지
      onProgress?.({ phase: 'semantic', done: 0, total: N });
      for (let a = 0; a < N; a++) {
        checkAbort();
        const va = nodeVecs[a];
        if (va && va.length) {
          const sims = [];
          for (let b = 0; b < N; b++) {
            if (a === b) continue;
            const vb = nodeVecs[b];
            if (!vb || !vb.length) continue;
            const c = cosine(va, vb);
            if (c >= semanticStoreFloor) sims.push({ b, c }); // E3: 저장 하한(0.30)까지 후보 저장 — 런타임 threshold는 effectiveAdjacency가 필터
          }
          sims.sort((x, y) => y.c - x.c);
          for (const s of sims.slice(0, SEMANTIC_KNN)) {
            const lo = Math.min(a, s.b), hi = Math.max(a, s.b);
            const key = `${lo}-${hi}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push({ a: lo, b: hi, type: 'semantic', directed: false, raw: round4(s.c) });
          }
        }
        onProgress?.({ phase: 'semantic', done: a + 1, total: N });
        if (a % YIELD_EVERY === YIELD_EVERY - 1) await yieldToUi(); // E8
      }
    }
  }

  // -------- server (무방향, 같은 serverId) --------
  onProgress?.({ phase: 'server', done: 0, total: N });
  const byServer = new Map();
  nodes.forEach((n, i) => {
    if (!byServer.has(n.serverId)) byServer.set(n.serverId, []);
    byServer.get(n.serverId).push(i);
  });
  for (const idxs of byServer.values()) {
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        edges.push({ a: idxs[i], b: idxs[j], type: 'server', directed: false, raw: 1 });
      }
    }
  }
  onProgress?.({ phase: 'server', done: N, total: N });

  // -------- category (무방향, 같은 category · server 중복 제외) --------
  onProgress?.({ phase: 'category', done: 0, total: N });
  const byCat = new Map();
  nodes.forEach((n, i) => {
    const c = n.category || '';
    if (!c) return;
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(i);
  });
  const categoryReduced = [];
  for (const [cat, idxs] of byCat) {
    if (idxs.length > CATEGORY_OVERCROWD) {
      // 과밀: 서버별 첫 도구(대표) 간에만 연결
      categoryReduced.push(cat);
      const reps = [];
      const seenSrv = new Set();
      for (const i of idxs) {
        const s = nodes[i].serverId;
        if (!seenSrv.has(s)) { seenSrv.add(s); reps.push(i); }
      }
      for (let i = 0; i < reps.length; i++) {
        for (let j = i + 1; j < reps.length; j++) {
          edges.push({ a: reps[i], b: reps[j], type: 'category', directed: false, raw: 1 });
        }
      }
    } else {
      for (let i = 0; i < idxs.length; i++) {
        for (let j = i + 1; j < idxs.length; j++) {
          const ai = idxs[i], bi = idxs[j];
          if (nodes[ai].serverId === nodes[bi].serverId) continue; // server 엣지가 이미 연결
          edges.push({ a: ai, b: bi, type: 'category', directed: false, raw: 1 });
        }
      }
    }
  }
  onProgress?.({ phase: 'category', done: N, total: N });

  // -------- cooccur (무방향, 벤치마크 워크플로우 공출현 횟수) --------
  onProgress?.({ phase: 'cooccur', done: 0, total: N });
  const keyToNode = new Map(nodes.map((n, i) => [`${n.serverId}/${n.toolName}`, i]));
  const coCount = new Map(); // 'lo-hi' → 횟수
  for (const wf of collectWorkflows(benchmarks)) {
    const ids = [];
    for (const s of wf) {
      const ni = keyToNode.get(`${s?.serverId}/${s?.toolName}`);
      if (ni !== undefined) ids.push(ni);
    }
    const uniq = [...new Set(ids)];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const lo = Math.min(uniq[i], uniq[j]), hi = Math.max(uniq[i], uniq[j]);
        const key = `${lo}-${hi}`;
        coCount.set(key, (coCount.get(key) || 0) + 1);
      }
    }
  }
  for (const [key, cnt] of coCount) {
    const [lo, hi] = key.split('-').map(Number);
    edges.push({ a: lo, b: hi, type: 'cooccur', directed: false, raw: cnt });
  }
  onProgress?.({ phase: 'cooccur', done: N, total: N });

  // -------- llm (LLM 의미 관계 추출, 방향 A→B) — includeLlm=true일 때만 --------
  let usedLlm = false;
  let extractModelUsed = null;
  let llmConcepts = null;   // 도구별 {requires, produces} (정규화 키워드) — 재사용/디버깅용 저장
  let llmFailed = 0;
  if (includeLlm) {
    usedLlm = true;
    extractModelUsed = extractModel || getDefaultModel();
    llmConcepts = new Array(N).fill(null);
    onProgress?.({ phase: 'llm', done: 0, total: N });
    for (let i = 0; i < N; i++) {
      checkAbort();
      const node = nodes[i];
      try {
        const messages = [
          { role: 'system', content:
            '당신은 도구의 입출력을 의미 개념으로 요약하는 도우미입니다. 주어진 도구가 실행에 ' +
            '필요로 하는(requires) 개념과 실행 결과로 생산하는(produces) 개념을 각각 간결한 한국어 ' +
            '키워드 배열로 추출하세요(각 3~7개). 스키마 필드명이 달라도 의미가 같으면 같은 키워드를 쓰세요. ' +
            '반드시 {"requires":["..."],"produces":["..."]} 형식의 JSON 하나만 출력. 설명·코드블록 금지.' },
          { role: 'user', content: node.promptText },
        ];
        const { data } = await chatJSON({ model: extractModelUsed, messages, temperature: 0, signal });
        llmConcepts[i] = { requires: normConcepts(data?.requires), produces: normConcepts(data?.produces) };
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        llmFailed++;
        llmConcepts[i] = { requires: [], produces: [] };
      }
      onProgress?.({ phase: 'llm', done: i + 1, total: N });
    }
    // A.produces ∩ B.requires 있으면 방향 엣지 A→B (raw = 겹친 개념 수). io와 동일하게 out-degree 상위 LLM_STORE_CAP개 저장.
    for (let a = 0; a < N; a++) {
      const prod = new Set(llmConcepts[a]?.produces || []);
      if (!prod.size) continue;
      const cands = [];
      for (let b = 0; b < N; b++) {
        if (a === b) continue;
        const reqs = llmConcepts[b]?.requires || [];
        if (!reqs.length) continue;
        let overlap = 0;
        for (const c of reqs) if (prod.has(c)) overlap++;
        if (overlap > 0) cands.push({ b, raw: overlap });
      }
      cands.sort((x, y) => y.raw - x.raw);
      for (const c of cands.slice(0, LLM_STORE_CAP)) {
        edges.push({ a, b: c.b, type: 'llm', directed: true, raw: c.raw });
      }
    }
  }

  // -------- 저장 --------
  const edgeCountByType = EMPTY_EDGE_COUNTS();
  for (const e of edges) edgeCountByType[e.type]++;

  const graph = {
    builtAt: new Date().toISOString(),
    fingerprint: graphFingerprint(mcps, benchmarks,
      usedEmbed ? embedModelUsed : null, usedLlm ? extractModelUsed : null),
    usedEmbed,
    embedModel: usedEmbed ? embedModelUsed : null,
    usedLlm,
    extractModel: usedLlm ? extractModelUsed : null,
    nodes: nodes.map(n => ({
      serverId: n.serverId, toolName: n.toolName, category: n.category, serverNameKo: n.serverNameKo,
    })),
    edges,
    llmConcepts, // includeLlm이 아니면 null
    stats: {
      nodeCount: N,
      edgeCountByType,
      categoryReduced: categoryReduced.length ? categoryReduced : null,
      llmFailed: usedLlm ? llmFailed : 0,
    },
  };

  if (!store.set(GRAPH_KEY, graph)) {
    throw new Error('그래프 저장 실패 — localStorage 용량 한계(약 5MB)를 초과했을 수 있습니다.');
  }
  onProgress?.({ phase: 'done', done: N, total: N });
  return graphStatus(mcps, benchmarks,
    usedEmbed ? embedModelUsed : null, usedLlm ? extractModelUsed : null);
}

/* ============================================================
   유효 인접리스트 (런타임 파라미터 적용)
   ============================================================ */

/**
 * edgeParams로 유효 엣지만 골라 가중 인접리스트를 만든다.
 * @param {object} graph store의 catalogGraph
 * @param {{io?:{on,weight,threshold}, semantic?:{on,weight,threshold},
 *          server?:{on,weight}, category?:{on,weight}, cooccur?:{on,weight,threshold},
 *          llm?:{on,weight,threshold}}} edgeParams
 * @param {{maxDegree?:number, hubNorm?:boolean}} [opts] 런타임 파라미터(§3). maxDegree(기본 12): 노드당
 *   방향(io/llm) out-degree 상한 — 빌드 시 넉넉히 저장한 방향 엣지를 소스별 상위 maxDegree개로 축소한다.
 *   hubNorm은 확산 시점(graphRetrieve)에서만 쓰이므로 여기서는 받되 인접구조에는 영향을 주지 않는다.
 * @returns {Map<number, Array<{to:number, w:number, type:string, directed:boolean}>>}
 */
export function effectiveAdjacency(graph, edgeParams = {}, opts = {}) {
  const adj = new Map();
  if (!graph || !Array.isArray(graph.edges)) return adj;

  // 런타임 노드당 방향 out-degree 상한. 미지정 시 12(구 IO_OUT_CAP/LLM_OUT_CAP과 동일 → 회귀 없음).
  const maxDegree = Number.isFinite(opts.maxDegree) ? Math.max(1, Math.floor(opts.maxDegree)) : DEFAULT_MAX_DEGREE;

  // 정수형 raw(cooccur·llm) 정규화용 유형별 최대값
  let cooccurMax = 0, llmMax = 0;
  for (const e of graph.edges) {
    if (e.type === 'cooccur' && e.raw > cooccurMax) cooccurMax = e.raw;
    else if (e.type === 'llm' && e.raw > llmMax) llmMax = e.raw;
  }

  const push = (u, entry) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u).push(entry);
  };

  // 방향 엣지(io/llm)는 소스 노드별로 모아 두었다가 상위 maxDegree개만 채택(런타임 축소).
  // 무방향 엣지(semantic/server/category/cooccur)는 종전대로 즉시 양방향 push한다.
  const dirBySource = new Map();

  for (const e of graph.edges) {
    const p = edgeParams[e.type];
    if (!p || !p.on) continue;
    // 임계값이 있는 유형(io/semantic/cooccur/llm)만 raw로 필터
    if ((e.type === 'io' || e.type === 'semantic' || e.type === 'cooccur' || e.type === 'llm')
      && Number.isFinite(p.threshold) && e.raw < p.threshold) continue;

    const weight = Number.isFinite(p.weight) ? p.weight : 1;
    let norm;
    if (e.type === 'cooccur') norm = cooccurMax > 0 ? e.raw / cooccurMax : 0;
    else if (e.type === 'llm') norm = llmMax > 0 ? e.raw / llmMax : 0; // 정수 개념 수 → 최대값 정규화
    else if (e.type === 'server' || e.type === 'category') norm = 1;
    else if (e.type === 'io') norm = Math.min(1, e.raw); // io: 저장 시 [0,1] 클램프되나 구버전 그래프 방어(E1)
    else norm = e.raw; // semantic (코사인, 이미 0~1)

    const w = weight * norm;
    if (w <= 0) continue;

    if (e.directed) {
      if (!dirBySource.has(e.a)) dirBySource.set(e.a, []);
      dirBySource.get(e.a).push({ to: e.b, w, type: e.type, directed: true });
    } else {
      push(e.a, { to: e.b, w, type: e.type, directed: false });
      push(e.b, { to: e.a, w, type: e.type, directed: false });
    }
  }

  // 방향 엣지 채택: 소스별 상위 maxDegree(가중 내림차순). 상한 이하면 원래 순서를 보존해 회귀를 방지한다.
  for (const [u, list] of dirBySource) {
    if (list.length > maxDegree) {
      list.sort((x, y) => y.w - x.w);
      for (const entry of list.slice(0, maxDegree)) push(u, entry);
    } else {
      for (const entry of list) push(u, entry);
    }
  }
  return adj;
}

/* ============================================================
   시드 검색 (catalogIndex.retrieve 재사용)
   ============================================================ */

/**
 * 시드 도구 집합 + (더 넓은) 질의 관련도 맵을 얻는다. 반환 score는 max 정규화(0~1, 최상위=1).
 * expandServer/Category는 끄고 순수 매치만 사용(확장은 그래프의 역할). relevanceK로 시드보다 넓게 조회해
 * 그래프 도달 노드/경로 노드에 질의 관련도를 소폭 블렌드하는 데 쓴다(G1).
 * ranked: relevance와 같은 내용의 관련도 내림차순 배열(필드 보존) — includeRelTopN 편입·부질의 병합용(§F2).
 * rawTop: 정규화 전 최고 원점수(retrieve score 기준) — 멀티 시드 병합 시 부질의 간 스케일 가중용(§H1).
 *   정규화값 × rawTop = 원점수이므로, 부질의별 정규화값에 (해당 부질의 rawTop / 전역 최대 rawTop)을
 *   곱하면 병합 후 전역 1회 정규화와 동치가 된다.
 * @returns {{seeds:Array<{serverId,toolName,score}>, relevance:Map<string,number>,
 *   ranked:Array<{serverId,toolName,score}>, rawTop:number, usedMethod, fallbackReason}}
 */
async function seedRetrieve(query, { mcps, method, seedK, embedModel, signal, relevanceK }) {
  const K = Math.max(1, Math.floor(seedK) || 5);
  const RK = Math.max(K, Math.floor(relevanceK) || K);
  const res = await retrieve(query, {
    mcps, method, topK: RK, threshold: 0,
    expandServer: false, expandCategory: false, embedModel, signal,
  });
  const matches = (res.results || []).filter(r => r.source === 'match');
  const base = matches.length ? matches : (res.results || []);
  const maxScore = base.reduce((m, s) => Math.max(m, s.score || 0), 0);
  const ranked = base.map(s => ({
    serverId: s.serverId, toolName: s.toolName,
    score: maxScore > 0 ? (s.score || 0) / maxScore : 1,
  }));
  const seeds = ranked.slice(0, K);
  const relevance = new Map(ranked.map(r => [`${r.serverId}/${r.toolName}`, r.score]));
  return { seeds, relevance, ranked, rawTop: maxScore, usedMethod: res.usedMethod, fallbackReason: res.fallbackReason || null };
}

/* ============================================================
   graphRetrieve — 시드 + 그래프 가중 확산
   ============================================================ */

/**
 * 질의로 관련 도구를 검색한다. 시드(검색) → hops 가중 확산 → 최종 점수 정렬 → topK.
 * @param {string} query
 * @param {{mcps:Array, graph:object, edgeParams:object, seedMethod?:string, seedK?:number,
 *          hops?:number, decay?:number, topK?:number, embedModel?:string,
 *          maxDegree?:number, hubNorm?:boolean, queries?:string[], relBonus?:number,
 *          relevanceK?:number, includeRelTopN?:number, signal?:AbortSignal}} opts
 *   maxDegree(기본 12): effectiveAdjacency의 노드당 방향 out-degree 상한(런타임 축소).
 *   hubNorm(기본 true): 확산 기여를 허브 정규화(w/√deg)할지 여부. false면 정규화 없이 w 그대로(현행=true).
 *   queries(§F2, 선택): 부질의 배열(멀티 시드). 있으면 부질의별로 시드 검색을 수행해 시드는 부질의별
 *     "라운드로빈"(각 부질의 ranked 1위부터 교차·중복 제거, seedK개 — §H1)으로 선정하고, 질의 관련도
 *     (relevance)는 부질의 top-raw 비율로 가중한 뒤 노드별 max 병합(전역 1회 정규화와 동치 — §H1)해
 *     기존 확산을 그대로 진행한다. 미지정/빈 배열이면 query 단일 시드(현행).
 *   relBonus(§F2, 기본 0.5=GRAPH_REL_BONUS): 그래프 도달(비시드) 노드에 블렌드하는 질의 관련도 계수.
 *   relevanceK(§F2, 기본 15=SEED_RELEVANCE_K): 시드보다 넓게 확보하는 질의 관련도 맵 크기.
 *   includeRelTopN(§F2, 기본 0=현행): >0이면 "시드(seedK) 제외" 질의 관련도 상위 N개를 최종 topK 후보에
 *     보장 포함 — 그래프 확산이 놓친 고관련 도구의 안전망. 후보에 없는 노드는 rel*relBonus 점수
 *     (source:'relevance', hop:null)로 편입하고, topK 절단에서 탈락하는 창 노드는 시드·창이 아닌 최하위
 *     후보와 교체해 살린다(시드는 보호 — topK가 시드+창으로 포화면 일부 창 노드는 미포함 가능).
 *     유효 상한은 relevanceK와 연동: min(N, relevanceK−seedK) (§H1 의미 수정 — 종전
 *     "관련도 상위 N"은 상위 seedK개가 항상 시드와 겹쳐 N≤seedK면 구조적 no-op이었고, 편입 점수가
 *     확산 점수보다 항상 낮아 절단 보장 없이는 실질 no-op이었다).
 * @returns {Promise<{results:Array, seeds:Array, relevance:Map<string,number>, usedEmbed:boolean, fallbackReason:string|null}>}
 *   relevance: 시드 검색에서 이미 계산한 (더 넓은) 질의 관련도 맵(`serverId/toolName`→0~1).
 *   recommendPaths에 그대로 넘기면 시드 이중 임베딩(질의 임베딩 2회)을 피할 수 있다(하위호환: 추가 필드).
 */
export async function graphRetrieve(query, {
  mcps = [], graph, edgeParams = {}, seedMethod = 'hybrid', seedK = 5, hops = 2,
  decay = 0.5, topK = 8, embedModel = DEFAULT_EMBED_MODEL, maxDegree, hubNorm,
  queries, relBonus, relevanceK, includeRelTopN, signal,
} = {}) {
  const q = String(query || '').trim();
  const k = Math.max(1, Math.floor(topK) || 8);
  embedModel = embedModel || DEFAULT_EMBED_MODEL; // config에서 null이 넘어오면 임베딩 기본값
  const md = Number.isFinite(maxDegree) ? Math.max(1, Math.floor(maxDegree)) : DEFAULT_MAX_DEGREE;
  const hn = hubNorm === undefined ? true : !!hubNorm; // 허브 정규화(1/√deg) 기본 on(현행)
  // §F2 옵션화 — 미지정 시 기존 상수와 동일(회귀 없음).
  const relB = Number.isFinite(relBonus) ? Math.max(0, relBonus) : GRAPH_REL_BONUS;
  const relK = Number.isFinite(relevanceK) ? Math.max(1, Math.floor(relevanceK)) : SEED_RELEVANCE_K;
  const relTopN = Number.isFinite(includeRelTopN) ? Math.max(0, Math.floor(includeRelTopN)) : 0;
  const sK = Math.max(1, Math.floor(seedK) || 5); // seedRetrieve와 동일 클램프 — 라운드로빈 시드·relTopN 오프셋용
  const gnodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
  const keyToNode = new Map(gnodes.map((n, i) => [`${n.serverId}/${n.toolName}`, i]));

  // 1) 시드 (+ 넓은 질의 관련도 맵) — queries[](멀티 시드)면 부질의별 시드·relevance를 max-병합(§F2)
  const subQs = (Array.isArray(queries) ? queries : []).map(s => String(s || '').trim()).filter(Boolean);
  const qList = subQs.length ? subQs : [q];
  let seedInfo;
  try {
    const infos = [];
    for (const sq of qList) {
      // 순차 실행: AbortSignal 전파·임베딩 호출 순서를 결정적으로 유지.
      infos.push(await seedRetrieve(sq, { mcps, method: seedMethod, seedK, embedModel, signal, relevanceK: relK }));
    }
    if (infos.length === 1) {
      seedInfo = infos[0]; // 단일 질의 = 현행 경로 그대로
    } else {
      // §H1 멀티 시드 병합 —
      // (a) 시드는 부질의별 "라운드로빈"(각 부질의 ranked 1위부터 교차·중복 제거)으로 seedK개만 선정해
      //     측면 대표성을 보장한다. 종전(부질의별 시드 합집합)은 최대 n×seedK개가 각자 1.0 근처 점수로
      //     투입돼 노이즈 부질의의 조각이 확산을 지배했다(#9/#30 극단 악화의 원인).
      // (b) relevance/ranked는 노드별 max-병합하되, 부질의별 정규화값(각자 최고점=1)을 그대로 합치지 않고
      //     "해당 부질의 rawTop / 전역 최대 rawTop" 비율로 가중한다 — 정규화값×rawTop=원점수이므로 병합 후
      //     전역 1회 정규화와 동치(§H1). 노이즈 조각이 만점 시드가 되는 문제를 완화한다. 단 retrieve의
      //     hybrid 점수는 부질의 내부 minmax 정규화를 거친 값이라 완전한 절대 스케일은 아니며,
      //     top-raw 가중으로 부질의 간 상대 스케일 차이까지만 반영한다.
      const globalTop = infos.reduce((m, i) => Math.max(m, i.rawTop || 0), 0);
      const rankByKey = new Map();
      for (const info of infos) {
        const scale = globalTop > 0 ? (info.rawTop || 0) / globalTop : 1;
        for (const r of info.ranked || []) {
          const key = `${r.serverId}/${r.toolName}`;
          const sc = (r.score || 0) * scale;
          if (!rankByKey.has(key) || sc > rankByKey.get(key).score) {
            rankByKey.set(key, { serverId: r.serverId, toolName: r.toolName, score: sc });
          }
        }
      }
      const relevance = new Map([...rankByKey.entries()].map(([key, r]) => [key, r.score]));
      // 라운드로빈 시드: 부질의1의 1위 → 부질의2의 1위 → … → 부질의1의 2위 → … (중복 제거, seedK개).
      // 점수는 병합(전역 정규화) 값, 순서는 교차 채택 순서(=선정 우선순위)를 유지한다.
      const seeds = [];
      const seenSeed = new Set();
      const maxRankLen = infos.reduce((m, i) => Math.max(m, (i.ranked || []).length), 0);
      outer: for (let i = 0; i < maxRankLen; i++) {
        for (const info of infos) {
          const r = (info.ranked || [])[i];
          if (!r) continue;
          const key = `${r.serverId}/${r.toolName}`;
          if (seenSeed.has(key)) continue;
          seenSeed.add(key);
          seeds.push({ serverId: r.serverId, toolName: r.toolName, score: rankByKey.get(key)?.score || 0 });
          if (seeds.length >= sK) break outer;
        }
      }
      const reasons = [...new Set(infos.map(i => i.fallbackReason).filter(Boolean))];
      seedInfo = {
        seeds,
        ranked: [...rankByKey.values()].sort((x, y) => y.score - x.score),
        relevance,
        usedMethod: infos[0].usedMethod, // 폴백은 인덱스 상태에 좌우 → 부질의 간 동일(첫 결과 기준)
        fallbackReason: reasons.length ? `부질의 ${qList.length}개 병합: ${reasons.join(' / ')}` : null,
      };
    }
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    // relevance 필드는 실패 경로에서도 항상 포함해 반환 형태를 일정하게 유지(소비자 방어).
    return { results: [], seeds: [], relevance: new Map(), usedEmbed: false, fallbackReason: `시드 검색 실패: ${e.message}` };
  }
  const usedEmbed = seedInfo.usedMethod !== 'keyword';
  let fallbackReason = seedInfo.fallbackReason;

  const seedList = seedInfo.seeds.map(s => ({
    serverId: s.serverId, toolName: s.toolName, score: round4(s.score),
    node: keyToNode.has(`${s.serverId}/${s.toolName}`) ? keyToNode.get(`${s.serverId}/${s.toolName}`) : null,
  }));
  const seedScoreByNode = new Map();
  for (const s of seedList) {
    if (s.node != null) seedScoreByNode.set(s.node, Math.max(seedScoreByNode.get(s.node) || 0, s.score));
  }
  // 질의 관련도(정규화 0~1)를 노드 인덱스로 매핑 — 그래프 도달(비시드) 노드에 소폭 블렌드(G1).
  const relByNode = new Map();
  for (const [key, sc] of seedInfo.relevance) {
    if (keyToNode.has(key)) relByNode.set(keyToNode.get(key), sc);
  }

  // 2) 그래프 확산 (개인화 PageRank의 유한 홉 근사)
  const adj = effectiveAdjacency(graph, edgeParams, { maxDegree: md });
  // 허브 과증폭 완화(E6): 목표 노드의 유효 in-degree(들어오는 엣지 수) 제곱근으로 이웃 기여를 정규화.
  // 많은 이웃에서 도달되는 공용 커넥터(예: 공유 date/trainNo)일수록 per-edge 기여를 줄인다(대칭 정규화 근사).
  const inDeg = new Map();
  for (const [, list] of adj) for (const nb of list) inDeg.set(nb.to, (inDeg.get(nb.to) || 0) + 1);
  const graphScore = new Map(); // node → 누적 전파 점수
  const hopByNode = new Map();  // node → 최초 도달 홉
  const viaByNode = new Map();  // node → Set(엣지 타입)
  const H = Math.max(0, Math.min(6, Math.floor(hops) || 0));
  const d = Number.isFinite(decay) ? Math.max(0, Math.min(1, decay)) : 0.5;

  if (adj.size && seedScoreByNode.size && H > 0) {
    let frontier = new Map(seedScoreByNode); // 이전 홉 활성값
    for (let h = 1; h <= H; h++) {
      const next = new Map();
      for (const [u, act] of frontier) {
        const nbrs = adj.get(u);
        if (!nbrs) continue;
        for (const nb of nbrs) {
          // G1: 다른 서버로의 io(워크플로우 핸드오프)만, 그것도 "관련 있는 목적지로의" 핸드오프만 우대.
          // 같은 서버 io(대체 뷰)는 그대로. 무관한 강-io 이웃(rel≈0)은 부스트 없이 두어 관련 도구를 밀어내지 않게 한다.
          let ioMul = 1;
          if (nb.type === 'io' && nb.directed) {
            const sameServer = gnodes[u] && gnodes[nb.to] && gnodes[u].serverId === gnodes[nb.to].serverId;
            ioMul = sameServer ? IO_SAME_SERVER_MUL
              : xserverIoMul(h === 1 ? IO_XSERVER_HOP1_MUL : IO_XSERVER_MUL, relByNode.get(nb.to));
          }
          // hubNorm이면 목표 노드 in-degree √로 정규화(허브 과증폭 완화), 아니면 정규화 없이 w 그대로.
          const add = act * d * nb.w * ioMul / (hn ? Math.sqrt(Math.max(1, inDeg.get(nb.to) || 1)) : 1);
          if (add <= 1e-9) continue;
          next.set(nb.to, (next.get(nb.to) || 0) + add);
          graphScore.set(nb.to, (graphScore.get(nb.to) || 0) + add);
          if (!hopByNode.has(nb.to)) hopByNode.set(nb.to, h);
          if (!viaByNode.has(nb.to)) viaByNode.set(nb.to, new Set());
          viaByNode.get(nb.to).add(nb.type);
        }
      }
      frontier = next;
      if (!frontier.size) break;
    }
  }

  // 3) 결합: final = 시드점수(있으면) + 그래프전파점수. 시드는 그래프에 없어도 결과에 포함.
  const resultMap = new Map();
  for (const s of seedList) {
    resultMap.set(`${s.serverId}/${s.toolName}`, {
      serverId: s.serverId, toolName: s.toolName, score: s.score, source: 'seed', hop: 0, viaEdges: [],
    });
  }
  for (const [ni, sc] of graphScore) {
    const n = gnodes[ni];
    if (!n) continue;
    const key = `${n.serverId}/${n.toolName}`;
    const existing = resultMap.get(key);
    if (existing) {
      existing.score = round4(existing.score + sc);
    } else {
      // G1: 그래프로 도달한(비시드) 노드에 질의 관련도를 소폭 블렌드(SPEC §3의 α*검색점수 일반화).
      // 관련도는 relByNode에 있을 때만 더하므로 새 노드를 끌어오지 않고, 관련 도구의 순위만 끌어올린다.
      // 계수는 relBonus 옵션(기본 GRAPH_REL_BONUS=0.5 — 현행과 동일).
      const rel = relByNode.get(ni) || 0;
      resultMap.set(key, {
        serverId: n.serverId, toolName: n.toolName, score: round4(sc + relB * rel),
        source: 'graph', hop: hopByNode.get(ni) || 1, viaEdges: [...(viaByNode.get(ni) || [])],
      });
    }
  }

  // 3.5) includeRelTopN(§F2, 기본 0=현행 — 이 블록 미실행): "시드(seedK) 제외" 질의 관련도 상위 N개를
  // 최종 후보(topK)에 보장 포함한다 — 그래프 확산이 놓친 고관련 도구의 안전망(§H1 의미 수정).
  //  - 종전 "관련도 상위 N"은 상위 seedK개가 항상 시드와 겹쳐 N≤seedK면 구조적 no-op이었다. 시드를
  //    건너뛴(오프셋) 창에서 N개를 취한다. 유효 상한은 relevanceK와 연동: ranked 자체가 relevanceK개
  //    뿐이므로 창은 min(N, relevanceK−seedK)개다.
  //  - 창의 비후보 노드는 rel*relBonus 점수(source:'relevance', hop:null)로 편입한다. 이미 후보(그래프
  //    도달)면 점수·출처는 그대로 두고 창만 소모한다(조밀한 그래프에서는 고관련 노드 대부분이 이미
  //    도달 상태 — 편입만으로는 여전히 no-op이 된다).
  //  - 보장: 창 노드가 topK 절단에서 탈락하면 아래 4)에서 시드·창이 아닌 최하위 후보와 교체해 살린다.
  //    편입 점수(rel*relBonus)는 시드·확산 점수보다 낮아 절단 경쟁에서 항상 지므로, 보장 없이는 이
  //    옵션이 사실상 동작하지 않는다(안전망 취지). 시드는 교체 대상이 아니다(아래 4) 주석 참조).
  const relWindow = [];       // 창 노드 키(관련도 순) — 4)의 보장 교체용
  if (relTopN > 0 && Array.isArray(seedInfo.ranked)) {
    const effN = Math.min(relTopN, Math.max(0, relK - sK));
    const seedKeys = new Set(seedInfo.seeds.map(s => `${s.serverId}/${s.toolName}`));
    for (const r of seedInfo.ranked) {
      if (relWindow.length >= effN) break;
      const key = `${r.serverId}/${r.toolName}`;
      if (seedKeys.has(key)) continue; // 시드 제외(오프셋) — 창을 소모하지 않음
      relWindow.push(key);
      if (resultMap.has(key)) continue; // 이미 후보면 편입만 생략(창은 소모, 보장은 적용)
      resultMap.set(key, {
        serverId: r.serverId, toolName: r.toolName, score: round4(relB * (r.score || 0)),
        source: 'relevance', hop: null, viaEdges: [],
      });
    }
  }

  // 4) 정렬 · topK (hop이 없는 relevance 편입 노드는 tiebreak에서 뒤로 — 기존 노드는 모두 숫자 hop이라 무영향)
  const byScore = (a, b) => (b.score - a.score) || ((a.hop ?? Number.MAX_SAFE_INTEGER) - (b.hop ?? Number.MAX_SAFE_INTEGER));
  const results = [...resultMap.values()].sort(byScore).slice(0, k);
  // §H1 includeRelTopN 보장: 창(시드 제외 관련도 상위 effN) 노드가 절단으로 탈락했으면 "시드도 창도
  // 아닌" 최하위 후보와 교체해 topK 안에 살린다(관련도 순으로, 교체 가능한 후보가 없어지면 중단).
  //  - 시드는 교체 대상에서 제외한다: 창 노드는 정의상 시드보다 관련도 순위가 낮으므로, 시드를 밀어내면
  //    관련도 상위(정답일 확률이 높은) 후보를 하위 창 노드가 대체하는 역전이 된다(실측 시 평균 리콜 악화).
  //    따라서 창은 그래프 확산이 채운 저관련 꼬리 후보와만 자리를 다툰다. topK가 시드+창으로 포화라면
  //    일부 창 노드는 못 들어올 수 있다(topK 증가 또는 seedK 축소로 완화 — 주석으로 계약 고정).
  //  - relTopN=0(기본)이면 relWindow가 비어 이 블록은 실행되지 않는다(회귀 없음). 교체 후 점수 내림차순 복원.
  if (relWindow.length && results.length === k) {
    const windowSet = new Set(relWindow);
    const inTop = new Set(results.map(r => `${r.serverId}/${r.toolName}`));
    let changed = false;
    for (const wk of relWindow) {
      if (inTop.has(wk)) continue;
      const cand = resultMap.get(wk);
      if (!cand) continue;
      let idx = -1; // 뒤(최하위)에서부터 시드·창이 아닌 첫 후보를 찾는다
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i].source === 'seed') continue; // 시드 보호
        if (!windowSet.has(`${results[i].serverId}/${results[i].toolName}`)) { idx = i; break; }
      }
      if (idx < 0) break; // 남은 후보가 전부 시드/창 — 더 살릴 자리가 없음
      inTop.delete(`${results[idx].serverId}/${results[idx].toolName}`);
      results.splice(idx, 1);
      results.push(cand);
      inTop.add(wk);
      changed = true;
    }
    if (changed) results.sort(byScore);
  }

  if (!gnodes.length) fallbackReason = fallbackReason || '그래프가 없어 시드 검색 결과만 반환';
  else if (!adj.size) fallbackReason = fallbackReason || '유효 엣지가 없어(엣지 off/임계값) 시드 검색 결과만 반환';

  // relevance는 recommendPaths가 시드 재계산 없이 재사용하도록 그대로 노출(추가 필드 — 기존 소비자 무영향).
  return { results, seeds: seedList, relevance: seedInfo.relevance, usedEmbed, fallbackReason };
}

/* ============================================================
   recommendPaths — io 방향 엣지 워크플로우 경로 추천
   ============================================================ */

/**
 * 방향 엣지(기본 io, 옵션으로 llm 포함)를 따라 시드에서 시작하는 가중 경로를 빔서치로 추천한다.
 * io는 스키마 입출력 연결, llm은 LLM이 추출한 의미 관계(둘 다 방향 A→B)이므로 경로에 함께 쓸 수 있다.
 * @param {string} query
 * @param {{mcps:Array, graph:object, edgeParams:object, seedMethod?:string, seedK?:number,
 *          maxLen?:number, edges?:Array<'io'|'llm'>, pathEdges?:Array<'io'|'llm'>,
 *          beamWidth?:number, maxDegree?:number, embedModel?:string,
 *          seeds?:Array, relevance?:Map<string,number>, signal?:AbortSignal}} opts
 *   §3: edges(신규, 기본 ['io']; ['io','llm'] 허용)로 경로 탐색 대상 방향 엣지 유형 지정(해당 엣지 on 필요).
 *   구 인자 pathEdges도 병행 지원(하위호환): edges 미지정 시 pathEdges를 사용.
 *   beamWidth(기본=현행 PATH_BEAM=10, 미지정 시): 빔 서치 폭. maxLen(기본 4): 최대 경로 노드 길이.
 *   seeds/relevance(선택): graphRetrieve가 이미 계산한 시드/질의 관련도 맵. relevance(비어있지 않은 Map)를
 *   넘기면 내부 시드 검색(질의 임베딩)을 건너뛰고 그 관련도로 빔서치를 시작한다(시드 이중 임베딩 제거).
 *   미제공(직접 호출·편집기 미리보기 등) 시에는 기존대로 자체 seedRetrieve를 수행한다(100% 하위호환).
 * @returns {Promise<{paths:Array<{steps:Array<{serverId,toolName}>, score:number}>, note:string|null}>}
 */
export async function recommendPaths(query, {
  mcps = [], graph, edgeParams = {}, seedMethod = 'hybrid', seedK = 3, maxLen = 4,
  pathEdges = ['io'], edges, beamWidth, maxDegree, embedModel = DEFAULT_EMBED_MODEL,
  seeds, relevance: providedRelevance, signal,
} = {}) {
  embedModel = embedModel || DEFAULT_EMBED_MODEL; // config에서 null이 넘어오면 임베딩 기본값
  // edges(신규)가 우선, 없으면 pathEdges(하위호환), 둘 다 없으면 ['io'].
  const effEdges = (Array.isArray(edges) && edges.length) ? edges
    : (Array.isArray(pathEdges) && pathEdges.length ? pathEdges : ['io']);
  // beamWidth 미지정 시 현행 PATH_BEAM(10) — 회귀 방지. 지정 시 1~20으로 클램프.
  const beamW = Number.isFinite(beamWidth) ? Math.max(1, Math.min(20, Math.floor(beamWidth))) : PATH_BEAM;
  const md = Number.isFinite(maxDegree) ? Math.max(1, Math.floor(maxDegree)) : DEFAULT_MAX_DEGREE;
  const gnodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
  const keyToNode = new Map(gnodes.map((n, i) => [`${n.serverId}/${n.toolName}`, i]));

  // 방향 엣지(effEdges) 인접리스트만 추출 — io는 항상, llm은 지정 시. 둘 다 directed=true.
  const allow = new Set((Array.isArray(effEdges) && effEdges.length ? effEdges : ['io']).filter(t => t === 'io' || t === 'llm'));
  if (!allow.size) allow.add('io');
  const adj = effectiveAdjacency(graph, edgeParams, { maxDegree: md });
  const dirAdj = new Map();
  let dirCount = 0;
  for (const [u, list] of adj) {
    for (const e of list) {
      if (e.directed && allow.has(e.type)) {
        if (!dirAdj.has(u)) dirAdj.set(u, []);
        dirAdj.get(u).push(e);
        dirCount++;
      }
    }
  }
  if (!dirCount) {
    const label = [...allow].join('/');
    return { paths: [], note: `${label}(방향) 엣지가 없어 경로를 추천할 수 없습니다. 해당 엣지를 켜거나 임계값을 낮춰보세요.` };
  }

  // 시드 (+ 넓은 질의 관련도 맵) — 경로 시작/점수에 관련도 맵을 사용한다.
  // 호출측이 관련도 맵(relevance)이나 시드(seeds)를 넘기면 내부 시드 검색(질의 임베딩)을 건너뛴다(시드 이중 임베딩 제거).
  // 우선순위: relevance(넓은 관련도 맵) > seeds(시드에서 축약 관련도 구성) > 자체 seedRetrieve(미제공 시 기존 동작·하위호환).
  let relevance;
  if (providedRelevance instanceof Map && providedRelevance.size) {
    relevance = providedRelevance;
  } else if (Array.isArray(seeds) && seeds.length) {
    relevance = new Map(seeds.map(s => [`${s.serverId}/${s.toolName}`, Number(s.score) || 0]));
  } else {
    try {
      const info = await seedRetrieve(String(query || '').trim(),
        { mcps, method: seedMethod, seedK, embedModel, signal, relevanceK: SEED_RELEVANCE_K });
      relevance = info.relevance;
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      return { paths: [], note: `시드 검색 실패: ${e.message}` };
    }
  }
  const relByNode = new Map();
  for (const [key, sc] of relevance) if (keyToNode.has(key)) relByNode.set(keyToNode.get(key), sc);
  const relOf = (ni) => relByNode.get(ni) || 0;

  const maxNodes = Math.max(2, Math.min(8, Math.floor(maxLen) || 4));
  const collected = new Map(); // 노드시퀀스 → {nodes, score}

  // 경로 점수: 길이 정규화(합이 아니라 평균) — 평균 엣지가중과 경로 노드 평균 질의 관련도의 블렌드.
  // 길이 편향을 제거해 짧은 정답 워크플로우(예: 검색→예약)가 긴 강결합 시각표 체인에 밀리지 않게 한다(G1).
  const pathScore = (nodes, edgeSum) => {
    const numEdges = nodes.length - 1;
    const avgEdge = numEdges > 0 ? edgeSum / numEdges : 0;
    let relSum = 0;
    for (const ni of nodes) relSum += relOf(ni);
    const avgRel = relSum / nodes.length;
    return PATH_W_EDGE * avgEdge + PATH_W_REL * avgRel;
  };

  // 빔 시작을 시드(seedK)뿐 아니라 상위 관련 도구(PATH_START_K)로 넓힌다 — 예약 도구처럼 시드는 아니지만
  // 관련도가 높은 워크플로우 도구가 자기 경로(예: check_seat→reserve)를 직접 시드하게 한다(G1).
  const startNodes = [];
  const seenStart = new Set();
  let scanned = 0;
  for (const [key] of relevance) {
    if (scanned >= Math.max(seedK, PATH_START_K)) break;
    scanned++;
    if (!keyToNode.has(key)) continue;
    const ni = keyToNode.get(key);
    if (!seenStart.has(ni)) { seenStart.add(ni); startNodes.push(ni); }
  }

  for (const start of startNodes) {
    let beam = [{ nodes: [start], edgeSum: 0, visited: new Set([start]) }];
    for (let depth = 1; depth < maxNodes; depth++) {
      const next = [];
      for (const path of beam) {
        const last = path.nodes[path.nodes.length - 1];
        const outs = (dirAdj.get(last) || []).filter(e => !path.visited.has(e.to));
        for (const e of outs) {
          const visited = new Set(path.visited);
          visited.add(e.to);
          // 관련 목적지로의 크로스서버 io(워크플로우 핸드오프) 엣지가중 상향(관련도 게이팅), 단 정규화 상한 1로 캡.
          // 구조(엣지가중)를 동급으로 맞춰, 강-io지만 덜 관련한 형제와의 순위는 관련도가 가르게 한다(G1).
          const sameServer = gnodes[last] && gnodes[e.to] && gnodes[last].serverId === gnodes[e.to].serverId;
          const w = (e.type === 'io' && !sameServer)
            ? Math.min(1, e.w * xserverIoMul(PATH_XSERVER_IO_MUL, relOf(e.to)))
            : e.w;
          next.push({ nodes: [...path.nodes, e.to], edgeSum: path.edgeSum + w, visited });
        }
      }
      if (!next.length) break;
      // 빔 정렬을 길이정규화 블렌드 점수로 → 관련 노드(예: 예매 질의의 예약 도구)가 가지치기에서 생존
      next.sort((a, b) => pathScore(b.nodes, b.edgeSum) - pathScore(a.nodes, a.edgeSum));
      beam = next.slice(0, beamW);
      for (const p of beam) {
        const key = p.nodes.join('>');
        const sc = pathScore(p.nodes, p.edgeSum);
        const ex = collected.get(key);
        if (!ex || sc > ex.score) collected.set(key, { nodes: p.nodes, score: sc });
      }
    }
  }

  // 접두(prefix) 관계 경로군에서는 점수 최고 대표만 남긴다(짧은 정답이 더 높으면 짧은 쪽 유지 — 접두 제거 완화, G1).
  const all = [...collected.values()].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const p of all) {
    const seq = p.nodes.join('>');
    const related = kept.some(q => {
      const a = q.nodes.join('>');
      return a === seq || a.startsWith(seq + '>') || seq.startsWith(a + '>');
    });
    if (!related) kept.push(p);
  }
  const paths = kept
    .slice(0, 5)
    .map(p => ({
      steps: p.nodes.map(ni => ({ serverId: gnodes[ni].serverId, toolName: gnodes[ni].toolName })),
      score: round4(p.score),
    }));

  return { paths, note: paths.length ? null : `시드에서 시작하는 ${[...allow].join('/')} 경로를 찾지 못했습니다.` };
}
