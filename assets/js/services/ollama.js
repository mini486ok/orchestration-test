// Ollama 로컬 LLM 클라이언트 — 모든 LLM 호출은 이 모듈을 경유
// 서버 모드(게이트웨이 설정 시)에서는 게이트웨이가 LLM 을 중계한다. 로컬 모드 동작은 기존과 동일.
import { store } from '../core/store.js';
import { isServerMode, gwFetch, setQuotaRemaining } from './gateway.js';

export function getOllamaUrl() {
  const s = store.get('settings') || {};
  return (s.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
}

export function getDefaultModel() {
  return (store.get('settings') || {}).defaultModel || 'exaone3.5:7.8b';
}

/** 설정된 컨텍스트 길이(num_ctx) */
export function getNumCtx() {
  const s = store.get('settings') || {};
  return Number(s.numCtx) > 0 ? Number(s.numCtx) : 16384;
}

/** LLM 호출당 타임아웃(초). 기본 300, 0=무제한. 미설정(구버전 settings)·비정상 값은 기본값으로 방어. */
export function getLlmTimeoutSec() {
  const s = store.get('settings') || {};
  const v = Number(s.llmTimeoutSec);
  if (!Number.isFinite(v) || v < 0) return 300;
  return v; // 0 = 무제한
}

/**
 * LLM 호출당 타임아웃 시그널 생성 — 기존 signal(사용자 중단)과 타임아웃을 결합한다.
 * - AbortSignal.any 지원 시 이를 사용, 미지원 브라우저는 수동 리스너 결합으로 폴백.
 * - llmTimeoutSec=0(무제한)이면 기존 signal을 그대로 통과시켜 기존 동작과 동일.
 * 반환: { signal, done(), mapAbort(e) }
 *   done(): 호출 완료 후 타이머·폴백 abort 리스너 정리(finally에서 반드시 호출).
 *   mapAbort(e): AbortError가 타임아웃에 의한 것이면 한국어 타임아웃 오류(name='TimeoutError')로 변환해
 *   반환(사용자 중단 AbortError와 구분 — 상위 로직이 일반 오류로 집계), 아니면 원본 그대로 반환.
 */
function createLlmTimeout(signal) {
  const sec = getLlmTimeoutSec();
  if (!(sec > 0)) return { signal, done() { /* 없음 */ }, mapAbort: (e) => e };

  const timeoutCtrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; timeoutCtrl.abort(); }, sec * 1000);

  let combined;
  let removeAbortListener = null; // 폴백 경로에서 외부 signal에 등록한 리스너 해제용(장수명 signal 누수 방지)
  if (!signal) {
    combined = timeoutCtrl.signal;
  } else if (typeof AbortSignal.any === 'function') {
    combined = AbortSignal.any([signal, timeoutCtrl.signal]);
  } else {
    // AbortSignal.any 미지원 폴백: 두 시그널을 수동 리스너로 하나의 컨트롤러에 결합
    const ctrl = new AbortController();
    const onAbort = () => { try { ctrl.abort(); } catch { /* 무시 */ } };
    if (signal.aborted) onAbort();
    else {
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    }
    timeoutCtrl.signal.addEventListener('abort', onAbort, { once: true });
    combined = ctrl.signal;
  }
  return {
    signal: combined,
    done() { clearTimeout(timer); removeAbortListener?.(); },
    mapAbort(e) {
      // 사용자 중단이 먼저였으면(경합 시 우선) 원본 AbortError 유지 — 중단 의미 보존
      if (signal?.aborted || !timedOut) return e;
      const err = new Error(`LLM 응답 시간 초과(${sec}초) — 모델 응답이 너무 오래 걸립니다. 설정의 "LLM 응답 타임아웃"에서 조정하세요(0=무제한).`);
      err.name = 'TimeoutError';
      return err;
    },
  };
}

/**
 * 로컬/사설망 대상 fetch 래퍼 — https 공개 페이지에서 사설 IP·localhost로 요청할 때
 * Chrome의 Local Network Access를 위해 targetAddressSpace 값을 순차 시도한다.
 * (버전에 따라 'local'/'private'/'loopback' 명칭이 다르므로 실패 시 재시도. 옵션 미지원 브라우저는 무시됨)
 */
