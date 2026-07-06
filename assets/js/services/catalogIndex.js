// ============================================================================
// catalogIndex.js — MCP 도구 카탈로그의 검색 기반 공급(retrieval) 엔진
// SPEC-GATEWAY §4 계약 구현. 순수 ES module.
//
//  buildIndex({mcps, embedModel, docFields, onProgress})  도구 단위 문서 임베딩 → store 'catalogIndex'
//  indexStatus(mcps, embedModel, docFields)               인덱스 존재/stale/도구수/모델/구축시각
//  retrieve(query, {mcps, ...retrieval파라미터, docFields, mmrLambda}) vector·keyword·hybrid 검색 + 확장
//  retrieveMulti(subQueries, opts)                        부질의별 match 검색 → 라운드로빈 병합 → topK 절단 → 확장 1회(멀티 질의)
//
// v2(§2): 청킹 없음(도구당 1벡터 유지). 대신 임베딩 문서 구성 토글(docFields) + MMR 다양성(mmrLambda) 추가.
//   docFields={desc,params,outputs,examples,tags} 기본 {desc,params}만 켜 현행과 100% 동일 출력.
//   mmrLambda 1.0(기본)=순수 관련도(현행), <1.0이면 검색 결과를 MMR로 재랭킹(문서 벡터 재사용).
// v3(§F2): hybrid 융합 방식 토글(hybridFusion) 추가 — 'weighted'(기본, 현행 정규화 점수 가중합 그대로) |
//   'rrf'(Reciprocal Rank Fusion, rrfK 기본 60). retrieveMulti(부질의 라운드로빈 병합) 신설.
//
// 저장 형태(store 'catalogIndex'):
//  { builtAt, embedModel, dim, docs: [{ serverId, toolName, text, vec(소수4자리) }], docFields, mcpsFingerprint }
//
// 검색 결과(retrieve 반환):
//  { results: [{ serverId, toolName, score, source }], usedMethod, requestedMethod,
//    fallbackReason, topK, threshold }
//  - source: 'match' | 'expandServer' | 'expandCategory'
//  - vector/hybrid인데 인덱스 없음·stale이면 usedMethod='keyword' + fallbackReason 채움
// ============================================================================
import { store } from '../core/store.js';
import { embed } from './ollama.js';

export const INDEX_KEY = 'catalogIndex';
const EMBED_BATCH = 16;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/* ============================================================
   문서 텍스트 · 도구 평탄화
   ============================================================ */

/** 임베딩 문서 구성 토글 기본값(§2) — 현행과 동일한 출력을 위해 desc+params만 켠다. */
export const DEFAULT_DOC_FIELDS = { desc: true, params: true, outputs: false, examples: false, tags: false };

/** examples/mock 샘플 등 임의 구조에서 스칼라 값을 재귀 수집(문자열화). 배열/객체는 내려가며 값만 모은다. */
function pushScalars(v, out) {
  if (v === null || v === undefined) return;
  if (Array.isArray(v)) { for (const x of v) pushScalars(x, out); return; }
  if (typeof v === 'object') { for (const x of Object.values(v)) pushScalars(x, out); return; }
  out.push(String(v));
}

/**
 * 도구 1개의 임베딩/토큰화 대상 문서 텍스트(§2). docFields 토글로 포함 요소를 조절한다.
 * 식별자(서버명·도구명)는 항상 포함하고 나머지는 토글한다:
 *   desc=서버/도구 설명, params=입력 파라미터명·설명, outputs=출력 스키마 키·설명,
 *   examples=파라미터 examples/mock 샘플 값 텍스트, tags=서버 tags.
 * 기본값(desc+params)이면 종전 출력과 100% 동일하다.
 */
