// 평가 지표 계산 + 평가 실행 오케스트레이션
// SPEC §8 계약: scoreItem / summarize / runEvaluation
import { executeStrategy } from './orchestrator.js';

/* ============================================================
   내부 유틸
   ============================================================ */

/** 안정적 고유 id (UI 비의존) */
function newId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* 무시 */ }
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** 도구 식별자 = serverId/toolName */
function toolId(step) {
  return `${step?.serverId ?? ''}/${step?.toolName ?? ''}`;
}

/** 두 시퀀스 배열 간 레벤슈타인 거리 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

/** 멀티셋(중복 포함) 교집합 크기 */
function multisetIntersection(a, b) {
  const cb = new Map();
  for (const x of b) cb.set(x, (cb.get(x) || 0) + 1);
  let inter = 0;
  const ca = new Map();
  for (const x of a) ca.set(x, (ca.get(x) || 0) + 1);
  for (const [k, n] of ca) inter += Math.min(n, cb.get(k) || 0);
  return inter;
}

/** 도메인 인지 문자열 정규화 — 역명/ID 표기 흔들림 흡수 */
function domainNorm(s) {
  let t = String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  // 라틴 영숫자 ID(예: KTX-101 / KTX 101 / KTX101)는 공백·하이픈 제거
  if (/^[a-z0-9 -]+$/.test(t)) t = t.replace(/[\s-]+/g, '');
  // 한글 역명 접미사 '역' 제거(예: 서울역 ≡ 서울) — 단, '역' 한 글자만인 값은 유지
  if (t.length > 1 && t.endsWith('역')) t = t.slice(0, -1);
  return t;
}

/** 파라미터 값 동등 비교 — 도메인 정규화, 숫자는 Number 비교 */
function paramValEq(ev, av) {
  if (typeof ev === 'boolean' || typeof av === 'boolean') return ev === av;
  if (ev && typeof ev === 'object') {
    try { return JSON.stringify(ev) === JSON.stringify(av); } catch { return false; }
  }
  if (av && typeof av === 'object') return false;
  const es = ev == null ? '' : String(ev).trim();
  const as = av == null ? '' : String(av).trim();
  const en = Number(es), an = Number(as);
  const bothNumeric = es !== '' && as !== '' && !Number.isNaN(en) && !Number.isNaN(an);
  if (bothNumeric) return en === an;
  return domainNorm(es) === domainNorm(as);
}

/** paramScore — expected[i].params가 비어있지 않은 단계만 채점 (없으면 null) */
function scoreParams(expected, actualSteps) {
  const usable = expected.filter((e) => e && e.params && Object.keys(e.params).length > 0);
  if (!usable.length) return null;
  const used = new Set();
  let total = 0;
  for (const e of usable) {
    const id = toolId(e);
    // 위치 무관, 같은 도구의 첫 미매칭 actual 호출을 짝지음
    let paired = -1;
    for (let j = 0; j < actualSteps.length; j++) {
      if (used.has(j)) continue;
      if (toolId(actualSteps[j]) === id) { paired = j; break; }
    }
    if (paired === -1) { total += 0; continue; } // 대응 호출 없음 → 0점
    used.add(paired);
    const ap = actualSteps[paired].params || {};
    const keys = Object.keys(e.params);
    let matched = 0;
    for (const k of keys) if (paramValEq(e.params[k], ap[k])) matched++;
    total += matched / keys.length;
  }
  return total / usable.length;
}

/* ============================================================
   §8 scoreItem / summarize
   ============================================================ */

/** 하나의 정답 후보에 대한 채점 (ordered=false면 순서 무관 지표 사용) */
function scoreOne(exp, act, ordered) {
  const expSeq = exp.map(toolId);
  const actSeq = act.map(toolId);

  const inter = multisetIntersection(expSeq, actSeq);

  let precision;
  if (actSeq.length === 0) precision = expSeq.length === 0 ? 1 : 0;
  else precision = inter / actSeq.length;

  let recall;
  if (expSeq.length === 0) recall = 1; // 기대가 없으면 재현 대상 없음
  else recall = inter / expSeq.length;

  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  let seqAccuracy, exactMatch;
  if (ordered === false) {
    // 순서 무관: 멀티셋 유사도(2·교집합/(|E|+|A|)), 완전일치는 멀티셋 동일성
    const denom = expSeq.length + actSeq.length;
    seqAccuracy = denom === 0 ? 1 : (2 * inter) / denom;
    exactMatch = (expSeq.length === actSeq.length && inter === expSeq.length) ? 1 : 0;
  } else {
    const dist = levenshtein(expSeq, actSeq);
    seqAccuracy = 1 - dist / Math.max(expSeq.length, actSeq.length, 1);
    exactMatch = (expSeq.length === actSeq.length && expSeq.every((v, i) => v === actSeq[i])) ? 1 : 0;
  }

  const paramScore = scoreParams(exp, act);

  return { precision, recall, f1, seqAccuracy, exactMatch, paramScore };
}