async function fetchLNA(url, init = {}) {
  const attempts = [init];
  try {
    if (location.protocol === 'https:' && !/^(localhost|127\.)/.test(location.hostname)) {
      const h = new URL(url, location.href).hostname;
      let spaces = [];
      if (/^(localhost|127\.|\[::1\])/.test(h)) spaces = ['loopback', 'local'];
      else if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) spaces = ['local', 'private'];
      for (const s of spaces) attempts.push({ ...init, targetAddressSpace: s });
    }
  } catch { /* URL 파싱 실패 시 기본 시도만 */ }

  let lastErr;
  for (const opt of attempts) {
    try { return await fetch(url, opt); }
    catch (e) {
      if (e?.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

/** https 공개 페이지에서 로컬 주소로 접근하는 상황인지 (Chrome 로컬 네트워크 액세스 권한 필요 가능) */
export function isPublicToLocal() {
  try {
    const target = new URL(getOllamaUrl());
    const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|::1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(target.hostname);
    const pagePublic = location.protocol === 'https:' && !/^(localhost|127\.)/.test(location.hostname);
    return local && pagePublic;
  } catch { return false; }
}

function connectFailHint() {
  if (isPublicToLocal()) {
    return 'Ollama 서버에 연결할 수 없습니다. 배포 페이지(https)에서 로컬 Ollama에 접근하려면 ① 브라우저의 "로컬 네트워크 액세스" 권한 허용(주소창 자물쇠 → 사이트 설정), ② OLLAMA_ORIGINS 설정, ③ 보안 확장/정책의 로컬 접근 차단 여부를 확인하세요. 가이드의 "Ollama 연결 설정"을 참고하세요.';
  }
  return `Ollama 서버에 연결할 수 없습니다 (${getOllamaUrl()}). Ollama 실행 여부와 OLLAMA_ORIGINS 설정을 확인하세요.`;
}

/** 연결 확인: {ok, version?, error?} */
export async function checkConnection(timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // 서버 모드: 게이트웨이의 /llm/version(내부 Ollama 프록시)으로 LLM 가용성 확인
    const res = isServerMode()
      ? await gwFetch('/llm/version', { signal: ctrl.signal })
      : await fetchLNA(getOllamaUrl() + '/api/version', { signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, version: data.version };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: '응답 시간 초과' };
    if (isServerMode()) return { ok: false, error: e.message || '게이트웨이 연결 실패' };
    return { ok: false, error: isPublicToLocal() ? '로컬 네트워크 접근이 차단됨(권한/정책 확인 — 가이드 참조)' : (e.message || '연결 실패') };
  } finally {
    clearTimeout(timer);
  }
}

const EMBED_RE = /bge|embed|e5|gte|nomic|minilm/i;

// /api/tags 응답을 뷰가 쓰는 형태로 정규화
// onlyEmbedding=true면 임베딩 모델만, false면 채팅 모델만, null이면 전체
function mapModels(data, onlyEmbedding = false) {
  return (data.models || [])
    .filter(m => onlyEmbedding === null ? true : (EMBED_RE.test(m.name) === !!onlyEmbedding))
    .map(m => ({
      name: m.name,
      sizeGB: m.size ? (m.size / 1e9).toFixed(1) : '?',
      family: m.details?.family || '',
      paramSize: m.details?.parameter_size || '',
      isEmbedding: EMBED_RE.test(m.name),
    }));
}

/**
 * 설치된 모델 목록: [{name, sizeGB, family, paramSize, isEmbedding}]
 * @param {{embedding?: boolean|null}} opts embedding=false(기본): 채팅 모델만 /
 *   embedding=true: 임베딩 모델만 / embedding=null: 전체
 */
export async function listModels({ embedding = false } = {}) {
  // 서버 모드: 게이트웨이의 /llm/tags 프록시(쿼터 무소모)
  const res = isServerMode()
    ? await gwFetch('/llm/tags')
    : await fetchLNA(getOllamaUrl() + '/api/tags');
  if (!res.ok) throw new Error(`모델 목록 조회 실패 (HTTP ${res.status})`);
  const data = await res.json();
  return mapModels(data, embedding);
}

/**
 * 응답 JSON에서 토큰 계측을 추출한다.
 * - Ollama 원본이 prompt_eval_count(입력)·eval_count(출력)를 주면 실측값 사용(tokensEstimated:false).
 * - 하나라도 없으면 문자수/2.2(한글 혼합 텍스트 기준 근사)로 추정하고 tokensEstimated:true.
 * @param {object} data 응답 JSON
 * @param {Array} messages 요청 messages(입력 문자수 추정용)
 * @param {string} content 응답 content(출력 문자수 추정용)
 * @returns {{promptTokens:number, outputTokens:number, tokensEstimated:boolean}}
 */
function extractTokens(data, messages, content) {
  const pe = data?.prompt_eval_count;
  const ec = data?.eval_count;
  const havePrompt = Number.isFinite(pe);
  const haveOutput = Number.isFinite(ec);
  if (havePrompt && haveOutput) {
    return { promptTokens: pe, outputTokens: ec, tokensEstimated: false };
  }
  // 하나라도 실측이 없으면 추정으로 채운다(있는 값은 실측 유지). 하나라도 추정이면 estimated=true.
  const inChars = (messages || []).reduce((s, m) => s + (m?.content?.length || 0), 0);
  const outChars = (content || '').length;
  return {
    promptTokens: havePrompt ? pe : Math.round(inChars / 2.2),
    outputTokens: haveOutput ? ec : Math.round(outChars / 2.2),
    tokensEstimated: true,
  };
}

/**
 * 채팅 완성 호출 (stream: false)
 * @param {{model?, messages, temperature?, format?, signal?}} opts
 * @returns {Promise<{content, durationMs, model, promptTokens, outputTokens, tokensEstimated}>}
 */
export async function chat({ model, messages, temperature = 0.2, format, signal } = {}) {
  const useModel = model || getDefaultModel();
  const numCtx = getNumCtx();
  const t0 = performance.now();
  const body = {
    model: useModel,
    messages,
    stream: false,
    options: { temperature, num_ctx: numCtx },
  };
  if (format === 'json') body.format = 'json';

  // 서버 모드: 게이트웨이 /llm/chat 경유 (쿼터 소모, X-Quota-Remaining 헤더 반영)
  if (isServerMode()) return chatViaGateway(body, useModel, t0, signal);

  // 호출당 타임아웃(설정 llmTimeoutSec, 기본 300초, 0=무제한)을 기존 signal과 결합
  const tmo = createLlmTimeout(signal);
  try {
    let res;
    try {
      res = await fetchLNA(getOllamaUrl() + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: tmo.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw tmo.mapAbort(e);
      throw new Error(connectFailHint());
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error || ''; } catch { /* 무시 */ }
      throw new Error(`LLM 호출 실패 (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
    }
    let data;
    try { data = await res.json(); }
    catch (e) {
      // 응답 본문 수신 중의 타임아웃/중단도 동일하게 판별
      if (e?.name === 'AbortError') throw tmo.mapAbort(e);
      throw e;
    }
    const content = data.message?.content ?? '';
    const tok = extractTokens(data, messages, content);
    return {
      content,
      durationMs: performance.now() - t0,
      model: useModel,
      ...tok,
    };
  } finally {
    tmo.done();
  }
}

// 서버 모드 chat — 게이트웨이 /llm/chat. 429 는 한도 소진 오류, X-Quota-Remaining 으로 쿼터 갱신.
async function chatViaGateway(body, useModel, t0, signal) {
  // 호출당 타임아웃(설정 llmTimeoutSec)을 기존 signal과 결합 — 로컬 모드 chat()과 동일 정책
  const tmo = createLlmTimeout(signal);
  try {
    let res;
    try {
      res = await gwFetch('/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: tmo.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw tmo.mapAbort(e);
      throw new Error('게이트웨이에 연결할 수 없습니다. 게이트웨이 주소와 서버 상태를 확인하세요.');
    }
    const rem = res.headers.get('X-Quota-Remaining');
    if (rem !== null) setQuotaRemaining(rem);
    if (res.status === 429) {
      throw new Error('오늘의 LLM 호출 한도를 모두 사용했습니다(남은 호출 0). 관리자에게 한도 상향을 요청하세요.');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error || ''; } catch { /* 무시 */ }
      throw new Error(`LLM 호출 실패 (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
    }
    let data;
    try { data = await res.json(); }
    catch (e) {
      // 응답 본문 수신 중의 타임아웃/중단도 동일하게 판별
      if (e?.name === 'AbortError') throw tmo.mapAbort(e);
      throw e;
    }
    const content = data.message?.content ?? '';
    // 게이트웨이는 Ollama 원본 JSON(prompt_eval_count/eval_count 포함)을 그대로 통과시킨다.
    const tok = extractTokens(data, body?.messages, content);
    return {
      content,
      durationMs: performance.now() - t0,
      model: useModel,
      ...tok,
    };
  } finally {
    tmo.done();
  }
}

/**
 * 임베딩 생성 — Ollama /api/embed
 * @param {{model?: string, input: string|string[], signal?}} opts
 * @returns {Promise<number[][]>} 입력 순서대로의 임베딩 벡터 배열
 */
export async function embed({ model = 'bge-m3:latest', input, signal } = {}) {
  // 서버 모드: 게이트웨이 /llm/embed 프록시 (쿼터 무소모)
  if (isServerMode()) return embedViaGateway({ model, input, signal });

  // 호출당 타임아웃(설정 llmTimeoutSec)을 기존 signal과 결합 — chat()과 동일 정책
  const tmo = createLlmTimeout(signal);
  try {
    let res;
    try {
      res = await fetchLNA(getOllamaUrl() + '/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input }),
        signal: tmo.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw tmo.mapAbort(e);
      throw new Error(connectFailHint());
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error || ''; } catch { /* 무시 */ }
      throw new Error(`임베딩 호출 실패 (HTTP ${res.status})${detail ? ': ' + detail : ''} — 임베딩 모델(${model}) 설치 여부를 확인하세요.`);
    }
    let data;
    try { data = await res.json(); }
    catch (e) {
      if (e?.name === 'AbortError') throw tmo.mapAbort(e);
      throw e;
    }
    return data.embeddings || [];
  } finally {
    tmo.done();
  }
}

// 서버 모드 embed — 게이트웨이 /llm/embed
async function embedViaGateway({ model, input, signal }) {
  // 호출당 타임아웃(설정 llmTimeoutSec)을 기존 signal과 결합
  const tmo = createLlmTimeout(signal);
  try {
    let res;
    try {
      res = await gwFetch('/llm/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input }),
        signal: tmo.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw tmo.mapAbort(e);
      throw new Error('게이트웨이에 연결할 수 없습니다. 임베딩 요청을 보낼 수 없습니다.');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error || ''; } catch { /* 무시 */ }
      throw new Error(`임베딩 호출 실패 (HTTP ${res.status})${detail ? ': ' + detail : ''} — 임베딩 모델(${model}) 설치 여부를 확인하세요.`);
    }
    let data;
    try { data = await res.json(); }
    catch (e) {
      if (e?.name === 'AbortError') throw tmo.mapAbort(e);
      throw e;
    }
    return data.embeddings || [];
  } finally {
    tmo.done();
  }
}

// 한 후보 문자열에서 JSON을 추출: 전체 파싱 → 실패 시 모든 '{'/'[' 시작 위치를 순서대로 시도(최대 20개)
function parseCandidate(t) {
  if (!t) return undefined;
  try { return { value: JSON.parse(t) }; } catch { /* 위치별 탐색으로 계속 */ }
  const starts = [];
  for (let i = 0; i < t.length && starts.length < 20; i++) {
    if (t[i] === '{' || t[i] === '[') starts.push(i);
  }
  for (const start of starts) {
    const open = t[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return { value: JSON.parse(t.slice(start, i + 1)) }; } catch { break; }
        }
      }
    }
  }
  return undefined;
}

/** 텍스트에서 JSON을 강건하게 추출 */
export function extractJSON(text) {
  if (!text) return undefined;
  const base = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // 후보 수집: 코드펜스(여러 개면 각각) 우선, 그다음 전체 텍스트
  const candidates = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fenceRe.exec(base)) !== null) {
    const inner = m[1].trim();
    if (inner) candidates.push(inner);
  }
  candidates.push(base);

  for (const c of candidates) {
    const r = parseCandidate(c);
    if (r) return r.value;
  }
  return undefined;
}