function toolDocText(server, tool, docFields) {
  const f = { ...DEFAULT_DOC_FIELDS, ...(docFields || {}) };
  const parts = [];
  // 식별자(항상 포함)
  parts.push(server.nameKo || server.name || server.id || '');
  if (server.name && server.name !== server.nameKo) parts.push(server.name);
  // desc: 서버 설명
  if (f.desc && server.description) parts.push(server.description);
  parts.push(tool.name || '');
  // desc: 도구 설명
  if (f.desc && tool.description) parts.push(tool.description);
  // params: 입력 파라미터명·설명
  if (f.params) {
    const props = tool.inputSchema?.properties || {};
    for (const [n, p] of Object.entries(props)) {
      parts.push(p && p.description ? `${n} ${p.description}` : n);
    }
  }
  // outputs: 출력 스키마 키·설명
  if (f.outputs) {
    const props = tool.outputSchema?.properties || {};
    for (const [n, p] of Object.entries(props)) {
      parts.push(p && p.description ? `${n} ${p.description}` : n);
    }
  }
  // examples: 파라미터 examples + mock 샘플 값
  if (f.examples) {
    const exs = [];
    const props = tool.inputSchema?.properties || {};
    for (const p of Object.values(props)) {
      if (p && Array.isArray(p.examples)) for (const ex of p.examples) pushScalars(ex, exs);
    }
    if (Array.isArray(tool.mock?.samples)) for (const s of tool.mock.samples) pushScalars(s, exs);
    if (exs.length) parts.push(exs.join(' '));
  }
  // tags: 서버 tags
  if (f.tags && Array.isArray(server.tags) && server.tags.length) {
    parts.push(server.tags.filter(Boolean).join(' '));
  }
  return parts.filter(Boolean).join('\n');
}

/** 등록된 모든 서버의 도구를 [{serverId, toolName, category, text}] 로 평탄화(등록 순서 보존).
 *  docFields 미지정 시 기본값(desc+params)으로 종전과 동일한 텍스트를 만든다. */
function flattenTools(mcps, docFields) {
  const out = [];
  for (const srv of mcps || []) {
    if (!srv || !srv.id) continue;
    for (const tool of srv.tools || []) {
      if (!tool || !tool.name) continue;
      out.push({ serverId: srv.id, toolName: tool.name, category: srv.category || '', text: toolDocText(srv, tool, docFields) });
    }
  }
  return out;
}

/* ============================================================
   핑거프린트(도구 문서 텍스트 + 카테고리 + embedModel 콘텐츠 해시)
   ============================================================ */

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // djb2
  return h.toString(16);
}

/**
 * 현재 MCP 구성의 콘텐츠 지문 — buildIndex가 실제로 임베딩하는 문서 텍스트(서버·도구 설명/파라미터 스키마
 * 포함)와 카테고리, 그리고 embedModel을 함께 해시한다. 따라서 도구 추가/삭제/개명뿐 아니라
 * 설명·파라미터·카테고리·임베딩 모델이 바뀌어도 값이 달라져 stale로 감지된다.
 * 구분자는 도구 설명 등에 등장할 가능성이 사실상 없는 제어문자(U+0001/U+0002)를 사용한다.
 * docFields는 flattenTools가 만드는 문서 텍스트를 바꾸므로, 문서 구성이 바뀌면 해시가 달라져 stale로 잡힌다.
 * (docFields 미지정 시 기본값=현행이라 해시가 종전과 100% 동일 → 회귀·불필요 재색인 없음.)
 * @param {Array} mcps
 * @param {string} [embedModel]
 * @param {object} [docFields] 임베딩 문서 구성 토글(미지정 시 기본값 desc+params)
 */
export function fingerprint(mcps, embedModel, docFields) {
  const SEP = '\u0001'; // 필드 구분자
  const REC = '\u0002'; // 레코드 구분자
  const keys = flattenTools(mcps, docFields).map(
    t => `${t.serverId}${SEP}${t.toolName}${SEP}${t.category}${SEP}${t.text}`,
  );
  keys.sort();
  return `${hashStr(keys.join(REC))}:${keys.length}:${embedModel || ''}`;
}

/* ============================================================
   토큰화 · BM25
   ============================================================ */

/** 한글은 2-gram, 영숫자는 소문자 단어 토큰. (한글 1글자 런은 그대로 unigram) */
function tokenize(text) {
  const tokens = [];
  const s = String(text || '').toLowerCase();
  const re = /[a-z0-9]+|[가-힣]+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const w = m[0];
    if (w.charCodeAt(0) < 128) {
      tokens.push(w); // 영숫자 단어 전체
    } else if (w.length === 1) {
      tokens.push(w);
    } else {
      for (let i = 0; i < w.length - 1; i++) tokens.push(w.slice(i, i + 2)); // 한글 2-gram
    }
  }
  return tokens;
}

function uniq(arr) { return [...new Set(arr)]; }

