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
   §6 신규 지표 헬퍼 (도구 성공률 / 목표 달성)
   ============================================================ */

/** 도구 호출 성공률 = (전체 - 실패)/전체. actual 0이면 null. 실패=해당 step.error 존재 */
function computeCallSuccessRate(actualSteps) {
  if (!actualSteps.length) return null;
  const failed = actualSteps.filter((s) => s && s.error).length;
  return (actualSteps.length - failed) / actualSteps.length;
}

/** 단일 목표 step 충족 여부: 같은 도구 id가 error 없이 호출 && (params 지정 시 매칭 ≥ 0.5) */
function isStepAchieved(target, actualSteps) {
  const targetId = toolId(target);
  // 목표도구 id가 actual에 존재 && 해당 호출 error 없음
  const matches = actualSteps.filter((s) => toolId(s) === targetId && !s.error);
  if (!matches.length) return false;
  // 목표 step에 params가 있으면, 성공 호출 중 하나라도 params 매칭 ≥ 0.5 여야 충족
  const params = target.params;
  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    const keys = Object.keys(params);
    for (const s of matches) {
      const ap = s.params || {};
      let matched = 0;
      for (const k of keys) if (paramValEq(params[k], ap[k])) matched++;
      if (matched / keys.length >= 0.5) return true;
    }
    return false;
  }
  return true;
}

/**
 * 목표 도구 달성 여부(1/0/null). null = 판정 대상 없음(N/A).
 * 채택된 gold 시퀀스(adoptedGold: primary 또는 F1 최대로 채택된 대안)로 목표 step 집합을 정한다.
 *   - ordered===false 이고 goal 미지정 → 집합 완수 모드: adoptedGold 전체가 목표(순서 무의미한 대칭 병렬을 대칭 채점, 모두 충족 시 1).
 *   - goal 유효 && goal 도구가 adoptedGold에 포함 → 목표=[goal] (primary/대안 공통 — 채택 후보에 포함될 때만 goal 사용).
 *   - 그 외(goal이 채택 gold에 없음 등) → 목표=[adoptedGold의 마지막 step].
 *   - 목표가 비면(=expected 없음) → null.
 * 각 목표 step 충족 조건: actual에 같은 도구 id 호출이 error 없이 존재 && (그 step에 params 있으면 paramMatch ≥ 0.5).
 * 집합 모드는 모든 목표 step 충족 시 1, 단일 모드는 그 step 충족 시 1, 아니면 0.
 */
function computeGoalAchieved(goal, adoptedGold, actualSteps, { ordered = true } = {}) {
  const gold = Array.isArray(adoptedGold) ? adoptedGold : [];
  const goalValid = goal && (goal.serverId || goal.toolName);

  // 목표 step 집합 결정
  let targets;
  if (ordered === false && !goalValid) {
    targets = gold; // 집합 완수 모드(순서 무의미한 대칭 병렬)
  } else if (goalValid && gold.some((s) => toolId(s) === toolId(goal))) {
    targets = [{ serverId: goal.serverId, toolName: goal.toolName, params: goal.params }];
  } else if (gold.length) {
    targets = [gold[gold.length - 1]];
  } else {
    targets = [];
  }
  if (!targets.length) return null; // 판정 대상 없음(expected/goal 없음) → N/A

  // 집합 모드: 모든 목표 step 충족해야 1 / 단일 모드: 그 step 충족 시 1
  for (const t of targets) {
    if (!isStepAchieved(t, actualSteps)) return 0;
  }
  return 1;
}

/* ============================================================
   §8 scoreItem / summarize
   ============================================================ */

/**
 * alternatives 항목 정규화 — 두 가지 형태를 모두 {steps, goal}로 통일.
 *   - 기존 배열 형태: Array<step> → { steps, goal: null } (100% 하위호환)
 *   - 신규 객체 형태: { steps: Array<step>, goal?: {serverId,toolName,params?} }
 * goal은 serverId 또는 toolName이 있을 때만 유효로 보존. 그 외 형태는 null(무시).
 */