/**
 * JSON 응답을 기대하는 호출 — 실패 시 1회 재시도(형식 교정 요청)
 * @returns {Promise<{data, raw, durationMs, retried, calls, promptTokens, outputTokens, tokensEstimated}>}
 *   calls: 실제 LLM 호출 횟수(1 또는 2). promptTokens/outputTokens: 내부 chat 호출 합산.
 *   tokensEstimated: 내부 호출 중 하나라도 추정이면 true.
 */
export async function chatJSON({ model, messages, temperature = 0.1, signal } = {}) {
  // 실패 시에도 시도한 호출 수를 오류 객체에 실어(e.llmCalls) 호출측이 집계할 수 있게 한다
  let first;
  try {
    first = await chat({ model, messages, temperature, format: 'json', signal });
  } catch (e) {
    // 첫 호출 자체가 실패(연결/HTTP)하면 처리된 토큰이 없으므로 0으로 실어 보낸다.
    if (e && typeof e === 'object') { e.llmCalls = 1; e.promptTokens = 0; e.outputTokens = 0; e.tokensEstimated = false; }
    throw e;
  }
  let data = extractJSON(first.content);
  if (data !== undefined) {
    return {
      data, raw: first.content, durationMs: first.durationMs, retried: false, calls: 1,
      promptTokens: first.promptTokens || 0,
      outputTokens: first.outputTokens || 0,
      tokensEstimated: !!first.tokensEstimated,
    };
  }

  // 재시도: 이전 응답을 보여주고 JSON만 요구
  const retryMessages = [
    ...messages,
    { role: 'assistant', content: first.content },
    { role: 'user', content: '위 응답을 유효한 JSON 하나로만 다시 출력하세요. 설명·코드블록·주석 없이 JSON만 출력합니다.' },
  ];
  let second;
  try {
    second = await chat({ model, messages: retryMessages, temperature: 0, format: 'json', signal });
  } catch (e) {
    // 재시도 호출 실패: 첫 호출은 성공했으므로 그 누적 토큰을 실어 보낸다(과소기록 방지).
    if (e && typeof e === 'object') {
      e.llmCalls = 2;
      e.promptTokens = first.promptTokens || 0;
      e.outputTokens = first.outputTokens || 0;
      e.tokensEstimated = !!first.tokensEstimated;
    }
    throw e;
  }
  data = extractJSON(second.content);
  if (data === undefined) {
    const preview = (second.content || '').slice(0, 200);
    const err = new Error('LLM이 유효한 JSON을 반환하지 않았습니다: ' + preview);
    err.llmCalls = 2;
    // 파싱 실패지만 두 호출 모두 실제로 이뤄졌으므로 합산 토큰을 실어 보낸다(과소기록 방지).
    err.promptTokens = (first.promptTokens || 0) + (second.promptTokens || 0);
    err.outputTokens = (first.outputTokens || 0) + (second.outputTokens || 0);
    err.tokensEstimated = !!first.tokensEstimated || !!second.tokensEstimated;
    throw err;
  }
  return {
    data, raw: second.content, durationMs: first.durationMs + second.durationMs, retried: true, calls: 2,
    promptTokens: (first.promptTokens || 0) + (second.promptTokens || 0),
    outputTokens: (first.outputTokens || 0) + (second.outputTokens || 0),
    tokensEstimated: !!first.tokensEstimated || !!second.tokensEstimated,
  };
}