/** currentTools 코퍼스에 대한 BM25 모델 구축 */
function buildBM25(tools) {
  const N = tools.length;
  const docTokens = tools.map(t => tokenize(t.text));
  const tf = docTokens.map(toks => {
    const map = new Map();
    for (const w of toks) map.set(w, (map.get(w) || 0) + 1);
    return map;
  });
  const df = new Map();
  let totalLen = 0;
  docTokens.forEach(toks => {
    totalLen += toks.length;
    for (const w of new Set(toks)) df.set(w, (df.get(w) || 0) + 1);
  });
  const avgdl = N ? totalLen / N : 0;
  const len = docTokens.map(t => t.length);
  return { N, df, avgdl, tf, len };
}

function bm25ScoreAt(model, qTerms, i) {
  const { df, avgdl, tf, len, N } = model;
  const dl = len[i] || 0;
  const freqs = tf[i];
  let s = 0;
  for (const t of qTerms) {
    const f = freqs.get(t) || 0;
    if (!f) continue;
    const n = df.get(t) || 0;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    s += idf * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * (avgdl ? dl / avgdl : 0)));
  }
  return s;
}

/* ============================================================
   코사인 · 정규화
   ============================================================ */

function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** min-max 정규화 → [0,1]. 전 구간 동일하면 중립값 0.5 */
function minmax(vals) {
  if (!vals.length) return [];
  let mn = Infinity, mx = -Infinity;
  for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const range = mx - mn;
  if (range <= 1e-12) return vals.map(() => 0.5);
  return vals.map(v => (v - mn) / range);
}

/** 값 배열의 내림차순 1-based 순위(동점은 원래 인덱스 순으로 안정 배정). RRF 융합용. */
function ranksDesc(vals) {
  const order = vals.map((_, i) => i).sort((x, y) => (vals[y] - vals[x]) || (x - y));
  const rank = new Array(vals.length);
  order.forEach((idx, pos) => { rank[idx] = pos + 1; });
  return rank;
}

/**
 * MMR(Maximal Marginal Relevance) 재랭킹(§2) — 관련도와 다양성을 λ로 절충한다.
 * 각 단계에서 score = λ·rel(q,d) − (1−λ)·max_{s∈선택} cos(d, s) 가 최대인 후보를 탐욕적으로 선택한다.
 * 문서 벡터(doc.vec)를 재사용하며 추가 임베딩은 하지 않는다. 벡터가 없는 후보는 다양성 항이 0이 되어
 * 관련도만으로 평가되므로, 벡터가 전혀 없으면 결과는 관련도 순서와 동일해진다(회귀 안전).
 * 탐욕 선택 특성상 선택 순서가 곧 score 내림차순이다.
 * @param {Array<{serverId,toolName,score}>} cands 관련도(score) 내림차순 후보
 * @param {Map<string, number[]>} vecByKey 'serverId/toolName' → 벡터
 * @param {number} lambda 0~1 (1=관련도만, 0=다양성 최대)
 * @param {number} k 선택 개수
 * @returns {Array<{serverId,toolName,score}>} MMR score로 재정렬된 상위 k
 */
function mmrRerank(cands, vecByKey, lambda, k) {
  const lam = Math.min(1, Math.max(0, lambda));
  const pool = cands.map(c => ({
    serverId: c.serverId, toolName: c.toolName, rel: c.score,
    vec: vecByKey.get(`${c.serverId}/${c.toolName}`) || null,
  }));
  const selected = [];
  while (selected.length < k && pool.length) {
    let bestI = 0, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      let maxSim = 0;
      if (c.vec && c.vec.length) {
        for (const s of selected) {
          if (!s.vec || !s.vec.length) continue;
          const sim = cosine(c.vec, s.vec);
          if (sim > maxSim) maxSim = sim;
        }
      }
      const mmr = lam * c.rel - (1 - lam) * maxSim;
      if (mmr > bestScore) { bestScore = mmr; bestI = i; }
    }
    const [chosen] = pool.splice(bestI, 1);
    selected.push({ serverId: chosen.serverId, toolName: chosen.toolName, vec: chosen.vec, score: bestScore });
  }
  return selected.map(s => ({ serverId: s.serverId, toolName: s.toolName, score: s.score }));
}

/* ============================================================
   인덱스 구축 / 상태
   ============================================================ */