function normalizeAlternative(alt) {
  if (Array.isArray(alt)) return { steps: alt, goal: null };
  if (alt && typeof alt === 'object' && Array.isArray(alt.steps)) {
    const g = alt.goal;
    const goal = (g && typeof g === 'object' && (g.serverId || g.toolName)) ? g : null;
    return { steps: alt.steps, goal };
  }
  return null;
}

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
 * @param {Array<{serverId,toolName,error?,...}>} actualSteps 실행 결과 steps(각 step의 error 포함)
 * @param {{ordered?:boolean, alternatives?:Array<Array|{steps:Array,goal?:object}>, goal?:{serverId,toolName,params?}}} [opts]
 *   ordered=false → 순서 무관 채점 · alternatives → 대안 정답들 중 f1 최대 채택.
 *   대안 항목은 배열(기존) 또는 {steps, goal?} 객체(신규) 형태 — matchedAlternative 인덱스 의미 불변.
 *   goal → 목표 도구 명시. 목표 결정 우선순위: ①채택 대안의 goal(유효하고 그 대안 steps에 포함)
 *   → ②item.goal(채택 후보에 포함 시) → ③기존 규칙(ordered:false&goal없음=집합완수 / 마지막 step).
 * @returns {{precision,recall,f1,seqAccuracy,exactMatch,paramScore,matchedAlternative,
 *   callSuccessRate,extraToolRate,goalAchieved,compositeScore}}
 *   goalAchieved 는 1/0/null(판정 대상 없음). compositeScore 는 null 지표를 제외하고 남은 가중치로 재정규화한 값.
 *   (inputTokens/outputTokens/totalTokens/tokensEstimated 는 오케스트레이터 결과에서 호출측이 병합)
 */
export function scoreItem(expected = [], actualSteps = [], opts = {}) {
  const act = Array.isArray(actualSteps) ? actualSteps : [];
  const ordered = opts.ordered !== false; // 미지정 시 순서 있음(true)
  const primary = Array.isArray(expected) ? expected : [];

  let best = scoreOne(primary, act, ordered);
  best.matchedAlternative = null; // null = 본 정답(primary) 채택
  let adoptedGold = primary;      // 목표 달성 판정에 쓸 "채택된 gold 시퀀스"
  let adoptedAltGoal = null;      // 채택된 대안의 자체 goal(객체 형태 대안만 보유)

  const alts = Array.isArray(opts.alternatives) ? opts.alternatives : [];
  alts.forEach((alt, idx) => {
    const norm = normalizeAlternative(alt); // 배열/객체 형태를 {steps, goal}로 정규화
    if (!norm || norm.steps.length === 0) return; // 빈 대안은 무시(실수로 넣은 빈 배열이 만점 되는 것 방지)
    const cand = scoreOne(norm.steps, act, ordered);
    if (cand.f1 > best.f1) {
      cand.matchedAlternative = idx;
      best = cand;
      adoptedGold = norm.steps;
      adoptedAltGoal = norm.goal;
    }
  });

  // §6 신규 지표 — 채택된(F1 최대) 후보 기준으로 일관되게 계산(대안 채택 시 그 대안 기준)
  best.callSuccessRate = computeCallSuccessRate(act);
  best.extraToolRate = act.length === 0 ? 0 : (1 - best.precision); // 잉여 도구 호출 비율(=1-정밀도)
  // 목표 결정 우선순위: ①채택 대안의 goal(유효하고 그 대안 steps에 포함) → ②item.goal(채택 후보에
  // 포함 시 — computeGoalAchieved 내부 규칙) → ③기존 규칙(집합완수/마지막 step).
  let effectiveGoal = opts.goal;
  if (best.matchedAlternative != null && adoptedAltGoal
      && adoptedGold.some((s) => toolId(s) === toolId(adoptedAltGoal))) {
    effectiveGoal = adoptedAltGoal;
  }
  best.goalAchieved = computeGoalAchieved(effectiveGoal, adoptedGold, act, { ordered });
  // 품질 종합점수(토큰 무관, [0,1]): f1 0.4 · 목표달성 0.3 · 도구성공률 0.15 · 파라미터 0.15의 가중평균.
  // N/A(null) 항목은 제외하고 남은 가중치로 재정규화(무호출/N/A 편향 제거). f1은 항상 존재.
  const terms = [
    { w: 0.4, v: best.f1 },
    { w: 0.3, v: best.goalAchieved },
    { w: 0.15, v: best.callSuccessRate },
    { w: 0.15, v: best.paramScore },
  ];
  let sw = 0, acc = 0;
  for (const t of terms) {
    if (t.v != null) { sw += t.w; acc += t.w * t.v; }
  }
  best.compositeScore = sw > 0 ? acc / sw : 0;

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
      // §6 신규
      avgCallSuccessRate: null, avgExtraToolRate: 0, goalAchievementRate: null,
      avgInputTokens: 0, avgOutputTokens: 0, avgTotalTokens: 0, totalTokens: 0,
      anyTokensEstimated: false, avgComposite: 0,
      ctxOverflowCount: 0, retrievalFallbackCount: 0,
    };
  }
  const mean = (fn) => items.reduce((s, it) => s + (Number(fn(it)) || 0), 0) / n;
  const sum = (fn) => items.reduce((s, it) => s + (Number(fn(it)) || 0), 0);
  const paramItems = items.filter((it) => it.metrics && it.metrics.paramScore != null);
  const avgParamScore = paramItems.length
    ? paramItems.reduce((s, it) => s + it.metrics.paramScore, 0) / paramItems.length
    : null;
  // 룰 매치 항목(폴백 미사용)만의 평균 F1 — 룰 자체 성능 분리 해석용
  const matchedItems = items.filter((it) => !it.usedFallback);
  const avgF1Matched = matchedItems.length
    ? matchedItems.reduce((s, it) => s + (Number(it.metrics?.f1) || 0), 0) / matchedItems.length
    : null;
  // 도구 성공률: actual 0(호출 없음) 항목은 null이므로 평균에서 제외
  const csrItems = items.filter((it) => it.metrics && it.metrics.callSuccessRate != null);
  const avgCallSuccessRate = csrItems.length
    ? csrItems.reduce((s, it) => s + it.metrics.callSuccessRate, 0) / csrItems.length
    : null;
  // 목표 달성률: goalAchieved가 null(N/A)인 항목은 평균에서 제외(avgCallSuccessRate와 동일 정책)
  const goalItems = items.filter((it) => it.metrics && it.metrics.goalAchieved != null);
  const goalAchievementRate = goalItems.length
    ? goalItems.reduce((s, it) => s + it.metrics.goalAchieved, 0) / goalItems.length
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
    // §6 신규 요약 지표
    avgCallSuccessRate,
    avgExtraToolRate: mean((it) => it.metrics?.extraToolRate),
    goalAchievementRate,
    avgInputTokens: mean((it) => it.metrics?.inputTokens),
    avgOutputTokens: mean((it) => it.metrics?.outputTokens),
    avgTotalTokens: mean((it) => it.metrics?.totalTokens),
    totalTokens: sum((it) => it.metrics?.totalTokens),
    anyTokensEstimated: items.some((it) => it.metrics && it.metrics.tokensEstimated),
    avgComposite: mean((it) => it.metrics?.compositeScore),
    // 신뢰도 카운트: ctxOverflow=true 항목 수 / retrievalFallback 비null 항목 수
    ctxOverflowCount: items.filter((it) => it.metrics && it.metrics.ctxOverflow).length,
    retrievalFallbackCount: items.filter((it) => it.metrics && it.metrics.retrievalFallback != null).length,
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
 * @param {number|null} [o.maxSteps] maxSteps 통일 — 유한 양수이면 prompt/db 전략의 config.maxSteps를
 *   실행용 클론에서 이 값으로 오버라이드(원본 전략 무변경). 미지정 시 기존 동작.
 * @param {string} [o.name] 실행 이름
 * @param {(p:object)=>void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<object>} EvalRun
 */
