// Ollama 로컬 LLM 클라이언트 — 모든 LLM 호출은 이 모듈을 경유
import { store } from '../core/store.js';

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

/** 연결 확인: {ok, version?, error?} */
export async function checkConnection(timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(getOllamaUrl() + '/api/version', { signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, version: data.version };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '응답 시간 초과' : (e.message || '연결 실패') };
  } finally {
    clearTimeout(timer);
  }
}

/** 설치된 모델 목록: [{name, sizeGB, family, paramSize}] */
export async function listModels() {
  const res = await fetch(getOllamaUrl() + '/api/tags');
  if (!res.ok) throw new Error(`모델 목록 조회 실패 (HTTP ${res.status})`);
  const data = await res.json();
  return (data.models || [])
    .filter(m => !/bge|embed/i.test(m.name)) // 임베딩 모델 제외
    .map(m => ({
      name: m.name,
      sizeGB: m.size ? (m.size / 1e9).toFixed(1) : '?',
      family: m.details?.family || '',
      paramSize: m.details?.parameter_size || '',
    }));
}

/**
 * 채팅 완성 호출 (stream: false)
 * @param {{model?, messages, temperature?, format?, signal?}} opts
 * @returns {Promise<{content, durationMs, model}>}
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

  let res;
  try {
    res = await fetch(getOllamaUrl() + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`Ollama 서버에 연결할 수 없습니다 (${getOllamaUrl()}). Ollama 실행 여부와 OLLAMA_ORIGINS 설정을 확인하세요.`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch { /* 무시 */ }
    throw new Error(`LLM 호출 실패 (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  return {
    content: data.message?.content ?? '',
    durationMs: performance.now() - t0,
    model: useModel,
  };
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
 * @returns {Promise<{data, raw, durationMs, retried, calls}>} calls: 실제 LLM 호출 횟수(1 또는 2)
 */
export async function chatJSON({ model, messages, temperature = 0.1, signal } = {}) {
  // 실패 시에도 시도한 호출 수를 오류 객체에 실어(e.llmCalls) 호출측이 집계할 수 있게 한다
  let first;
  try {
    first = await chat({ model, messages, temperature, format: 'json', signal });
  } catch (e) {
    if (e && typeof e === 'object') e.llmCalls = 1;
    throw e;
  }
  let data = extractJSON(first.content);
  if (data !== undefined) return { data, raw: first.content, durationMs: first.durationMs, retried: false, calls: 1 };

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
    if (e && typeof e === 'object') e.llmCalls = 2;
    throw e;
  }
  data = extractJSON(second.content);
  if (data === undefined) {
    const preview = (second.content || '').slice(0, 200);
    const err = new Error('LLM이 유효한 JSON을 반환하지 않았습니다: ' + preview);
    err.llmCalls = 2;
    throw err;
  }
  return { data, raw: second.content, durationMs: first.durationMs + second.durationMs, retried: true, calls: 2 };
}