/**
 * 도구 단위 문서를 임베딩해 store 'catalogIndex'에 저장.
 * @param {{mcps:Array, embedModel?:string, docFields?:object,
 *          onProgress?:({done,total})=>void, signal?:AbortSignal}} opts
 *   docFields 미지정 시 기본값(desc+params) → 종전과 동일한 문서로 임베딩(회귀 없음). §2: 청킹 없음(도구당 1벡터).
 * @returns {Promise<object>} indexStatus 결과
 */
export async function buildIndex({ mcps = [], embedModel = 'bge-m3:latest', docFields, onProgress, signal } = {}) {
  const tools = flattenTools(mcps, docFields);
  const total = tools.length;
  if (!total) throw new Error('임베딩할 도구가 없습니다. MCP를 먼저 등록하세요.');

  onProgress?.({ done: 0, total });
  const docs = [];
  let dim = 0;

  for (let i = 0; i < total; i += EMBED_BATCH) {
    if (signal?.aborted) { const e = new Error('사용자에 의해 중단됨'); e.name = 'AbortError'; throw e; }
    const chunk = tools.slice(i, i + EMBED_BATCH);
    const vecs = await embed({ model: embedModel, input: chunk.map(t => t.text), signal });
    if (!Array.isArray(vecs) || vecs.length !== chunk.length) {
      throw new Error(`임베딩 응답 형식 오류 (요청 ${chunk.length}개 / 응답 ${Array.isArray(vecs) ? vecs.length : '없음'}개)`);
    }
    chunk.forEach((t, j) => {
      const v = vecs[j] || [];
      if (!dim && v.length) dim = v.length;
      docs.push({
        serverId: t.serverId,
        toolName: t.toolName,
        text: t.text,
        vec: v.map(x => Math.round(x * 1e4) / 1e4), // 소수 4자리 반올림
      });
    });
    onProgress?.({ done: Math.min(i + EMBED_BATCH, total), total });
  }

  const index = {
    builtAt: new Date().toISOString(),
    embedModel,
    dim,
    docs,
    docFields: { ...DEFAULT_DOC_FIELDS, ...(docFields || {}) }, // 재색인 판정용 — 문서 구성 토글 스냅샷
    mcpsFingerprint: fingerprint(mcps, embedModel, docFields),
  };
  if (!store.set(INDEX_KEY, index)) {
    throw new Error('인덱스 저장 실패 — localStorage 용량 한계(약 5MB)를 초과했을 수 있습니다.');
  }
  return indexStatus(mcps);
}

/**
 * 인덱스 상태 조회 — { exists, stale, builtAt, docCount, embedModel, dim }
 * @param {Array} mcps
 * @param {string} [embedModel] 비교 기준 임베딩 모델. 생략 시 인덱스가 구축된 모델을 사용해
 *   도구 설명/파라미터/카테고리 변경만으로 stale을 판정하고, 명시하면 모델 변경도 stale로 잡는다.
 * @param {object} [docFields] 현재 문서 구성 토글. 생략 시 인덱스가 구축된 docFields로 비교해
 *   문서 구성 변경만으로 stale이 되지 않게 하고, 명시하면 문서 구성 변경도 stale로 잡는다.
 */
export function indexStatus(mcps = [], embedModel, docFields) {
  const idx = store.get(INDEX_KEY);
  if (!idx || !Array.isArray(idx.docs) || !idx.docs.length) {
    return { exists: false, stale: false, builtAt: null, docCount: 0, embedModel: null, dim: 0 };
  }
  const df = docFields !== undefined ? docFields : idx.docFields;
  return {
    exists: true,
    stale: idx.mcpsFingerprint !== fingerprint(mcps, embedModel || idx.embedModel, df),
    builtAt: idx.builtAt || null,
    docCount: idx.docs.length,
    embedModel: idx.embedModel || null,
    dim: idx.dim || (idx.docs[0]?.vec?.length || 0),
  };
}

/* ============================================================
   검색(retrieve)
   ============================================================ */

async function embedQuery(query, model, signal) {
  const out = await embed({ model, input: query, signal });
  const v = out?.[0];
  if (!v || !v.length) throw new Error('질의 임베딩을 생성하지 못했습니다.');
  return v;
}

/** 인덱스 docs 중 현재 도구 목록에 실존하는 것만 코사인 점수 산출 */
function vectorScores(qvec, idx, keyToIndex, currentTools) {
  const out = [];
  for (const doc of idx.docs || []) {
    const key = `${doc.serverId}/${doc.toolName}`;
    const ci = keyToIndex.get(key);
    if (ci === undefined) continue; // 삭제/개명된 도구는 제외
    out.push({ serverId: doc.serverId, toolName: doc.toolName, i: ci, score: cosine(qvec, doc.vec || []) });
  }
  return out;
}

