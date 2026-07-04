// ============================================================================
// catalogIndex.js — MCP 도구 카탈로그의 검색 기반 공급(retrieval) 엔진
// SPEC-GATEWAY §4 계약 구현. 순수 ES module.
//
//  buildIndex({mcps, embedModel, onProgress})  도구 단위 문서 임베딩 → store 'catalogIndex'
//  indexStatus(mcps)                            인덱스 존재/stale/도구수/모델/구축시각
//  retrieve(query, {mcps, ...retrieval파라미터}) vector·keyword·hybrid 검색 + 확장
//
// 저장 형태(store 'catalogIndex'):
//  { builtAt, embedModel, dim, docs: [{ serverId, toolName, text, vec(소수4자리) }], mcpsFingerprint }
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

/** 도구 1개의 임베딩/토큰화 대상 문서 텍스트 — 서버명/설명 + 도구명/설명 + 파라미터명·설명 */
function toolDocText(server, tool) {
  const parts = [];
  parts.push(server.nameKo || server.name || server.id || '');
  if (server.name && server.name !== server.nameKo) parts.push(server.name);
  if (server.description) parts.push(server.description);
  parts.push(tool.name || '');
  if (tool.description) parts.push(tool.description);
  const props = tool.inputSchema?.properties || {};
  for (const [n, p] of Object.entries(props)) {
    parts.push(p && p.description ? `${n} ${p.description}` : n);
  }
  return parts.filter(Boolean).join('\n');
}

/** 등록된 모든 서버의 도구를 [{serverId, toolName, category, text}] 로 평탄화(등록 순서 보존) */
function flattenTools(mcps) {
  const out = [];
  for (const srv of mcps || []) {
    if (!srv || !srv.id) continue;
    for (const tool of srv.tools || []) {
      if (!tool || !tool.name) continue;
      out.push({ serverId: srv.id, toolName: tool.name, category: srv.category || '', text: toolDocText(srv, tool) });
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
 * @param {Array} mcps
 * @param {string} [embedModel]
 */
export function fingerprint(mcps, embedModel) {
  const SEP = '\u0001'; // 필드 구분자
  const REC = '\u0002'; // 레코드 구분자
  const keys = flattenTools(mcps).map(
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

/* ============================================================
   인덱스 구축 / 상태
   ============================================================ */

/**
 * 도구 단위 문서를 임베딩해 store 'catalogIndex'에 저장.
 * @param {{mcps:Array, embedModel?:string, onProgress?:({done,total})=>void, signal?:AbortSignal}} opts
 * @returns {Promise<object>} indexStatus 결과
 */
export async function buildIndex({ mcps = [], embedModel = 'bge-m3:latest', onProgress, signal } = {}) {
  const tools = flattenTools(mcps);
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
    mcpsFingerprint: fingerprint(mcps, embedModel),
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
 */
export function indexStatus(mcps = [], embedModel) {
  const idx = store.get(INDEX_KEY);
  if (!idx || !Array.isArray(idx.docs) || !idx.docs.length) {
    return { exists: false, stale: false, builtAt: null, docCount: 0, embedModel: null, dim: 0 };
  }
  return {
    exists: true,
    stale: idx.mcpsFingerprint !== fingerprint(mcps, embedModel || idx.embedModel),
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
 *          hybridAlpha?:number, expandServer?:boolean, expandCategory?:boolean,
 *          embedModel?:string, signal?:AbortSignal}} opts
 * @returns {Promise<{results:Array, usedMethod:string, requestedMethod:string,
 *          fallbackReason:string|null, topK:number, threshold:number}>}
 */
export async function retrieve(query, {
  mcps = [], method = 'hybrid', topK = 8, threshold = 0,
  hybridAlpha = 0.5, expandServer = true, expandCategory = false,
  embedModel = 'bge-m3:latest', signal,
} = {}) {
  const q = String(query || '').trim();
  const k = Math.max(1, Math.floor(topK) || 8);
  const currentTools = flattenTools(mcps);
  const keyToIndex = new Map(currentTools.map((t, i) => [`${t.serverId}/${t.toolName}`, i]));

  const idx = store.get(INDEX_KEY);
  const idxExists = !!(idx && Array.isArray(idx.docs) && idx.docs.length);
  // 콘텐츠 stale은 인덱스가 구축된 모델 기준으로 판정 — embedModel 불일치는 아래에서 별도 사유로 처리
  const idxStale = idxExists && idx.mcpsFingerprint !== fingerprint(mcps, idx.embedModel);
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
  } else { // hybrid — 코사인·BM25 각각 min-max 정규화 후 alpha 가중합
    const qvec = await embedQuery(q, embedModel, signal);
    if (idxDim && qvec.length !== idxDim) {
      usedMethod = 'keyword';
      fallbackReason = `질의 벡터 차원(${qvec.length})이 인덱스 차원(${idxDim})과 달라 키워드 검색으로 대체`;
      scored = keywordScores();
    } else {
      const vec = vectorScores(qvec, idx, keyToIndex, currentTools); // 공통(인덱스∩현재) 집합
      if (vec.length) {
        const model = buildBM25(currentTools);
        const vecVals = minmax(vec.map(v => v.score));
        const bmVals = minmax(vec.map(v => bm25ScoreAt(model, qTerms, v.i)));
        const a = Math.min(1, Math.max(0, Number(hybridAlpha)));
        scored = vec.map((v, n) => ({
          serverId: v.serverId, toolName: v.toolName,
          score: a * vecVals[n] + (1 - a) * bmVals[n],
        }));
      }
    }
  }

  // threshold 필터 → 점수 내림차순 → topK
  let matches = scored
    .filter(s => s.score >= threshold)
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map(s => ({ ...s, source: 'match' }));

  const results = expand(matches, mcps, { expandServer, expandCategory });
  return { results, usedMethod, requestedMethod: method, fallbackReason, topK: k, threshold };
}