/**
 * 단일 항목 채점.
 * @param {Array<{serverId,toolName,params?}>} expected 정답 워크플로우
 * @param {Array<{serverId,toolName,...}>} actualSteps 실행 결과 steps
 * @param {{ordered?:boolean, alternatives?:Array<Array>}} [opts]
 *   ordered=false → 순서 무관 채점 · alternatives → 대안 정답들(각각 expected 형태) 중 f1 최대 채택
 * @returns {{precision,recall,f1,seqAccuracy,exactMatch,paramScore,matchedAlternative}}
 */
export function scoreItem(expected = [], actualSteps = [], opts = {}) {
  const act = Array.isArray(actualSteps) ? actualSteps : [];
  const ordered = opts.ordered !== false; // 미지정 시 순서 있음(true)
  const primary = Array.isArray(expected) ? expected : [];

  let best = scoreOne(primary, act, ordered);
  best.matchedAlternative = null; // null = 본 정답(primary) 채택

  const alts = Array.isArray(opts.alternatives) ? opts.alternatives : [];
  alts.forEach((alt, idx) => {
    if (!Array.isArray(alt) || alt.length === 0) return; // 빈 대안은 무시(실수로 넣은 빈 배열이 만점 되는 것 방지)
    const cand = scoreOne(alt, act, ordered);
    if (cand.f1 > best.f1) {
      cand.matchedAlternative = idx;
      best = cand;
    }
  });

  return best;
}

/**
 * 항목 배열 → 요약 지표.
 * @param {Array} items runEvaluation이 만든 항목들(metrics/latencyMs/llmCalls/error 포함)
 * @returns SummaryMetrics
 */
export function summarize(items = []) {
  const n = items.length;
  if (!n) {
    return {
      avgPrecision: 0, avgRecall: 0, avgF1: 0, avgSeqAccuracy: 0,
      exactMatchRate: 0, avgParamScore: null, avgLatencyMs: 0, avgLlmCalls: 0,
      errorRate: 0, hardErrorRate: 0, fallbackRate: 0, avgF1Matched: null, itemCount: 0,
    };
  }
  const mean = (fn) => items.reduce((s, it) => s + (Number(fn(it)) || 0), 0) / n;
  const paramItems = items.filter((it) => it.metrics && it.metrics.paramScore != null);
  const avgParamScore = paramItems.length
    ? paramItems.reduce((s, it) => s + it.metrics.paramScore, 0) / paramItems.length
    : null;
  // 룰 매치 항목(폴백 미사용)만의 평균 F1 — 룰 자체 성능 분리 해석용
  const matchedItems = items.filter((it) => !it.usedFallback);
  const avgF1Matched = matchedItems.length
    ? matchedItems.reduce((s, it) => s + (Number(it.metrics?.f1) || 0), 0) / matchedItems.length
    : null;

  return {
    avgPrecision: mean((it) => it.metrics?.precision),
    avgRecall: mean((it) => it.metrics?.recall),
    avgF1: mean((it) => it.metrics?.f1),
    avgSeqAccuracy: mean((it) => it.metrics?.seqAccuracy),
    exactMatchRate: mean((it) => it.metrics?.exactMatch),
    avgParamScore,
    avgLatencyMs: mean((it) => it.latencyMs),
    avgLlmCalls: mean((it) => it.llmCalls),
    // 항목 오류율: 항목 단위 오류(ok===false) 또는 단계 오류(hasStepErrors) 발생 비율(부분 오류 포함)
    errorRate: mean((it) => ((it.error || it.hasStepErrors) ? 1 : 0)),
    // 하드 오류율: 실행 자체가 실패(ok===false)한 항목만 — react처럼 단계 오류에서 회복하는 전략의 공정 비교용
    hardErrorRate: mean((it) => (it.error ? 1 : 0)),
    fallbackRate: mean((it) => (it.usedFallback ? 1 : 0)),
    avgF1Matched,
    itemCount: n,
  };
}

/* ============================================================
   저장 용량 보호용 절단
   ============================================================ */

function truncateOutput(output) {
  if (output == null) return output;
  try {
    const s = JSON.stringify(output);
    if (s && s.length > 600) return { _truncated: true, preview: s.slice(0, 600) + '…' };
    return output;
  } catch { return undefined; }
}