/** 선택된 매치들을 서버/카테고리 이웃으로 확장 */
function expand(matches, mcps, { expandServer, expandCategory }) {
  const byId = new Map((mcps || []).map(m => [m.id, m]));
  const keyOf = (s, t) => `${s}/${t}`;
  const chosen = new Map();
  for (const m of matches) chosen.set(keyOf(m.serverId, m.toolName), m);

  const addExpanded = (serverId, toolName, seedScore, source) => {
    const k = keyOf(serverId, toolName);
    if (chosen.has(k)) return;
    chosen.set(k, { serverId, toolName, score: seedScore, source });
  };

  if (expandServer) {
    for (const m of matches) {
      const srv = byId.get(m.serverId);
      if (!srv) continue;
      for (const t of srv.tools || []) addExpanded(srv.id, t.name, m.score, 'expandServer');
    }
  }
  if (expandCategory) {
    const catScore = new Map();
    for (const m of matches) {
      const c = byId.get(m.serverId)?.category;
      if (c) catScore.set(c, Math.max(catScore.get(c) ?? -Infinity, m.score));
    }
    for (const srv of mcps || []) {
      if (!srv?.category || !catScore.has(srv.category)) continue;
      for (const t of srv.tools || []) addExpanded(srv.id, t.name, catScore.get(srv.category), 'expandCategory');
    }
  }

  const rank = { match: 0, expandServer: 1, expandCategory: 2 };
  return [...chosen.values()].sort((a, b) => (b.score - a.score) || (rank[a.source] - rank[b.source]));
}

/**
 * 질의로 관련 도구를 검색한다.
 * @param {string} query
 * @param {{mcps:Array, method?:'vector'|'keyword'|'hybrid', topK?:number, threshold?:number,
 *          hybridAlpha?:number, hybridFusion?:'weighted'|'rrf', rrfK?:number,
 *          expandServer?:boolean, expandCategory?:boolean,
 *          embedModel?:string, docFields?:object, mmrLambda?:number, signal?:AbortSignal}} opts
 *   docFields: 문서 구성 토글(stale 판정·키워드 코퍼스에 사용, 미지정 시 인덱스 구축값/기본값).
 *   mmrLambda: 1.0(기본)=순수 관련도(현행), <1.0이면 MMR 재랭킹으로 다양성 확보(문서 벡터 재사용, 추가 임베딩 없음).
 *   hybridFusion(§F2, hybrid일 때만 의미): 'weighted'(기본)=코사인·BM25 min-max 정규화 후 alpha 가중합(현행
 *   경로 그대로), 'rrf'=Reciprocal Rank Fusion(점수 스케일 대신 두 랭킹의 순위로 융합, rrfK 기본 60).
 * @returns {Promise<{results:Array, usedMethod:string, requestedMethod:string,
 *          fallbackReason:string|null, topK:number, threshold:number}>}
 */