export async function runEvaluation({ benchmarkSet, strategies = [], mcps = [], model = null, temperature = null, maxSteps = null, name, onProgress, signal } = {}) {
  const items = benchmarkSet?.items || [];
  const total = items.length;
  const tempOverride = (temperature != null && Number.isFinite(Number(temperature))) ? Number(temperature) : null;
  // maxSteps 통일: 유한 양수만 유효 — prompt/db 전략에만 적용(rule/skill은 단계 상한 개념이 다름)
  const maxStepsOverride = (maxSteps != null && Number.isFinite(Number(maxSteps)) && Number(maxSteps) > 0)
    ? Number(maxSteps) : null;

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
    maxSteps: maxStepsOverride,
    perStrategy: {},
  };

  let cancelled = false;

  for (const strategy of strategies) {
    if (signal?.aborted) { cancelled = true; break; }

    // 오버라이드 적용: model이 주어지면 전략 model 유무와 무관하게 강제 교체,
    // temperature가 주어지면 config.temperature 강제 통일(공정 비교용),
    // maxSteps가 주어지면 prompt/db 전략의 config.maxSteps 강제 통일(실행용 클론 — 원본 무변경)
    let effStrategy = strategy;
    if (model) effStrategy = { ...effStrategy, model };
    if (tempOverride != null) effStrategy = { ...effStrategy, config: { ...(effStrategy.config || {}), temperature: tempOverride } };
    if (maxStepsOverride != null && (strategy.type === 'prompt' || strategy.type === 'db')) {
      effStrategy = { ...effStrategy, config: { ...(effStrategy.config || {}), maxSteps: maxStepsOverride } };
    }

    const perItems = [];
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) { cancelled = true; break; }
      const item = items[i];

      onProgress?.({ strategyId: strategy.id, strategyName: strategy.name, itemIndex: i, total, phase: 'running', query: item.query });

      let actual = [], trace = [], llmCalls = 0, latencyMs = 0, error, finalAnswer;
      let hasStepErrors = false, usedFallback = false;
      let inputTokens = 0, outputTokens = 0, tokensEstimated = false;
      let ctxOverflow = false, retrievalFallback = null; // 신뢰도 플래그(res에 없으면 기본값 유지)
      try {
        const res = await executeStrategy(effStrategy, item.query, { mcps, signal });
        actual = res?.steps || [];
        trace = res?.trace || [];
        llmCalls = res?.llmCalls || 0;
        latencyMs = res?.totalLatencyMs || 0;
        finalAnswer = res?.finalAnswer;
        hasStepErrors = !!(res?.hasStepErrors || actual.some((s) => s && s.error));
        usedFallback = !!res?.usedFallback;
        // 토큰 계측(오케스트레이터 result에서). scoreItem은 토큰을 모르므로 여기서 metrics에 병합한다.
        inputTokens = res?.inputTokens || 0;
        outputTokens = res?.outputTokens || 0;
        tokensEstimated = !!res?.tokensEstimated;
        // 신뢰도 플래그: 컨텍스트 초과(카탈로그가 numCtx를 넘어 잘렸을 가능성)·검색 폴백 사유
        ctxOverflow = !!res?.ctxOverflow;
        retrievalFallback = res?.retrievalFallback ?? null;
        if (res && res.ok === false && res.error) error = res.error;
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') { cancelled = true; break; }
        error = e?.message || String(e);
        actual = []; // 실패 항목은 actual=[]로 채점
      }

      // actual step의 error를 보존한 채로 채점(도구 성공률·목표 달성 판정에 필요).
      const metrics = scoreItem(item.expected || [], actual, {
        ordered: item.ordered,
        alternatives: item.alternatives,
        goal: item.goal,
      });
      // §6 토큰 지표를 metrics에 기록
      metrics.inputTokens = inputTokens;
      metrics.outputTokens = outputTokens;
      metrics.totalTokens = inputTokens + outputTokens;
      metrics.tokensEstimated = tokensEstimated;
      // 신뢰도 플래그를 metrics에 기록(res에 필드가 없으면 false/null)
      metrics.ctxOverflow = ctxOverflow;
      metrics.retrievalFallback = retrievalFallback;
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
  // 전략 간 상대 정규화(토큰효율)와 헤드라인 종합점수를 각 perStrategy.summary에 주입.
  finalizeScores(run);
  return run;
}