function truncateSteps(steps = []) {
  return steps.map((s) => ({
    serverId: s.serverId,
    toolName: s.toolName,
    params: s.params,
    output: truncateOutput(s.output),
    latencyMs: s.latencyMs,
    error: s.error,
  }));
}

/** 항목당 trace는 마지막 30개 이벤트만, detail은 500자 절단 */
function truncateTrace(trace = []) {
  return trace.slice(-30).map((ev) => ({
    ts: ev.ts,
    type: ev.type,
    label: ev.label,
    detail: ev.detail != null ? String(ev.detail).slice(0, 500) : undefined,
  }));
}

function defaultRunName() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `평가 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ============================================================
   §8 runEvaluation
   ============================================================ */

/**
 * 전략×항목 순차 실행 → EvalRun 반환(저장은 호출측 책임).
 * @param {object} o
 * @param {object} o.benchmarkSet BenchmarkSet
 * @param {Array} o.strategies Strategy[]
 * @param {Array} o.mcps McpServer[]
 * @param {string|null} [o.model] 모델 오버라이드 — 주어지면 전략 model 유무와 무관하게 모든 전략에 강제 적용
 * @param {number|null} [o.temperature] 온도 통일 — 주어지면 모든 전략의 config.temperature를 이 값으로 강제
 * @param {string} [o.name] 실행 이름
 * @param {(p:object)=>void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<object>} EvalRun
 */
export async function runEvaluation({ benchmarkSet, strategies = [], mcps = [], model = null, temperature = null, name, onProgress, signal } = {}) {
  const items = benchmarkSet?.items || [];
  const total = items.length;
  const tempOverride = (temperature != null && Number.isFinite(Number(temperature))) ? Number(temperature) : null;

  const run = {
    id: newId(),
    name: name || defaultRunName(),
    createdAt: new Date().toISOString(),
    benchmarkSetId: benchmarkSet?.id,
    benchmarkSetName: benchmarkSet?.name || '(이름 없음)',
    strategyIds: strategies.map((s) => s.id),
    status: 'running',
    model: model || null,
    temperature: tempOverride,
    perStrategy: {},
  };

  let cancelled = false;

  for (const strategy of strategies) {
    if (signal?.aborted) { cancelled = true; break; }

    // 오버라이드 적용: model이 주어지면 전략 model 유무와 무관하게 강제 교체,
    // temperature가 주어지면 config.temperature 강제 통일(공정 비교용)
    let effStrategy = strategy;
    if (model) effStrategy = { ...effStrategy, model };
    if (tempOverride != null) effStrategy = { ...effStrategy, config: { ...(effStrategy.config || {}), temperature: tempOverride } };

    const perItems = [];
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) { cancelled = true; break; }
      const item = items[i];

      onProgress?.({ strategyId: strategy.id, strategyName: strategy.name, itemIndex: i, total, phase: 'running', query: item.query });

      let actual = [], trace = [], llmCalls = 0, latencyMs = 0, error, finalAnswer;
      let hasStepErrors = false, usedFallback = false;
      try {
        const res = await executeStrategy(effStrategy, item.query, { mcps, signal });
        actual = res?.steps || [];
        trace = res?.trace || [];
        llmCalls = res?.llmCalls || 0;
        latencyMs = res?.totalLatencyMs || 0;
        finalAnswer = res?.finalAnswer;
        hasStepErrors = !!(res?.hasStepErrors || actual.some((s) => s && s.error));
        usedFallback = !!res?.usedFallback;
        if (res && res.ok === false && res.error) error = res.error;
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') { cancelled = true; break; }
        error = e?.message || String(e);
        actual = []; // 실패 항목은 actual=[]로 채점
      }

      const metrics = scoreItem(item.expected || [], actual, { ordered: item.ordered, alternatives: item.alternatives });
      perItems.push({
        itemId: item.id,
        query: item.query,
        difficulty: item.difficulty,
        category: item.category,
        expected: item.expected || [],
        actual: truncateSteps(actual),
        metrics,
        error,
        hasStepErrors,
        usedFallback,
        latencyMs,
        llmCalls,
        trace: truncateTrace(trace),
        finalAnswer: finalAnswer != null ? String(finalAnswer).slice(0, 800) : undefined,
      });

      onProgress?.({ strategyId: strategy.id, strategyName: strategy.name, itemIndex: i + 1, total, phase: 'done', query: item.query });
    }

    run.perStrategy[strategy.id] = {
      strategyName: strategy.name,
      strategyType: strategy.type,
      items: perItems,
      summary: summarize(perItems),
    };

    if (cancelled) break;
  }

  run.status = cancelled ? 'cancelled' : 'done';
  return run;
}