export async function retrieve(query, {
  mcps = [], method = 'hybrid', topK = 8, threshold = 0,
  hybridAlpha = 0.5, hybridFusion = 'weighted', rrfK = 60,
  expandServer = true, expandCategory = false,
  embedModel = 'bge-m3:latest', docFields, mmrLambda = 1, signal,
} = {}) {
  const q = String(query || '').trim();
  const k = Math.max(1, Math.floor(topK) || 8);
  const currentTools = flattenTools(mcps, docFields);
  const keyToIndex = new Map(currentTools.map((t, i) => [`${t.serverId}/${t.toolName}`, i]));

  const idx = store.get(INDEX_KEY);
  const idxExists = !!(idx && Array.isArray(idx.docs) && idx.docs.length);
  // 콘텐츠 stale은 인덱스가 구축된 모델 기준으로 판정 — embedModel 불일치는 아래에서 별도 사유로 처리.
  // docFields는 현재 config값(미지정 시 인덱스 구축값)으로 비교해 문서 구성 변경 시 stale→키워드 폴백.
  const idxStale = idxExists && idx.mcpsFingerprint !== fingerprint(mcps, idx.embedModel, docFields !== undefined ? docFields : idx.docFields);
  const idxDim = idxExists ? (idx.dim || idx.docs[0]?.vec?.length || 0) : 0;

  // vector/hybrid는 임베딩 인덱스를 요구 — 없음/stale/모델 불일치면 keyword로 폴백
  let usedMethod = (method === 'vector' || method === 'keyword' || method === 'hybrid') ? method : 'hybrid';
  let fallbackReason = null;
  if (usedMethod === 'vector' || usedMethod === 'hybrid') {
    if (!idxExists) { usedMethod = 'keyword'; fallbackReason = '인덱스가 없어 키워드 검색으로 대체'; }
    else if (idxStale) { usedMethod = 'keyword'; fallbackReason = 'MCP 구성이 변경되어(인덱스 stale) 키워드 검색으로 대체'; }
    else if (idx.embedModel && embedModel && idx.embedModel !== embedModel) {
      usedMethod = 'keyword';
      fallbackReason = `인덱스 임베딩 모델(${idx.embedModel})과 요청 모델(${embedModel})이 달라 키워드 검색으로 대체`;
    }
  }

  const empty = () => ({ results: [], usedMethod, requestedMethod: method, fallbackReason, topK: k, threshold });
  if (!currentTools.length || !q) return empty();

  const qTerms = uniq(tokenize(q));
  let scored = [];

  // BM25 키워드 점수 — 폴백 시 vector/hybrid 경로에서도 재사용
  const keywordScores = () => {
    const model = buildBM25(currentTools);
    const out = [];
    for (let i = 0; i < currentTools.length; i++) {
      const s = bm25ScoreAt(model, qTerms, i);
      if (s > 0) out.push({ serverId: currentTools[i].serverId, toolName: currentTools[i].toolName, score: s });
    }
    return out;
  };

  if (usedMethod === 'keyword') {
    scored = keywordScores();
  } else if (usedMethod === 'vector') {
    const qvec = await embedQuery(q, embedModel, signal);
    // 코사인 계산 전 차원 일치 가드 — 불일치면 keyword로 폴백
    if (idxDim && qvec.length !== idxDim) {
      usedMethod = 'keyword';
      fallbackReason = `질의 벡터 차원(${qvec.length})이 인덱스 차원(${idxDim})과 달라 키워드 검색으로 대체`;
      scored = keywordScores();
    } else {
      scored = vectorScores(qvec, idx, keyToIndex, currentTools)
        .map(({ serverId, toolName, score }) => ({ serverId, toolName, score }));
    }
  } else { // hybrid — weighted(기본): 정규화 점수 가중합(현행) / rrf: 순위 융합(RRF)
    const qvec = await embedQuery(q, embedModel, signal);
    if (idxDim && qvec.length !== idxDim) {
      usedMethod = 'keyword';
      fallbackReason = `질의 벡터 차원(${qvec.length})이 인덱스 차원(${idxDim})과 달라 키워드 검색으로 대체`;
      scored = keywordScores();
    } else {
      const vec = vectorScores(qvec, idx, keyToIndex, currentTools); // 공통(인덱스∩현재) 집합
      if (vec.length) {
        const model = buildBM25(currentTools);
        const vecRaw = vec.map(v => v.score);
        const bmRaw = vec.map(v => bm25ScoreAt(model, qTerms, v.i));
        const vecVals = minmax(vecRaw);
        const bmVals = minmax(bmRaw);
        const a = Math.min(1, Math.max(0, Number(hybridAlpha)));
        if (hybridFusion === 'rrf') {
          // RRF(Reciprocal Rank Fusion, §F2): 점수 스케일 대신 "순위"로 융합 — score = Σ 1/(rrfK+rank).
          // [threshold 의미 — 중요] RRF 융합 점수는 상한이 2/(rrfK+1)≈0.033(rrfK=60)으로 스케일이 작아,
          // 0~1 정규화 점수를 전제한 기존 threshold를 융합 점수에 그대로 대면 전부 잘려나간다. 따라서
          // threshold는 융합 점수가 아니라 종전 weighted와 동일한 "개별 정규화 점수의 가중합"
          // (a*vecNorm+(1-a)*bmNorm, 아래 gateScore) 기준으로 유지하고, RRF 점수(score)는 순위 결정에만 쓴다.
          // [무신호 랭커 제외 — §H1] 원점수가 전부 동일(분산 0)한 랭커(BM25 raw 전부 0 포함)는 순위가
          // "등록 순서"일 뿐 정보가 없으므로 1/(K+rank) 기여를 생략한다 — 등록 순서 노이즈가 융합 순위를
          // 흔들지 않게. 두 랭커 모두 무신호면 전원 0점 동률(안정 정렬로 원 순서 유지, gateScore는 종전대로).
          const K = Math.max(1, Number(rrfK) || 60);
          const spread = (vals) => {
            let mn = Infinity, mx = -Infinity;
            for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; }
            return mx - mn;
          };
          const vecSignal = spread(vecRaw) > 1e-12;
          const bmSignal = spread(bmRaw) > 1e-12;
          const vecRank = ranksDesc(vecVals);
          const bmRank = ranksDesc(bmVals);
          scored = vec.map((v, n) => ({
            serverId: v.serverId, toolName: v.toolName,
            score: (vecSignal ? 1 / (K + vecRank[n]) : 0) + (bmSignal ? 1 / (K + bmRank[n]) : 0),
            gateScore: a * vecVals[n] + (1 - a) * bmVals[n], // threshold 게이트 전용(결과에는 미포함)
          }));
        } else { // 'weighted'(기본) — 현행 경로 그대로
          scored = vec.map((v, n) => ({
            serverId: v.serverId, toolName: v.toolName,
            score: a * vecVals[n] + (1 - a) * bmVals[n],
          }));
        }
      }
    }
  }

  // threshold 필터 → 점수 내림차순. threshold는 각 방식의 "기존 점수"(keyword=BM25 원점수, vector=코사인,
  // hybrid=개별 정규화 가중합) 기준 — hybridFusion='rrf'일 때도 gateScore(가중합)로 게이트하고
  // 정렬·상위 선정만 RRF 점수(score)로 한다. gateScore가 없으면(비-rrf 경로) 종전대로 score로 게이트.
  const filtered = scored
    .filter(s => (s.gateScore !== undefined ? s.gateScore : s.score) >= threshold)
    .sort((x, y) => y.score - x.score)
    .map(({ serverId, toolName, score }) => ({ serverId, toolName, score })); // gateScore 등 내부 필드 제거
  // mmrLambda < 1이면 MMR 재랭킹으로 다양성 확보(인덱스 벡터 재사용). 1.0/미지정이면 순수 관련도 topK(현행).
  const lam = Number.isFinite(mmrLambda) ? mmrLambda : 1;
  let picked;
  if (lam < 1) {
    const vecByKey = idxExists
      ? new Map((idx.docs || []).map(d => [`${d.serverId}/${d.toolName}`, d.vec || []]))
      : new Map();
    picked = mmrRerank(filtered, vecByKey, lam, k);
  } else {
    picked = filtered.slice(0, k);
  }
  const matches = picked.map(s => ({ ...s, source: 'match' }));

  const results = expand(matches, mcps, { expandServer, expandCategory });
  return { results, usedMethod, requestedMethod: method, fallbackReason, topK: k, threshold };
}