/**
 * run 레벨 후처리 — 전략 간 avgTotalTokens를 "가장 적은 전략 대비 비율"로 환산해 각 perStrategy.summary에
 * `tokenEfficiency`(minPos/avg, [0,1]; 토큰 0 전략·단일/동일 전략이면 1)와
 * `orchestrationScore`(0.85·avgComposite + 0.15·tokenEfficiency)를 주입한다.
 * (min-max 대신 비율 기반 — 이상치가 나머지를 0으로 뭉개지 않고 소폭 차이는 1에 근접. 여러 전략을 함께 평가할 때만 상대적이므로 runEvaluation 종료 후 호출)
 * @param {object} run EvalRun (perStrategy.*.summary 를 in-place 갱신)
 * @returns {object} run
 */
export function finalizeScores(run) {
  const strategies = (run && run.perStrategy) ? Object.values(run.perStrategy) : [];
  if (!strategies.length) return run;

  // 양수 토큰 전략들 중 최소값(minPos)을 기준으로 비율화. 토큰 정보가 없으면 minPos=0.
  const avgs = strategies.map((s) => Number(s.summary?.avgTotalTokens) || 0);
  const pos = avgs.filter((x) => x > 0);
  const minPos = pos.length ? Math.min(...pos) : 0;

  for (const s of strategies) {
    const summary = s.summary || (s.summary = {});
    const a = Number(summary.avgTotalTokens) || 0;
    // 토큰 0(계측 없음) 전략은 1, 그 외에는 최소 전략 대비 비율(단일/동일 전략이면 자기 자신이 최소 → 1)
    const eff = a <= 0 ? 1 : (minPos > 0 ? Math.max(0, Math.min(1, minPos / a)) : 1);
    summary.tokenEfficiency = eff;
    summary.orchestrationScore = 0.85 * (Number(summary.avgComposite) || 0) + 0.15 * eff;
  }
  return run;
}