/**
 * 멀티 질의 검색(§F2, 구조 §H1) — "부질의별 match 검색 → 라운드로빈 병합 → topK 절단 → 확장 1회".
 * 각 부질의를 확장 없이(expandServer/expandCategory 강제 off) retrieve(topK=perK)로 검색한 뒤
 * "부질의1의 1위 → 부질의2의 1위 → … → 부질의1의 2위 → …" 순서로 교차 병합하고, 중복(serverId/toolName)은
 * 먼저 나온 항목을 남기며 제거, topK로 절단한 다음, 그 병합 결과에 확장(expand)을 1회 적용한다.
 * 복합 질의를 측면별 부질의로 분해했을 때 각 측면의 상위 후보가 고르게 살아남게 하는 병합 방식이다.
 *
 * [§H1 구조 변경 이유] 종전에는 부질의별 retrieve가 확장까지 포함한 결과를 반환했고, 확장 항목이
 * 라운드로빈 슬롯을 차지해 topK 절단 시 다른 부질의의 match를 밀어냈다(단일 경로는 "match topK 선정 후
 * 확장"이라 공급량이 비대칭 — 실측 리콜 77.1% vs 병합후확장 89.2%). 지금은 단일 경로와 공급이 대칭이다.
 *
 * - 반환 형태는 retrieve와 동일: { results, usedMethod, requestedMethod, fallbackReason, topK, threshold }.
 *   usedMethod/requestedMethod/threshold는 첫 부질의 결과 기준(폴백은 인덱스 상태에 좌우되므로 부질의 간
 *   동일), fallbackReason은 부질의들의 사유를 중복 제거해 병합 표기한다.
 * - results 순서: match(topK개 이하)는 "라운드로빈 병합 순서"(교차 순위가 곧 우선순위 — 점수 내림차순이
 *   아님), 그 뒤에 확장 항목(source: 'expandServer'|'expandCategory')이 이어진다. 부질의 간 score는 직접
 *   비교가 불가하므로 확장 항목을 match와 섞어 재정렬하지 않고 뒤에 덧붙인다(확장 항목끼리는 seed 점수
 *   내림차순). score는 각 항목이 처음 나온 부질의 결과의 값을 그대로 유지한다.
 * - 부질의가 1개면 retrieve(부질의, {...opts, topK})와 완전히 동일하게 동작한다(분해가 원질의 1개로
 *   끝났을 때 비-멀티 경로와 결과가 달라지지 않게 — 회귀 방지).
 * @param {string[]} subQueries 부질의 배열(빈 문자열은 무시)
 * @param {{topK?:number, perK?:number}} opts perK(기본 4): 부질의별 retrieve topK. 나머지 옵션은
 *   retrieve와 동일하게 각 부질의 호출에 그대로 전달된다(mcps, method, threshold, hybridFusion 등).
 *   expandServer/expandCategory는 부질의 검색에는 적용하지 않고 병합 결과에 1회 적용한다.
 * @returns {Promise<{results:Array, usedMethod:string, requestedMethod:string,
 *          fallbackReason:string|null, topK:number, threshold:number}>}
 */
export async function retrieveMulti(subQueries, opts = {}) {
  const list = (Array.isArray(subQueries) ? subQueries : [subQueries])
    .map(s => String(s || '').trim())
    .filter(Boolean);
  const k = Math.max(1, Math.floor(opts.topK) || 8);
  // 부질의 0개(빈 질의)·1개는 단일 retrieve로 위임 — 반환 형태·동작 모두 retrieve와 동일(회귀 없음).
  if (!list.length) return retrieve('', { ...opts, topK: k });
  if (list.length === 1) return retrieve(list[0], { ...opts, topK: k });

  const perK = Math.max(1, Math.floor(opts.perK) || 4);
  const subResults = [];
  for (const sq of list) {
    // 순차 실행: AbortSignal 전파·임베딩 호출 순서를 결정적으로 유지(ollama는 어차피 직렬 처리).
    // §H1: 부질의 검색은 확장 없이 순수 match만(perK개) — 확장은 병합·절단 후 1회만 적용한다.
    subResults.push(await retrieve(sq, { ...opts, topK: perK, expandServer: false, expandCategory: false }));
  }

  // 라운드로빈 병합: 각 부질의 match(점수순)의 i위를 부질의 순서대로 교차 채택 → topK 절단.
  const merged = [];
  const seen = new Set();
  const maxLen = Math.max(...subResults.map(r => (r.results || []).length));
  for (let i = 0; i < maxLen && merged.length < k; i++) {
    for (const r of subResults) {
      if (merged.length >= k) break;
      const item = (r.results || [])[i];
      if (!item) continue;
      const key = `${item.serverId}/${item.toolName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  // 병합 결과에 확장 1회 적용(단일 경로의 "match 선정 → 확장"과 공급 대칭 — §H1). match는 라운드로빈
  // 순서를 유지하고(교차 순위가 곧 우선순위 계약), 새로 편입된 확장 항목만 뒤에 덧붙인다.
  const expServer = opts.expandServer !== undefined ? !!opts.expandServer : true; // retrieve 기본값과 동일
  const expCategory = opts.expandCategory !== undefined ? !!opts.expandCategory : false;
  const expanded = expand(merged, opts.mcps || [], { expandServer: expServer, expandCategory: expCategory });
  const results = [...merged, ...expanded.filter(e => e.source !== 'match')];

  const first = subResults[0];
  const reasons = [...new Set(subResults.map(r => r.fallbackReason).filter(Boolean))];
  return {
    results,
    usedMethod: first.usedMethod,
    requestedMethod: first.requestedMethod,
    fallbackReason: reasons.length ? `부질의 ${list.length}개 병합: ${reasons.join(' / ')}` : null,
    topK: k,
    threshold: first.threshold,
  };
}
