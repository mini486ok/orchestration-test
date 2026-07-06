// 평가 · 비교 — (A) 실행 설정 → (B) 진행 → (C) 결과(리더보드/차트/상세)
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import {
  el, badge, fmt, toast, modal, confirmDialog, segmented,
  emptyState, spinner, workflowChips,
} from '../core/ui.js';
import { groupedBarChart, radarChart, hBarChart, SERIES_COLORS } from '../core/charts.js';
import { runEvaluation } from '../services/evaluator.js';
import { checkConnection, listModels, getNumCtx, getDefaultModel } from '../services/ollama.js';
// 사전 점검(preflight)용 — estimateCatalogTokens는 구버전 orchestrator에 없을 수 있어
// 네임스페이스 import 후 존재 여부를 가드한다(부재 시 해당 점검만 조용히 스킵).
import * as orchestratorMod from '../services/orchestrator.js';
import { indexStatus } from '../services/catalogIndex.js';
import { graphStatus } from '../services/catalogGraph.js';

/* ---------- 공통 헬퍼 ---------- */
const TYPE_LABEL = { prompt: '프롬프트', skill: '스킬', rule: '룰', db: 'DB' };
const TYPE_KIND = { prompt: 'violet', skill: 'blue', rule: 'amber', db: 'green' };
const DIFF_LABEL = { easy: '쉬움', medium: '보통', hard: '어려움' };
const DIFF_KIND = { easy: 'green', medium: 'amber', hard: 'red' };
const STATUS_LABEL = { running: '실행 중', done: '완료', cancelled: '중단됨', error: '오류' };
const STATUS_KIND = { running: 'blue', done: 'green', cancelled: 'amber', error: 'red' };

/** 리더보드 정렬 기준 (asc=오름차순) — 기본은 종합점수 내림차순 */
const SORT_OPTS = [
  { key: 'orchestrationScore', label: '종합점수', asc: false },
  { key: 'avgComposite', label: '품질점수', asc: false },
  { key: 'avgF1', label: 'F1', asc: false },
  { key: 'goalAchievementRate', label: '목표달성률', asc: false },
  { key: 'avgCallSuccessRate', label: '도구성공률', asc: false },
  { key: 'avgExtraToolRate', label: '잉여호출률(오름차순)', asc: true },
  { key: 'avgPrecision', label: 'Precision', asc: false },
  { key: 'avgRecall', label: 'Recall', asc: false },
  { key: 'avgRetrievalRecall', label: '검색 리콜', asc: false },
  { key: 'avgSeqAccuracy', label: '시퀀스', asc: false },
  { key: 'exactMatchRate', label: '완전일치', asc: false },
  { key: 'avgParamScore', label: '파라미터', asc: false },
  { key: 'avgTotalTokens', label: '평균 총토큰(오름차순)', asc: true },
  { key: 'avgLatencyMs', label: '평균 지연(오름차순)', asc: true },
];

/**
 * 지표 사전 — 컬럼 헤더 hover(title) 툴팁 + 용어집 패널 공용.
 * dir: 'up'=높을수록 좋음, 'down'=낮을수록 좋음.
 */
const METRIC_INFO = {
  orchestrationScore: {
    name: '오케스트레이션 종합점수', dir: 'up',
    meaning: '전략의 최종 순위를 정하는 헤드라인 점수. 워크플로우 품질과 토큰 효율을 함께 반영합니다. 토큰효율이 상대 지표라 동일 run(실행) 내에서만 비교되는 점수입니다(run 간 비교 불가).',
    formula: '0.85 × 품질점수 + 0.15 × 토큰효율',
  },
  compositeScore: {
    name: '품질점수(종합 품질)', dir: 'up',
    meaning: '토큰을 빼고 오직 워크플로우가 얼마나 정확했는지만 본 점수입니다. 구성 지표가 N/A(예: 도구 미호출·목표 특정 불가)이면 그 가중치를 제외하고 남은 가중치로 재정규화합니다.',
    formula: '0.4 × F1 + 0.3 × 목표달성 + 0.15 × 도구성공률 + 0.15 × 파라미터정확도 (N/A 항목은 가중치 제외 후 재정규화)',
  },
  tokenEfficiency: {
    name: '토큰 효율', dir: 'up',
    meaning: '함께 평가한 전략들 중 토큰을 적게 쓸수록 높은 비율 기반 상대 지표입니다. 가장 적게 쓴 전략이 1이고, 그 전략 대비 토큰을 많이 쓸수록 낮아집니다. 함께 평가한 전략 집합에 상대적이라 run 간 비교는 불가하며, 단일 전략만 평가하면 1입니다.',
    formula: '가장 적은 평균총토큰 / 이 전략의 평균총토큰 (최소·단일 전략 = 1)',
  },
  f1: {
    name: 'F1 점수', dir: 'up',
    meaning: '호출한 도구 집합이 정답 도구 집합과 얼마나 겹치는지의 종합 점수(정밀도와 재현율의 조화평균).',
    formula: '2 × 정밀도 × 재현율 / (정밀도 + 재현율)',
  },
  precision: {
    name: '정밀도(Precision)', dir: 'up',
    meaning: '내가 호출한 도구 중 실제로 정답에 있던 도구의 비율. 낮으면 쓸데없는 도구를 많이 불렀다는 뜻.',
    formula: '정답에 포함된 호출 수 / 전체 호출 수',
  },
  recall: {
    name: '재현율(Recall)', dir: 'up',
    meaning: '정답 도구 중 내가 실제로 호출한 비율. 낮으면 필요한 도구를 빠뜨렸다는 뜻.',
    formula: '호출한 정답 도구 수 / 전체 정답 도구 수',
  },
  seqAccuracy: {
    name: '시퀀스 정확도', dir: 'up',
    meaning: '도구를 부른 순서가 기대 순서와 얼마나 맞는지. 순서가 중요한 워크플로우에서 의미가 큽니다.',
    formula: '정답 순서와 일치하는 최장 공통 부분수열 기반 비율',
  },
  exactMatch: {
    name: '완전일치율', dir: 'up',
    meaning: '기대 워크플로우와 도구·순서가 완전히 똑같이 실행된 문항의 비율.',
    formula: '완전히 일치한 문항 수 / 전체 문항 수',
  },
  paramScore: {
    name: '파라미터 정확도', dir: 'up',
    meaning: '도구를 부를 때 넘긴 인자(from·date 등)가 정답 파라미터와 얼마나 일치하는지. 도구는 맞아도 인자가 틀리면 낮아집니다.',
    formula: '일치한 파라미터 키·값 비율의 평균',
  },
  goalAchieved: {
    name: '목표 달성률', dir: 'up',
    meaning: '기대 워크플로우의 최종(목표) 도구를 오류 없이 호출한 문항의 비율입니다(파라미터가 지정된 경우 절반 이상 일치해야 인정). "일을 실제로 끝냈는가"를 봅니다. 단, 순서 무관(ordered:false) 항목에서 목표를 지정하지 않으면 정답 도구 전부를 오류 없이 호출해야 달성으로 인정합니다(집합 완수). 목표를 특정할 수 없는 문항은 N/A로 제외합니다.',
    formula: '목표도구를 오류 없이·파라미터 매칭≥0.5로 부른 문항 / 목표를 특정할 수 있는 문항 (순서 무관·목표 미지정 시 정답 도구 전부 완수)',
  },
  callSuccessRate: {
    name: '도구 호출 성공률', dir: 'up',
    meaning: '호출한 도구 중 입력 스키마 검증·실행에 성공한 비율. 낮으면 파라미터를 잘못 만들어 호출이 실패했다는 뜻.',
    formula: '(전체 호출 − 실패 호출) / 전체 호출',
  },
  extraToolRate: {
    name: '잉여 도구 호출률', dir: 'down',
    meaning: '정답에 없는 불필요한 도구를 부른 비율. 정밀도의 반대 개념입니다.',
    formula: '1 − 정밀도',
  },
  inputTokens: {
    name: '입력 토큰', dir: 'down',
    meaning: 'LLM에 보낸 프롬프트의 토큰 수. 프롬프트·컨텍스트가 길수록 큽니다. "≈"는 서버가 실측값을 주지 않아 글자수로 추정한 값.',
    formula: 'prompt_eval_count 합(없으면 글자수/2.2 추정)',
  },
  outputTokens: {
    name: '출력 토큰', dir: 'down',
    meaning: 'LLM이 생성한 응답의 토큰 수.',
    formula: 'eval_count 합(없으면 글자수/2.2 추정)',
  },
  totalTokens: {
    name: '총 토큰(평균)', dir: 'down',
    meaning: '문항당 입력+출력 토큰의 평균. 적을수록 비용·지연이 낮습니다.',
    formula: '평균 입력 토큰 + 평균 출력 토큰',
  },
  avgLatencyMs: {
    name: '평균 지연', dir: 'down',
    meaning: '문항 1개를 처리하는 데 걸린 평균 시간.',
    formula: '문항별 실행 시간의 평균',
  },
  avgLlmCalls: {
    name: 'LLM 호출 수', dir: 'down',
    meaning: '문항당 평균 LLM 호출 횟수. 많을수록 반복 추론(react류)이 많다는 뜻.',
    formula: '문항별 LLM 호출 횟수의 평균',
  },
  errorRate: {
    name: '오류율', dir: 'down',
    meaning: '부분 오류까지 포함한 실패 비율. react류는 단계 오류에서 회복할 수 있어 실행 실패율과 함께 봐야 합니다.',
    formula: '오류가 있었던 문항(단계 포함) / 전체 문항',
  },
  retrievalRecall: {
    name: '검색 리콜(retrievalRecall)', dir: 'up',
    meaning: 'DB/검색 전략에서 정답 도구가 검색 후보에 포함된 비율입니다. 낮으면 검색 단계 실패(정답 도구가 후보에서 누락), 검색 리콜은 높은데 F1이 낮으면 플래너 실패로 구분해 해석합니다. 전체 카탈로그를 주입하는 전략은 검색 단계가 없어 N/A(-)입니다.',
    formula: '검색 후보에 포함된 정답 도구 수 / 정답 도구 수 — 검색 기록(retrievedTools)이 있는 문항만 평균, 전체 주입·기록 없음은 제외 · 다중정답 후보(primary·alternatives) 중 최대 커버리지(채택 정답과 다를 수 있음 — 완전한 정답 경로가 후보에 존재했는지의 기회 상한)',
  },
  goalRetrieved: {
    name: '목표 도구 검색 여부(goalRetrieved)', dir: 'up',
    meaning: '검색 기록(retrievedTools)이 있는 문항에서 목표(최종) 도구가 검색 후보에 포함됐는지입니다. false면 검색 단계에서 목표 도구가 통째로 누락된 것으로, 플래너가 아무리 잘해도 목표 달성이 불가능합니다 — 검색 리콜과 함께 검색 실패/플래너 실패를 구분하는 데 사용합니다. 검색 기록이 없는 문항은 N/A(null)입니다.',
    formula: '목표 후보(item.goal 또는 각 정답 경로의 마지막 단계) 중 하나라도 검색 후보에 포함되면 true · 기록 없으면 null — 리더보드 검색 리콜 title에 미검색(goalRetrieved=false) 문항 수 병기',
  },
  ctxOverflowCount: {
    name: '컨텍스트 초과 문항 수(⚠ctx)', dir: 'down',
    meaning: '프롬프트가 numCtx를 넘어 잘렸을 가능성이 있는 문항 수입니다. 카탈로그·컨텍스트가 잘린 채 실행되므로 해당 전략의 점수는 신뢰할 수 없습니다. numCtx 상향 또는 DB(검색) 전략 사용을 권장합니다. numCtx가 다른 run 간에는 이 수치를 비교할 수 없습니다.',
    formula: 'ctxOverflow=true 문항 수 (프롬프트 전체 추정(chars/2.2) > numCtx 또는 실측 promptTokens ≥ numCtx×0.98)',
  },
  retrievalFallbackCount: {
    name: '검색 폴백 문항 수(⚠폴백)', dir: 'down',
    meaning: 'DB 전략이 의도한 검색이 아닌 폴백으로 실행된 문항 수입니다(예: graph→vector, vector→keyword, 검색 0건→전체 카탈로그). 전략 설계 의도와 다른 조건에서 측정된 점수임을 뜻합니다. numCtx가 다른 run 간에는 이 수치를 비교할 수 없습니다.',
    formula: 'retrievalFallback ≠ null 문항 수',
  },
  catalogCompressedCount: {
    name: '카탈로그 축약 문항 수(축약 L{max}×N)', dir: 'down',
    meaning: '컨텍스트 예산에 맞춰 도구 카탈로그가 자동 축약된 채 실행된 문항 수입니다. 서버·도구는 전부 유지되고 파라미터·설명 상세도만 단계적으로(L1~L4) 낮아집니다 — ⚠와 달리 오류가 아닌 조건 표시입니다. 적용 레벨은 문항 상세의 "축약 L{n}" 뱃지·트레이스에서 확인하며, numCtx를 높이면 상세도가 올라갑니다. numCtx가 다른 run 간에는 이 수치를 비교할 수 없습니다.',
    formula: 'catalogDetail > 0 문항 수 (L{max}=해당 전략 문항들의 최대 축약 레벨)',
  },
};

/** 방향 설명 텍스트 */
function dirText(dir) { return dir === 'up' ? '높을수록 좋음' : '낮을수록 좋음'; }

/** 컬럼 헤더 hover 툴팁 문자열 (title 속성) */
function infoTitle(key) {
  const i = METRIC_INFO[key];
  if (!i) return '';
  return `${i.name} — ${i.meaning}\n계산식: ${i.formula}\n(${dirText(i.dir)})`;
}

/** 설명 툴팁이 붙은 표 헤더 셀 */
function thHelp(label, key) { return el('th', { class: 'th-help', title: infoTitle(key) }, label); }

/** 토큰 수 포맷(정수·천단위 구분). null이면 '-' */
function fmtTok(v) { return v == null ? '-' : Math.round(v).toLocaleString('ko-KR'); }

/** 비율(0~1) 포맷 — null/NaN이면 '-'(N/A). goalAchievementRate 등 목표 특정 불가로 N/A 가능한 지표용 */
function fmtRate(v) { return (v == null || Number.isNaN(v)) ? '-' : fmt.pct(v); }

/** 평가 화면 확장 스타일 1회 주입 (main.css는 수정하지 않음) */
function injectEvalStyles() {
  if (document.getElementById('rbtl-eval-ext')) return;
  const style = el('style', { id: 'rbtl-eval-ext' });
  style.textContent = `
/* 평가 화면 확장 — 용어집/헤더 툴팁/토큰 (main.css 미수정, 1회 주입) */
.tbl th.th-help { cursor: help; text-decoration: underline dotted var(--tx3); text-underline-offset: 3px; white-space: nowrap; }
.tok-cell { display: inline-flex; align-items: center; gap: 4px; justify-content: flex-end; }
.tok-cell .tok-est { color: var(--sig-amber); font-weight: 600; }
.eval-glossary > summary { list-style: none; cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; padding: 2px 0; user-select: none; }
.eval-glossary > summary::-webkit-details-marker { display: none; }
.eval-glossary > summary::before { content: '▸'; color: var(--sig-green); font-size: 12px; display: inline-block; transition: transform .15s; }
.eval-glossary[open] > summary::before { transform: rotate(90deg); }
.eval-glossary .gl-summary-title { font-size: 14px; font-weight: 600; color: var(--tx0); }
.eval-glossary .gl-summary-hint { font-size: 11.5px; color: var(--tx2); }
.eval-glossary .gl-body { margin-top: 14px; display: flex; flex-direction: column; gap: 16px; }
.eval-glossary .gl-hero { background: var(--sig-green-dim); border: 1px solid rgba(49,208,124,.28); border-radius: var(--r2); padding: 14px 16px; }
.eval-glossary .gl-hero-title { font-size: 12.5px; font-weight: 600; color: var(--tx0); margin-bottom: 8px; }
.eval-glossary .gl-hero-formula { font-family: var(--font-mono); font-size: 13px; color: var(--tx0); line-height: 1.5; overflow-x: auto; }
.eval-glossary .gl-hero-formula b { color: var(--sig-green); font-weight: 600; }
.eval-glossary .gl-hero-note { font-size: 11.5px; color: var(--tx2); margin-top: 10px; line-height: 1.5; }
.eval-glossary .gl-section-title { font-size: 11px; letter-spacing: .12em; color: var(--tx3); font-family: var(--font-mono); margin-bottom: 8px; text-transform: uppercase; }
.eval-glossary .gl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.eval-glossary .gl-item { background: var(--bg0); border: 1px solid var(--line-soft); border-radius: var(--r1); padding: 11px 13px; }
.eval-glossary .gl-name { font-size: 13px; font-weight: 600; color: var(--tx0); }
.eval-glossary .gl-mean { font-size: 12px; color: var(--tx1); line-height: 1.55; margin-top: 5px; }
.eval-glossary .gl-formula { font-family: var(--font-mono); font-size: 11px; color: var(--tx2); background: var(--bg2); border: 1px solid var(--line-soft); border-radius: 4px; padding: 5px 7px; margin-top: 7px; overflow-x: auto; white-space: nowrap; }
.eval-glossary .gl-dir { display: inline-block; font-size: 11px; font-weight: 600; margin-top: 7px; }
.eval-glossary .gl-dir.up { color: var(--sig-green); }
.eval-glossary .gl-dir.down { color: var(--sig-amber); }
/* 사전 점검(preflight) 패널 — 비차단 amber 경고 */
.eval-preflight { margin-top: 12px; display: flex; gap: 10px; align-items: flex-start; background: var(--sig-amber-dim); border: 1px solid rgba(244,182,63,.28); border-radius: var(--r2); padding: 12px 14px; font-size: 12.5px; color: var(--tx1); line-height: 1.55; }
.eval-preflight .pf-title { font-weight: 600; color: var(--tx0); }
.eval-preflight ul { margin: 5px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.eval-preflight li::marker { color: var(--sig-amber); }
/* 항목별 상세 필터 바 */
.eval-detail-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.eval-detail-filters .select, .eval-detail-filters .input { width: auto; }
.eval-detail-filters .df-count { font-size: 11.5px; color: var(--tx2); font-family: var(--font-mono); }
`;
  document.head.appendChild(style);
}

function typeBadge(type) { return badge(TYPE_LABEL[type] || type || '?', TYPE_KIND[type] || 'dim'); }

/** LLM을 사용하는 전략인지 (db 전략도 검색 후 plan/react 플래너로 LLM 호출) */
function usesLLM(s) {
  if (!s) return false;
  if (s.type === 'prompt' || s.type === 'skill' || s.type === 'db') return true;
  if (s.type === 'rule') return s.config?.onNoMatch === 'llmFallback';
  return false;
}

function defaultRunName() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `평가 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 난이도 분포 문자열 (쉬움 3 · 보통 2 …) */
function difficultyDist(items = []) {
  const c = { easy: 0, medium: 0, hard: 0 };
  for (const it of items) if (c[it.difficulty] !== undefined) c[it.difficulty]++;
  return ['easy', 'medium', 'hard'].filter((k) => c[k] > 0).map((k) => `${DIFF_LABEL[k]} ${c[k]}`).join(' · ') || '난이도 정보 없음';
}

/** 멀티셋 기반 diff 마크(위치 무관) — {expMarks, actMarks} */
function diffMarks(expected = [], actual = []) {
  const expIds = expected.map((e) => `${e.serverId}/${e.toolName}`);
  const actIds = actual.map((a) => `${a.serverId}/${a.toolName}`);
  const actAvail = new Map();
  for (const id of actIds) actAvail.set(id, (actAvail.get(id) || 0) + 1);
  const expMarks = expIds.map((id) => {
    if (actAvail.get(id) > 0) { actAvail.set(id, actAvail.get(id) - 1); return ''; }
    return 'miss';
  });
  const expAvail = new Map();
  for (const id of expIds) expAvail.set(id, (expAvail.get(id) || 0) + 1);
  const actMarks = actIds.map((id) => {
    if (expAvail.get(id) > 0) { expAvail.set(id, expAvail.get(id) - 1); return ''; }
    return 'extra';
  });
  return { expMarks, actMarks };
}

/** 정렬된 전략 배열(리더보드=F1 내림차순) — 색상/순서 통일용 */
function orderedStrategies(run) {
  const list = (run.strategyIds || [])
    .map((id) => ({ id, ...(run.perStrategy?.[id] || {}) }))
    .filter((s) => s.summary);
  list.sort((a, b) => (b.summary.avgF1 || 0) - (a.summary.avgF1 || 0));
  return list;
}

/* ============================================================
   진입점
   ============================================================ */
export async function render(container, ctx) {
  injectEvalStyles();
  const mcps = store.get('mcps') || [];

  const runId = ctx?.params?.runId;
  if (runId) {
    const runs = store.get('runs') || [];
    const run = runs.find((r) => r.id === runId);
    if (run) { container.replaceChildren(buildResults(run)); return; }
    toast('저장된 평가 실행을 찾을 수 없습니다.', 'warn');
  }
  showSetup();

  /* ---------- 화면 전환 ---------- */
  function showSetup() { container.replaceChildren(buildSetup()); }

  /* ============================================================
     (A) 실행 설정
     ============================================================ */
  function buildSetup() {
    const benchmarks = store.get('benchmarks') || [];
    const strategies = store.get('strategies') || [];
    const runs = store.get('runs') || [];

    if (!benchmarks.length || !strategies.length) {
      return el('div', {},
        emptyState({
          icon: '🏁',
          title: '평가를 시작할 준비가 필요합니다',
          desc: !benchmarks.length
            ? '먼저 벤치마크 세트를 만들어야 합니다. 벤치마크 랩에서 자동/수동으로 항목을 생성하세요.'
            : '평가할 오케스트레이션 전략이 없습니다. 오케스트레이션 스튜디오에서 전략을 먼저 설계하세요.',
          action: { label: !benchmarks.length ? '벤치마크 랩으로' : '오케스트레이션으로', onClick: () => router.navigate(!benchmarks.length ? '/benchmarks' : '/orchestration') },
        }),
        runs.length ? el('div', { style: { marginTop: '18px' } }, buildHistory(runs)) : null);
    }

    let selectedSetId = benchmarks[0]?.id || null;
    const selectedStrategyIds = new Set();

    /* 좌: 벤치마크 세트 라디오 리스트 */
    const setList = el('div', { class: 'pick-list' });
    function renderSetList() {
      setList.replaceChildren(...benchmarks.map((b) => {
        const on = b.id === selectedSetId;
        return el('label', { class: 'pick' + (on ? ' on' : '') },
          el('input', { type: 'radio', name: 'benchset', checked: on, onchange: () => { selectedSetId = b.id; renderSetList(); updateScale(); } }),
          el('div', { class: 'pick-main' },
            el('div', { class: 'pick-name' }, b.name),
            el('div', { class: 'pick-sub' }, `${b.items?.length || 0}개 항목 · ${difficultyDist(b.items)}`)));
      }));
    }
    renderSetList();

    /* 우: 전략 다중 선택 체크박스 리스트 */
    const stratList = el('div', { class: 'pick-list' });
    const sortedStrats = [...strategies].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    function renderStratList() {
      stratList.replaceChildren(...sortedStrats.map((s) => {
        const on = selectedStrategyIds.has(s.id);
        return el('label', { class: 'pick' + (on ? ' on' : '') },
          el('input', {
            type: 'checkbox', checked: on,
            onchange: (e) => { e.target.checked ? selectedStrategyIds.add(s.id) : selectedStrategyIds.delete(s.id); renderStratList(); updateScale(); },
          }),
          el('div', { class: 'pick-main' },
            el('div', { class: 'pick-name' }, s.name, typeBadge(s.type)),
            el('div', { class: 'pick-sub' }, `수정 ${fmt.date(s.updatedAt || s.createdAt)}`)));
      }));
    }
    renderStratList();

    /* 하단 컨트롤 */
    const nameInput = el('input', { class: 'input', value: defaultRunName() });
    const modelSelect = el('select', { class: 'select' }, el('option', { value: '' }, '전략별 설정 따름'));
    (async () => {
      try {
        const models = await listModels();
        for (const m of models) modelSelect.appendChild(el('option', { value: m.name }, `${m.name}${m.paramSize ? ' · ' + m.paramSize : ''}`));
      } catch { /* Ollama 미연결 — 기본 옵션만 유지 */ }
    })();

    // 온도 통일 컨트롤 — 체크 시 모든 전략을 지정 온도로 실행
    const tempNum = el('input', { class: 'input', type: 'number', min: '0', max: '1', step: '0.1', value: '0.1', disabled: true, style: { width: '92px' } });
    const tempChk = el('input', { type: 'checkbox', onchange: (e) => { tempNum.disabled = !e.target.checked; } });

    // maxSteps 통일 컨트롤 — 모델/온도 통일과 동일 패턴(비우면 전략별 설정 사용)
    const stepsNum = el('input', {
      class: 'input', type: 'number', min: '1', max: '20', step: '1',
      placeholder: '전략별 설정', style: { width: '110px' },
      oninput: () => renderPreflight(),
    });
    /** maxSteps 통일값 — 유한 양수(1~20)만 유효, 비우면 null(전략별 설정) */
    function maxStepsVal() {
      const v = Math.floor(Number(stepsNum.value));
      return (stepsNum.value !== '' && Number.isFinite(v) && v > 0) ? Math.min(v, 20) : null;
    }

    /* 선택된 세트의 무결성 경고(미등록 서버/도구 참조 개수) */
    const warnBox = el('div', {});
    function countIntegrityIssues(set) {
      const byId = new Map((mcps || []).map((m) => [m.id, m]));
      let bad = 0;
      for (const it of (set?.items || [])) {
        const missing = (it.expected || []).some((st) => {
          const server = byId.get(st.serverId);
          if (!server) return true;
          return !(server.tools || []).some((t) => t.name === st.toolName);
        });
        if (missing) bad++;
      }
      return bad;
    }
    function renderWarn() {
      const set = benchmarks.find((b) => b.id === selectedSetId);
      const bad = set ? countIntegrityIssues(set) : 0;
      if (!bad) { warnBox.replaceChildren(); return; }
      warnBox.replaceChildren(el('div', {
        class: 'insight-bar',
        style: { marginTop: '12px', background: 'var(--sig-amber-dim)', borderColor: 'rgba(244,182,63,.28)' },
      },
        el('span', {}, '⚠️'),
        el('div', {}, `이 세트의 ${bad}개 항목이 삭제된 MCP(미등록 서버/도구)를 참조합니다 — 채점이 왜곡될 수 있습니다.`)));
    }

    /* ---------- 사전 점검(preflight) — 비차단 amber 경고, 실패는 조용히 무시 ---------- */
    const preflightBox = el('div', {});

    /** [폴백] 전체 카탈로그를 프롬프트에 주입하는 전략인지 — 구버전 orchestrator(usesFullCatalog 부재)용 근사 분류 */
    function isFullCatalogStrategy(s) {
      if (!s) return false;
      if (s.type === 'prompt') return s.config?.catalogMode !== 'retrieval';
      if (s.type === 'skill') return true;
      if (s.type === 'rule') return s.config?.onNoMatch === 'llmFallback';
      return false; // db는 검색으로 축소 카탈로그 구성
    }

    /** 전체 카탈로그 주입 전략 판정 — orchestrator.usesFullCatalog(유효 프롬프트 템플릿의
     *  {{TOOL_CATALOG}} 포함 여부까지 판정 — skill/rule 허위 경고 제거) 우선, 부재 시 기존 분류 폴백 */
    function isFullCatalog(s) {
      if (typeof orchestratorMod.usesFullCatalog === 'function') {
        try { return !!orchestratorMod.usesFullCatalog(s); } catch { /* 판정 실패 시 폴백 */ }
      }
      return isFullCatalogStrategy(s);
    }

    /** 선택된 세트·전략 기준 경고 문자열 배열 계산 — LLM 호출 없음, 각 점검은 개별 try/catch */
    function computePreflight(set, chosen) {
      const warns = [];
      // (1) 전체 카탈로그 주입 전략: 카탈로그 추정 토큰 vs 컨텍스트 예산 — 전략별 카탈로그 구성(fields)·자동 축약(autoFit) 반영(r6)
      try {
        const fullCat = chosen.filter(isFullCatalog);
        if (fullCat.length && typeof orchestratorMod.estimateCatalogTokens === 'function') {
          const numCtx = getNumCtx();
          // 신버전 orchestrator(자동 축약 지원) 여부 — 부재 시 기존 절단 경고 문구로 폴백
          const hasFitted = typeof orchestratorMod.catalogBudgetTokens === 'function'
            && typeof orchestratorMod.buildToolCatalogFitted === 'function';
          if (Number.isFinite(numCtx)) {
            if (hasFitted) {
              // 예산은 planningMode별·유효 maxSteps별(react 차감이 maxSteps 비례)·추정 토큰은 카탈로그 구성(fields)별로
              // 다름 — (모드·유효 maxSteps·구성·autoFit)이 같은 전략끼리 묶어 안내(r8 §H4-1).
              // config.catalog는 프롬프트(full) 전략의 r6 설정 — 부재 시(스킬·룰 폴백 포함) 기본 구성으로 간주.
              const DEF_FIELDS = { desc: true, params: true, outputs: false, examples: false };
              const uni = maxStepsVal(); // maxSteps 통일값 우선 — 전략 cfg.maxSteps 폴백(둘 다 없으면 6)
              const groups = new Map();
              for (const s of fullCat) {
                const cat = s.config?.catalog || {};
                const fields = { ...DEF_FIELDS, ...(cat.fields || {}) };
                const autoFit = cat.autoFit !== false;
                const mode = s.config?.planningMode === 'react' ? 'react' : 'plan';
                const cfgSteps = Math.floor(Number(s.config?.maxSteps));
                const effSteps = Math.min(uni != null ? uni : (Number.isFinite(cfgSteps) && cfgSteps > 0 ? cfgSteps : 6), 20);
                const key = [mode, effSteps, autoFit, ...Object.keys(DEF_FIELDS).map((k) => (fields[k] ? 1 : 0))].join('|');
                if (!groups.has(key)) groups.set(key, { mode, effSteps, autoFit, fields, list: [] });
                groups.get(key).list.push(s);
              }
              for (const { mode, effSteps, autoFit, fields, list } of groups.values()) {
                const est = orchestratorMod.estimateCatalogTokens(mcps, fields);
                // 3인자 호출 — react 예산이 유효 maxSteps에 비례해 차감됨(구버전 orchestrator는 3번째 인자 무시).
                const budget = orchestratorMod.catalogBudgetTokens(numCtx, mode, effSteps);
                if (!Number.isFinite(est) || !Number.isFinite(budget) || est <= budget) continue;
                const head = `카탈로그 ≈${Math.round(est).toLocaleString('ko-KR')} tok > 예산 ≈${Math.round(budget).toLocaleString('ko-KR')} tok`;
                const names = list.map((s) => s.name).join(', ');
                if (autoFit) {
                  const level = orchestratorMod.buildToolCatalogFitted(mcps, budget, fields).level;
                  warns.push(`${head} — 자동 축약(예상 레벨 L${level})으로 전체 서버는 유지되지만 파라미터·설명 상세도가 낮아집니다. numCtx를 높이면 상세도가 올라갑니다. (해당 전략: ${names})`);
                } else {
                  warns.push(`⚠ ${head} — 자동 축약(autoFit)이 꺼져 있어 프롬프트가 잘려 결과가 오염될 수 있습니다. 자동 축약을 켜거나 numCtx 상향·카탈로그 구성 축소를 권장합니다. (해당 전략: ${names})`);
                }
              }
            } else {
              const est = orchestratorMod.estimateCatalogTokens(mcps);
              if (Number.isFinite(est) && est > numCtx) {
                warns.push(`카탈로그 ≈${Math.round(est).toLocaleString('ko-KR')} tokens > numCtx ${numCtx.toLocaleString('ko-KR')} — 프롬프트가 잘려 결과가 오염될 수 있습니다. 설정에서 numCtx 상향 또는 DB(검색) 전략을 권장합니다. (해당 전략: ${fullCat.map((s) => s.name).join(', ')})`);
              }
            }
          }
        }
      } catch { /* 조용히 무시 */ }
      // (1.5) 커스텀 플래너 템플릿에 {{TOOL_CATALOG}} 미포함(r8 §H4-2) — 도구 목록이 주입되지 않아
      // 직접 나열한 경우가 아니면 계획이 실패함. orchestrator 의존 없이 evaluation.js 자체 판정:
      // prompt(full)의 systemPrompt / rule(llmFallback)의 fallbackPrompt가 비어있지 않은 문자열인데 플레이스홀더 미포함.
      try {
        for (const s of chosen) {
          const cfg = s.config || {};
          let tpl = null;
          if (s.type === 'prompt' && cfg.catalogMode !== 'retrieval') tpl = cfg.systemPrompt;
          else if (s.type === 'rule' && cfg.onNoMatch === 'llmFallback') tpl = cfg.fallbackPrompt;
          // rule은 런타임(runRule)과 동일하게 공백뿐인 템플릿을 기본 템플릿으로 간주 — trim 기준으로 판정
          const custom = typeof tpl === 'string' && (s.type === 'rule' ? tpl.trim() !== '' : tpl !== '');
          if (custom && !tpl.includes('{{TOOL_CATALOG}}')) {
            warns.push(`'${s.name}': ⚠ 플래너 프롬프트에 {{TOOL_CATALOG}}가 없어 도구 목록이 주입되지 않습니다(직접 나열한 경우가 아니라면 계획이 실패합니다)`);
          }
        }
      } catch { /* 조용히 무시 */ }
      // (2) db 전략: 인덱스/그래프 구축 상태
      for (const s of chosen) {
        if (s.type !== 'db') continue;
        try {
          const cfg = s.config || {};
          if (cfg.store === 'graph') {
            const g = cfg.graph || {};
            // 런타임(orchestrator.js)과 동일 규칙: extractModel 미지정 시 기본 모델(settings.defaultModel, 폴백 'exaone3.5:7.8b')
            // — llm 엣지 사용 그래프의 추출 모델 변경도 preflight에서 동일하게 stale 판정.
            const st = graphStatus(mcps, store.get('benchmarks') || [], g.embedModel || undefined, g.extractModel || getDefaultModel(),
              { wantSemantic: !!g.edges?.semantic?.on, wantLlm: !!g.edges?.llm?.on });
            if (!st.exists || st.stale) warns.push(`'${s.name}': 그래프 db ${!st.exists ? '미구축' : '오래됨(stale)'} — vector(→keyword) 폴백으로 평가됩니다. 그래프 편집기에서 구축/재구축하세요.`);
          } else {
            const v = cfg.vector || {};
            if ((v.method || 'hybrid') !== 'keyword') { // keyword 전용 검색은 인덱스 불필요 — 점검 제외
              // 실행 시 retrieve와 동일 기준: 기본 임베딩 모델(bge-m3)로 지문 비교 → 모델 불일치도 stale로 감지
              const st = indexStatus(mcps, v.embedModel || 'bge-m3:latest', v.docFields);
              if (!st.exists || st.stale) warns.push(`'${s.name}': 임베딩 인덱스 ${!st.exists ? '미구축' : '오래됨(stale)'} — keyword 폴백으로 평가됩니다. DB 편집기에서 색인을 구축/재구축하세요.`);
            }
          }
        } catch { /* 조용히 무시 */ }
      }
      // (3) react 계열: 세트 최대 기대 단계+1 vs maxSteps(통일값 우선, final_answer 1단계 여유 필요)
      try {
        const maxExpected = (set?.items || []).reduce((m, it) => Math.max(m, (it.expected || []).length), 0);
        const need = maxExpected + 1;
        const uni = maxStepsVal();
        for (const s of chosen) {
          const cfg = s.config || {};
          const isReact = (s.type === 'prompt' || s.type === 'db') && cfg.planningMode === 'react';
          if (!isReact) continue;
          const cfgSteps = Math.floor(Number(cfg.maxSteps));
          const eff = Math.min(uni != null ? uni : (Number.isFinite(cfgSteps) && cfgSteps > 0 ? cfgSteps : 6), 20);
          if (need > eff) warns.push(`'${s.name}': 최대 ${maxExpected}단계 문항에 maxSteps ${eff} — 여유 부족(권장 ≥ ${need}). react는 마지막 final_answer에 1단계가 더 필요합니다.`);
        }
      } catch { /* 조용히 무시 */ }
      return warns;
    }

    function renderPreflight() {
      try {
        const set = benchmarks.find((b) => b.id === selectedSetId);
        const chosen = sortedStrats.filter((s) => selectedStrategyIds.has(s.id));
        const warns = (set && chosen.length) ? computePreflight(set, chosen) : [];
        if (!warns.length) { preflightBox.replaceChildren(); return; }
        preflightBox.replaceChildren(el('div', { class: 'eval-preflight' },
          el('span', {}, '🔎'),
          el('div', {},
            el('div', { class: 'pf-title' }, `사전 점검 — 주의 ${warns.length}건 (실행은 가능합니다)`),
            el('ul', {}, warns.map((w) => el('li', {}, w))))));
      } catch { preflightBox.replaceChildren(); /* 점검 실패는 실행을 막지 않음 */ }
    }

    const scaleHint = el('div', { class: 'hint' });
    function updateScale() {
      const set = benchmarks.find((b) => b.id === selectedSetId);
      const items = set?.items?.length || 0;
      const nStrat = selectedStrategyIds.size;
      scaleHint.textContent = nStrat ? `예상 실행 규모: 항목 ${items}개 × 전략 ${nStrat}개 = 총 ${items * nStrat}회 실행` : '전략을 1개 이상 선택하세요.';
      startBtn.disabled = !(selectedSetId && nStrat);
      renderWarn();
      renderPreflight();
    }

    const startBtn = el('button', { class: 'btn btn-primary btn-lg', disabled: true, onclick: onStart }, '▶ 평가 시작');

    async function onStart() {
      const set = benchmarks.find((b) => b.id === selectedSetId);
      const chosen = sortedStrats.filter((s) => selectedStrategyIds.has(s.id));
      if (!set || !chosen.length) { toast('벤치마크 세트와 전략을 선택하세요.', 'warn'); return; }
      if (!(set.items || []).length) { toast('선택한 벤치마크 세트에 항목이 없습니다.', 'warn'); return; }

      // LLM 전략 포함 시 Ollama 연결 사전 확인
      if (chosen.some(usesLLM)) {
        startBtn.disabled = true;
        const prev = startBtn.textContent;
        startBtn.replaceChildren(spinner(), ' 연결 확인 중…');
        const conn = await checkConnection();
        startBtn.textContent = prev; startBtn.disabled = false;
        if (!conn.ok) {
          const go = await confirmDialog(
            `Ollama에 연결되지 않았습니다 (${conn.error || '원인 미상'}).\nLLM을 사용하는 전략은 대부분 오류로 처리됩니다. 그래도 진행할까요?`,
            { title: 'Ollama 미연결', danger: false, okLabel: '진행' });
          if (!go) return;
        }
      }

      const model = modelSelect.value || null;
      let temperature = null;
      if (tempChk.checked) {
        let t = Number(tempNum.value);
        if (!Number.isFinite(t)) t = 0.1;
        temperature = Math.max(0, Math.min(1, t));
      }
      const maxSteps = maxStepsVal(); // null이면 전략별 설정 사용
      startProgress({ benchmarkSet: set, strategies: chosen, model, temperature, maxSteps, name: nameInput.value.trim() || defaultRunName() });
    }

    updateScale();

    const configGrid = el('div', { class: 'grid cols-2' },
      el('div', { class: 'card' },
        el('div', { class: 'panel-title' }, '벤치마크 세트 선택', el('span', { class: 'sub' }, '(1개)')),
        setList),
      el('div', { class: 'card' },
        el('div', { class: 'panel-title' }, '전략 선택', el('span', { class: 'sub' }, '(비교할 전략 다중 선택)')),
        stratList));

    const runCard = el('div', { class: 'card', style: { marginTop: '16px' } },
      el('div', { class: 'panel-title' }, '실행 옵션'),
      el('div', { class: 'grid cols-2' },
        el('div', { class: 'fld' }, el('label', {}, '실행 이름'), nameInput),
        el('div', { class: 'fld' }, el('label', {}, '모델 오버라이드'), modelSelect,
          el('div', { class: 'hint' }, '선택 시 모든 전략에 강제 적용됩니다(공정 비교용). 기본은 각 전략에 지정된 모델을 따릅니다.'))),
      el('div', { class: 'grid cols-2', style: { marginTop: '10px' } },
        el('div', { class: 'fld' },
          el('label', { class: 'row', style: { gap: '8px', alignItems: 'center', cursor: 'pointer' } },
            tempChk, '온도 통일', tempNum),
          el('div', { class: 'hint' }, '체크 시 모든 전략을 지정 온도(0~1, 기본 0.1)로 실행하여 무작위성을 통제합니다.')),
        el('div', { class: 'fld' },
          el('label', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, 'maxSteps 통일', stepsNum),
          el('div', { class: 'hint' }, '지정 시(1~20) 프롬프트/DB 전략의 최대 실행 단계를 통일합니다(공정 비교용). 비우면 각 전략의 설정을 따릅니다.'))),
      preflightBox,
      el('div', { class: 'row between', style: { marginTop: '6px', flexWrap: 'wrap', gap: '12px' } },
        scaleHint, startBtn));

    return el('div', {},
      configGrid,
      warnBox,
      runCard,
      el('div', { style: { marginTop: '18px' } }, buildHistory(store.get('runs') || [])));
  }

  /* ---------- 실행 이력 ---------- */
  function buildHistory(runs) {
    const card = el('div', { class: 'card' }, el('div', { class: 'panel-title' }, '실행 이력'));
    if (!runs.length) {
      card.appendChild(el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '아직 평가 실행 기록이 없습니다.'));
      return card;
    }
    const rows = runs.map((r) => {
      const strat = orderedStrategies(r);
      const bestF1 = strat.length ? strat[0].summary.avgF1 : null;
      return el('tr', { style: { cursor: 'pointer' }, onclick: () => router.navigate(`/evaluation/${r.id}`) },
        el('td', {}, el('b', { style: { color: 'var(--tx0)' } }, r.name || r.benchmarkSetName)),
        el('td', {}, fmt.date(r.createdAt)),
        el('td', {}, r.benchmarkSetName || '-'),
        el('td', { class: 'num' }, String(r.strategyIds?.length || 0)),
        el('td', {}, badge(STATUS_LABEL[r.status] || r.status, STATUS_KIND[r.status] || 'dim')),
        el('td', { class: 'num' }, bestF1 == null ? '-' : fmt.pct(bestF1)),
        el('td', { style: { textAlign: 'right' } },
          el('button', {
            class: 'btn btn-sm btn-danger',
            onclick: async (e) => {
              e.stopPropagation();
              if (!await confirmDialog(`실행 '${r.name}' 기록을 삭제할까요?`)) return;
              store.update('runs', (list = []) => list.filter((x) => x.id !== r.id));
              toast('실행 기록이 삭제되었습니다.', 'success');
              showSetup();
            },
          }, '삭제')));
    });
    card.appendChild(el('div', { class: 'tbl-wrap' },
      el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {},
          el('th', {}, '이름'), el('th', {}, '날짜'), el('th', {}, '세트'),
          el('th', {}, '전략 수'), el('th', {}, '상태'), el('th', {}, '최고 F1'), el('th', {}, ''))),
        el('tbody', {}, rows))));
    return card;
  }

  /* ============================================================
     (B) 진행 중
     ============================================================ */
  function startProgress({ benchmarkSet, strategies, model, temperature, maxSteps = null, name }) {
    const controller = new AbortController();
    const total = benchmarkSet.items.length;
    const totalUnits = total * strategies.length;
    let completedUnits = 0;

    const overallFill = el('i', { style: { width: '0%' } });
    const overallText = el('span', { class: 'mono', style: { color: 'var(--tx1)' } }, `0 / ${totalUnits}`);
    const elapsedText = el('span', { class: 'mono', style: { color: 'var(--tx2)' } }, '0.0s');
    const t0 = performance.now();
    const timer = setInterval(() => { elapsedText.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's'; }, 100);

    const cards = new Map();
    const cardNodes = strategies.map((s) => {
      const fill = el('i', { style: { width: '0%' } });
      const count = el('span', { class: 'mono', style: { color: 'var(--tx2)', fontSize: '12px' } }, `0/${total}`);
      const q = el('div', { class: 'prog-q' }, '대기 중…');
      cards.set(s.id, { fill, count, q });
      return el('div', { class: 'card prog-card' },
        el('div', { class: 'prog-head' },
          el('div', { class: 'row', style: { gap: '8px' } }, el('b', { style: { color: 'var(--tx0)' } }, s.name), typeBadge(s.type)),
          count),
        el('div', { class: 'progress' }, fill),
        q);
    });

    const stopBtn = el('button', { class: 'btn btn-danger', onclick: () => { stopBtn.disabled = true; stopBtn.textContent = '중단하는 중…'; controller.abort(); } }, '■ 중단');

    container.replaceChildren(
      el('div', { class: 'card' },
        el('div', { class: 'row between', style: { marginBottom: '12px' } },
          el('div', { class: 'panel-title', style: { margin: 0 } }, '평가 실행 중', el('span', { class: 'sub' }, name)),
          el('div', { class: 'row', style: { gap: '14px' } }, el('span', { style: { color: 'var(--tx2)', fontSize: '12px' } }, '경과 ', elapsedText), stopBtn)),
        el('div', { class: 'row between', style: { marginBottom: '7px' } },
          el('span', { style: { color: 'var(--tx2)', fontSize: '12.5px' } }, '전체 진행률'), overallText),
        el('div', { class: 'progress' }, overallFill)),
      el('div', { class: 'grid cols-2', style: { marginTop: '16px' } }, cardNodes));

    const onProgress = (p) => {
      const c = cards.get(p.strategyId);
      if (!c) return;
      if (p.phase === 'running') {
        c.q.textContent = '▶ ' + (p.query || '');
      } else if (p.phase === 'done') {
        c.count.textContent = `${p.itemIndex}/${p.total}`;
        c.fill.style.width = (p.total ? (p.itemIndex / p.total) * 100 : 100) + '%';
        completedUnits++;
        overallText.textContent = `${completedUnits} / ${totalUnits}`;
        overallFill.style.width = (totalUnits ? (completedUnits / totalUnits) * 100 : 100) + '%';
      }
    };

    (async () => {
      let run;
      try {
        run = await runEvaluation({ benchmarkSet, strategies, mcps, model, temperature, maxSteps, name, onProgress, signal: controller.signal });
      } catch (e) {
        clearInterval(timer);
        toast('평가 실행 중 오류: ' + (e?.message || e), 'error');
        showSetup();
        return;
      }
      clearInterval(timer);
      toast(run.status === 'cancelled' ? '평가가 중단되었습니다. 부분 결과를 저장했습니다.' : '평가가 완료되었습니다.', run.status === 'cancelled' ? 'warn' : 'success');

      // 저장: 최근 20개 유지 → 실패(용량 초과) 시 10개 절단 재시도 → 최종 폴백으로 [run] 단독 1회 시도
      const existing = (store.get('runs') || []).filter((r) => r.id !== run.id);
      let saved = store.set('runs', [run, ...existing].slice(0, 20));
      if (!saved) saved = store.set('runs', [run, ...existing].slice(0, 10));
      if (!saved) {
        saved = store.set('runs', [run]); // 최종 폴백: 이번 결과만 단독 저장(이전 이력은 제거됨)
        if (saved) toast('저장 공간 부족 — 이전 실행 이력을 비우고 이번 결과만 저장했습니다.', 'warn');
      }
      if (!saved) {
        toast('평가 결과 저장 실패 — 저장 공간 부족. 오래된 실행 기록을 삭제하고, 이 결과는 화면의 ⬇ JSON 내보내기로 보존하세요.', 'error');
        container.replaceChildren(buildResults(run)); // 저장은 실패했어도 결과는 표시
        return;
      }
      router.navigate(`/evaluation/${run.id}`);
    })();
  }

  /* ============================================================
     (C) 결과 뷰
     ============================================================ */
  function buildResults(run) {
    const baseStrat = orderedStrategies(run); // 기본: F1 내림차순
    const root = el('div', {});

    /* 1. 헤더 */
    root.appendChild(el('div', { class: 'card', style: { marginBottom: '16px' } },
      el('div', { class: 'row between', style: { flexWrap: 'wrap', gap: '12px' } },
        el('div', {},
          el('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
            el('h2', { style: { fontSize: '18px', color: 'var(--tx0)' } }, run.name || run.benchmarkSetName),
            badge(STATUS_LABEL[run.status] || run.status, STATUS_KIND[run.status] || 'dim')),
          el('div', { class: 'hint', style: { marginTop: '4px' } },
            `${run.benchmarkSetName || '-'} · ${fmt.date(run.createdAt)} · 전략 ${baseStrat.length}개${run.model ? ' · 모델 ' + run.model : ''}${run.temperature != null ? ' · 온도 통일 ' + run.temperature : ''}${run.maxSteps != null ? ' · maxSteps 통일 ' + run.maxSteps : ''}${Number.isFinite(run.numCtx) ? ' · numCtx ' + Math.round(run.numCtx).toLocaleString('ko-KR') : ''}`)),
        el('div', { class: 'row wrap', style: { gap: '8px' } },
          el('button', { class: 'btn btn-sm', onclick: () => exportJSON(run) }, '⬇ JSON'),
          el('button', { class: 'btn btn-sm', onclick: () => exportCSV(run) }, '⬇ CSV'),
          el('button', { class: 'btn btn-sm btn-primary', onclick: () => router.navigate('/evaluation') }, '＋ 새 평가')))));

    if (!baseStrat.length) {
      root.appendChild(emptyState({ icon: '📭', title: '결과가 없습니다', desc: '이 실행에는 채점된 전략 결과가 없습니다.' }));
      return root;
    }

    /* 5. 인사이트 요약 (상단 배치) — 정렬과 무관하게 안정 */
    root.appendChild(buildInsight(baseStrat));

    /* 2·3. 리더보드 + 차트 — 정렬 기준 변경 시 표·차트 시리즈 순서 동기화 */
    let sortKey = 'orchestrationScore'; // 기본 정렬 = 오케스트레이션 종합점수 내림차순
    const leaderBox = el('div', {});
    const chartsBox = el('div', {});
    function sortStrat() {
      const opt = SORT_OPTS.find((o) => o.key === sortKey) || SORT_OPTS[0];
      return [...baseStrat].sort((a, b) => {
        const va = a.summary[sortKey] || 0, vb = b.summary[sortKey] || 0;
        return opt.asc ? va - vb : vb - va;
      });
    }
    function renderSorted() {
      const s = sortStrat();
      leaderBox.replaceChildren(buildLeaderboard(s, sortKey, (k) => { sortKey = k; renderSorted(); }));
      chartsBox.replaceChildren(buildCharts(run, s));
    }
    renderSorted();
    root.appendChild(leaderBox);
    root.appendChild(chartsBox);

    /* 3.5 지표 설명(용어집) — 접이식 */
    root.appendChild(buildGlossary());

    /* 4. 항목별 상세 (기본 F1 순) */
    root.appendChild(buildDetail(run, baseStrat));

    return root;
  }

  /* ---------- 지표 설명 (용어집) — 접이식 패널 ---------- */
  function buildGlossary() {
    const item = (key) => {
      const info = METRIC_INFO[key];
      if (!info) return null;
      return el('div', { class: 'gl-item' },
        el('div', { class: 'gl-name' }, info.name),
        el('div', { class: 'gl-mean' }, info.meaning),
        el('div', { class: 'gl-formula' }, '계산식: ' + info.formula),
        el('span', { class: 'gl-dir ' + info.dir }, info.dir === 'up' ? '▲ 높을수록 좋음' : '▼ 낮을수록 좋음'));
    };
    const section = (title, keys) => el('div', {},
      el('div', { class: 'gl-section-title' }, title),
      el('div', { class: 'gl-grid' }, keys.map(item)));

    // 카탈로그 축약 레벨표(L1~L4) — 리더보드 '축약 L{max}×N' 뱃지·문항 상세 '축약 L{n}' 뱃지의 레벨 의미
    const LEVEL_ROWS = [
      ['L1', '예시값 (examples) 제외 · 설명 절단'],
      ['L2', '+ 출력·선택 파라미터 제외 · 서버 설명 제거'],
      ['L3', '필수 파라미터 이름만'],
      ['L4', '서버·도구명만'],
    ];
    const levelTable = el('div', {},
      el('div', { class: 'gl-section-title' }, '카탈로그 축약 레벨 (L1~L4)'),
      el('div', { class: 'tbl-wrap' },
        el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, '레벨'), el('th', {}, '축약 내용 (누적 적용)'))),
          el('tbody', {}, LEVEL_ROWS.map(([lv, desc]) => el('tr', {},
            el('td', { class: 'mono', style: { whiteSpace: 'nowrap' } }, lv),
            el('td', {}, desc)))))),
      el('div', { class: 'hint', style: { marginTop: '6px' } },
        '레벨이 높을수록 상세도가 낮습니다. 적용 레벨은 문항 상세의 \'축약 L{n}\' 뱃지·트레이스에서 확인하며, numCtx를 높이면 상세도가 올라갑니다.'));

    const hero = el('div', { class: 'gl-hero' },
      el('div', { class: 'gl-hero-title' }, '오케스트레이션 종합점수 공식'),
      el('div', { class: 'gl-hero-formula' },
        el('div', {}, '종합점수 = ', el('b', {}, '0.85 × 품질'), ' + ', el('b', {}, '0.15 × 토큰효율')),
        el('div', { style: { marginTop: '6px' } }, '품질 = 0.4 × F1 + 0.3 × 목표달성 + 0.15 × 도구성공률 + 0.15 × 파라미터정확도')),
      el('div', { class: 'gl-hero-note' }, '토큰효율은 가장 적게 쓴 전략(=1) 대비 토큰을 많이 쓸수록 낮아지는 비율 기반 상대 지표입니다. 함께 평가한 전략 집합에 상대적이라 run 간 비교는 불가하며, 단일 전략만 평가하면 1로 처리됩니다. 품질점수는 구성 지표가 N/A이면 그 가중치를 빼고 재정규화합니다.'));

    return el('div', { class: 'card', style: { marginBottom: '16px' } },
      el('details', { class: 'eval-glossary' },
        el('summary', {},
          el('span', { class: 'gl-summary-title' }, '📖 지표 설명 (용어집)'),
          el('span', { class: 'gl-summary-hint' }, '처음 보는 지표의 의미·계산식·해석을 펼쳐 확인하세요')),
        el('div', { class: 'gl-body' },
          hero,
          section('종합 지표', ['orchestrationScore', 'compositeScore', 'tokenEfficiency']),
          section('도구 선택 정확도', ['f1', 'precision', 'recall']),
          section('순서 · 완전성', ['seqAccuracy', 'exactMatch']),
          section('파라미터 · 목표 달성', ['paramScore', 'goalAchieved', 'callSuccessRate', 'extraToolRate']),
          section('토큰 사용량', ['inputTokens', 'outputTokens', 'totalTokens']),
          section('실행 비용 · 안정성', ['avgLatencyMs', 'avgLlmCalls', 'errorRate']),
          section('검색 품질 (DB/검색 전략)', ['retrievalRecall', 'goalRetrieved']),
          section('결과 신뢰도 (리더보드 뱃지)', ['ctxOverflowCount', 'retrievalFallbackCount', 'catalogCompressedCount']),
          levelTable)));
  }

  /* ---------- 인사이트 한 줄 ---------- */
  function buildInsight(strat) {
    const parts = [];
    // 헤드라인은 종합점수 — 최고 종합점수 전략을 가장 먼저 언급(F1은 구성 지표 중 하나일 뿐)
    const byScore = [...strat].sort((a, b) => (b.summary.orchestrationScore || 0) - (a.summary.orchestrationScore || 0));
    const bestScore = byScore[0];
    const byF1 = [...strat].sort((a, b) => (b.summary.avgF1 || 0) - (a.summary.avgF1 || 0));
    const bestF1 = byF1[0];
    if (bestScore?.summary.orchestrationScore != null) parts.push(`최고 종합점수는 “${bestScore.strategyName}” (${fmt.pct(bestScore.summary.orchestrationScore)})`);
    parts.push(`최고 F1은 “${bestF1.strategyName}” (${fmt.pct(bestF1.summary.avgF1)})`);
    // 최고 목표달성률 — N/A(목표 특정 불가) 전략은 제외하고 비교
    const byGoal = [...strat]
      .filter((s) => s.summary.goalAchievementRate != null && !Number.isNaN(s.summary.goalAchievementRate))
      .sort((a, b) => (b.summary.goalAchievementRate || 0) - (a.summary.goalAchievementRate || 0));
    if (byGoal.length) parts.push(`최고 목표달성률은 “${byGoal[0].strategyName}” (${fmtRate(byGoal[0].summary.goalAchievementRate)})`);
    if (strat.length > 1) {
      const fastest = [...strat].sort((a, b) => (a.summary.avgLatencyMs || 0) - (b.summary.avgLatencyMs || 0))[0];
      const bestExact = [...strat].sort((a, b) => (b.summary.exactMatchRate || 0) - (a.summary.exactMatchRate || 0))[0];
      parts.push(`가장 빠른 전략은 “${fastest.strategyName}” (${fmt.ms(fastest.summary.avgLatencyMs)})`);
      if (bestExact.id !== bestF1.id) parts.push(`완전일치율 최고는 “${bestExact.strategyName}” (${fmt.pct(bestExact.summary.exactMatchRate)})`);
    }

    const lines = [el('div', {}, parts.join(' · ') + '.')];

    // F1 격차 원인 분해 — 1·2위의 precision 차 vs recall 차 중 큰 쪽을 지목
    if (byF1.length > 1) {
      const a = byF1[0], b = byF1[1];
      const gap = (a.summary.avgF1 || 0) - (b.summary.avgF1 || 0);
      if (gap > 0.0001) {
        const dP = (a.summary.avgPrecision || 0) - (b.summary.avgPrecision || 0);
        const dR = (a.summary.avgRecall || 0) - (b.summary.avgRecall || 0);
        const sign = (x) => (x >= 0 ? '+' : '') + fmt.pct(x);
        const cause = Math.abs(dP) >= Math.abs(dR)
          ? `주로 불필요한 도구 호출이 적어서(Precision ${sign(dP)})`
          : `주로 필요한 도구를 더 많이 호출해서(Recall ${sign(dR)})`;
        lines.push(el('div', { style: { marginTop: '4px', color: 'var(--tx2)' } }, `“${a.strategyName}”의 F1 우위는 ${cause}입니다.`));
      }
    }

    return el('div', { class: 'insight-bar', style: { marginBottom: '16px', alignItems: 'flex-start' } }, el('span', {}, '💡'), el('div', {}, lines));
  }

  /* ---------- 리더보드 ---------- */
  function buildLeaderboard(strat, sortKey = 'orchestrationScore', onSortChange) {
    // r8(§H4-3): 모든 전략이 검색 리콜 없음(전체 주입만·구버전 run)이면 '검색 리콜' 열 자체를 생략.
    // th/td 쌍 정합: 이 플래그 하나로 헤더·행 모두 분기한다.
    const showRetrievalCol = strat.some((s) => s.summary?.avgRetrievalRecall != null);
    const metricBar = (v, fill) => el('div', { class: 'metric-bar' },
      el('div', { class: 'mb-track' }, el('div', { class: 'mb-fill', style: { width: Math.max(0, Math.min(1, v || 0)) * 100 + '%', ...(fill ? { background: fill } : {}) } })),
      el('span', { class: 'mb-val' }, fmt.pct(v)));
    // 종합점수는 F1(초록)과 구분되도록 보라~파랑 그라데이션 막대. 값이 없으면 '-'
    const scoreCell = (v) => v == null
      ? el('td', { class: 'metric-cell num', style: { color: 'var(--tx3)' } }, '-')
      : el('td', { class: 'metric-cell' }, metricBar(v, 'linear-gradient(90deg,#a78bfa,#4da3ff)'));
    // 평균 총토큰 셀 — 추정치 포함 시 ≈ 배지
    const tokenCell = (m) => m.avgTotalTokens == null
      ? el('td', { class: 'num', style: { color: 'var(--tx3)' } }, '-')
      : el('td', { class: 'num', title: m.anyTokensEstimated ? '실측값이 없어 글자수 기반으로 추정한 값을 포함합니다.' : '' },
          el('span', { class: 'tok-cell' },
            m.anyTokensEstimated ? el('span', { class: 'tok-est' }, '≈') : null,
            fmtTok(m.avgTotalTokens)));

    const rows = strat.map((s, i) => {
      const m = s.summary;
      const isRuleFallback = s.strategyType === 'rule' && (m.fallbackRate || 0) > 0;
      // 신뢰도 뱃지 — 신규 요약 키(ctxOverflowCount/retrievalFallbackCount/catalogCompressedCount)가 없는 구버전 run은 뱃지 없음
      const ctxN = Number(m.ctxOverflowCount) || 0;
      const rfN = Number(m.retrievalFallbackCount) || 0;
      const compN = Number(m.catalogCompressedCount) || 0;
      const nameCell = el('td', {},
        el('div', { class: 'row', style: { gap: '7px', flexWrap: 'wrap', alignItems: 'center' } },
          el('b', { style: { color: 'var(--tx0)' } }, s.strategyName),
          typeBadge(s.strategyType),
          isRuleFallback
            ? el('span', { class: 'badge amber', title: '매치 실패 항목은 LLM 폴백으로 실행됨 — 룰 자체 성능과 분리 해석 필요' }, `폴백 ${fmt.pct(m.fallbackRate)}`)
            : null,
          ctxN > 0
            ? el('span', { class: 'badge amber', title: `컨텍스트 초과 ${ctxN}문항 — 프롬프트가 numCtx를 넘어 잘렸을 가능성이 있습니다. 이 전략의 점수는 신뢰할 수 없습니다. numCtx 상향 또는 DB 전략을 권장합니다.` }, `⚠ctx ${ctxN}`)
            : null,
          rfN > 0
            ? el('span', { class: 'badge amber', title: `검색 폴백 ${rfN}문항 — DB 전략이 의도한 검색(vector/graph)이 아닌 폴백 경로로 실행되었습니다. 전략 설계 의도와 다른 조건에서 측정된 점수입니다.` }, `⚠폴백 ${rfN}`)
            : null,
          // 카탈로그 자동 축약 — 오류가 아닌 조건 표시라 ⚠(amber)와 구분되는 dim 톤.
          // catalogDetailMax(0~4)가 있으면 '축약 L{max}×N' 형식, 부재(구버전 run)면 기존 '축약 N' 폴백.
          compN > 0
            ? (() => {
                const lvlMax = Number(m.catalogDetailMax) || 0;
                return el('span', {
                  class: 'badge dim',
                  title: `카탈로그 자동 축약이 적용된 문항 수 — 전체 서버 유지, 상세도 하향${lvlMax > 0 ? ` (최대 레벨 L${lvlMax})` : ''}. 문항 상세의 '축약 L{n}' 뱃지·트레이스 참조`,
                }, lvlMax > 0 ? `축약 L${lvlMax}×${compN}` : `축약 ${compN}`);
              })()
            : null),
        (isRuleFallback && m.avgF1Matched != null)
          ? el('div', { class: 'hint', style: { marginTop: '3px', color: 'var(--tx2)' } }, `룰 매치 항목만 F1 ${fmt.pct(m.avgF1Matched)}`)
          : null);
      return el('tr', {},
        el('td', {}, el('span', { class: 'leader-rank' + (i === 0 ? ' r1' : '') }, String(i + 1))),
        nameCell,
        scoreCell(m.orchestrationScore),
        el('td', { class: 'metric-cell' }, metricBar(m.avgF1)),
        el('td', { class: 'num' }, fmtRate(m.goalAchievementRate)),
        el('td', { class: 'num' }, fmt.pct(m.avgCallSuccessRate)),
        el('td', {
          class: 'num',
          style: { color: (m.avgExtraToolRate ?? 0) > 0 ? 'var(--sig-amber)' : 'var(--tx2)' },
        }, fmt.pct(m.avgExtraToolRate)),
        el('td', { class: 'num' }, fmt.pct(m.avgPrecision)),
        el('td', { class: 'num' }, fmt.pct(m.avgRecall)),
        // 검색 리콜 — 전체 카탈로그 주입 전략·구버전 run(avgRetrievalRecall 없음)은 '-'(N/A).
        // 모든 전략이 N/A면 열 자체를 생략(showRetrievalCol — 헤더와 쌍 정합).
        !showRetrievalCol ? null : (() => {
          const rr = m.avgRetrievalRecall;
          const missN = Number(m.retrievalMissCount) || 0;
          const goalMissN = Number(m.goalMissCount) || 0; // r8: goalRetrieved=false 문항 수(구버전 run은 0)
          const titleParts = [];
          if (rr != null && missN > 0) titleParts.push(`검색 미스 ${missN}문항 — 정답 도구가 검색 후보에서 일부 누락된(리콜<1) 문항 수`);
          if (rr != null && goalMissN > 0) titleParts.push(`목표 도구 미검색 ${goalMissN}문항 — 목표(최종) 도구가 검색 후보에 아예 없어 목표 달성이 불가능했던 문항 수`);
          return el('td', {
            class: 'num',
            style: rr == null ? { color: 'var(--tx3)' } : ((missN > 0 || goalMissN > 0) ? { color: 'var(--sig-amber)' } : {}),
            title: titleParts.join('\n'),
          }, fmtRate(rr));
        })(),
        el('td', { class: 'num' }, fmt.pct(m.avgSeqAccuracy)),
        el('td', { class: 'num' }, fmt.pct(m.exactMatchRate)),
        el('td', { class: 'num' }, m.avgParamScore == null ? '-' : fmt.pct(m.avgParamScore)),
        tokenCell(m),
        el('td', { class: 'num' }, fmt.ms(m.avgLatencyMs)),
        el('td', { class: 'num' }, fmt.num(m.avgLlmCalls, 1)),
        el('td', {
          class: 'num', style: { color: m.errorRate > 0 ? 'var(--sig-red)' : 'var(--tx2)' },
          title: `부분 오류 포함 비율입니다 (실행 실패 ${fmt.pct(m.hardErrorRate ?? 0)} + 회복된 단계 오류). react류는 단계 오류에서 회복할 수 있어 실행 실패율과 함께 해석하세요.`,
        }, fmt.pct(m.errorRate)));
    });

    const curLabel = (SORT_OPTS.find((o) => o.key === sortKey) || SORT_OPTS[0]).label;
    const sortSel = el('select', { class: 'select', style: { width: 'auto' }, onchange: (e) => onSortChange && onSortChange(e.target.value) },
      SORT_OPTS.map((o) => el('option', { value: o.key, selected: o.key === sortKey }, o.label)));

    return el('div', { class: 'card', style: { marginBottom: '16px' } },
      el('div', { class: 'row between', style: { marginBottom: '12px', flexWrap: 'wrap', gap: '8px' } },
        el('div', { class: 'panel-title', style: { margin: 0 } }, '리더보드', el('span', { class: 'sub' }, `${curLabel} 기준 순위`)),
        el('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, el('span', { class: 'hint' }, '정렬 기준'), sortSel)),
      el('div', { class: 'tbl-wrap' },
        el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {},
            el('th', {}, '순위'), el('th', {}, '전략'),
            thHelp('종합점수', 'orchestrationScore'), thHelp('F1', 'f1'),
            thHelp('목표달성', 'goalAchieved'), thHelp('도구성공', 'callSuccessRate'),
            thHelp('잉여호출', 'extraToolRate'),
            thHelp('Precision', 'precision'), thHelp('Recall', 'recall'),
            showRetrievalCol ? thHelp('검색 리콜', 'retrievalRecall') : null,
            thHelp('시퀀스', 'seqAccuracy'), thHelp('완전일치', 'exactMatch'),
            thHelp('파라미터', 'paramScore'), thHelp('평균토큰', 'totalTokens'),
            thHelp('평균 지연', 'avgLatencyMs'), thHelp('LLM', 'avgLlmCalls'),
            thHelp('오류율', 'errorRate'))),
          el('tbody', {}, rows))));
  }

  /* ---------- 차트 영역 ---------- */
  function buildCharts(run, strat) {
    const series = strat.map((s) => ({ label: s.strategyName }));

    // (a) 그룹 막대
    const metricDefs = [
      { key: 'avgF1', label: 'F1' },
      { key: 'avgPrecision', label: 'Precision' },
      { key: 'avgRecall', label: 'Recall' },
      { key: 'avgSeqAccuracy', label: '시퀀스' },
      { key: 'exactMatchRate', label: '완전일치' },
    ];
    const groups = metricDefs.map((md) => ({ label: md.label, values: strat.map((s) => s.summary[md.key] || 0) }));
    const barCard = el('div', { class: 'card' },
      el('div', { class: 'panel-title' }, '지표별 전략 비교'),
      groupedBarChart(groups, series, { max: 1 }));

    // (b) 레이더
    const radarAxes = [{ label: 'F1' }, { label: 'Precision' }, { label: 'Recall' }, { label: '시퀀스' }, { label: '완전일치' }, { label: '안정성' }];
    const radarSeries = strat.map((s) => ({
      label: s.strategyName,
      // 안정성은 하드 오류율(실행 실패)만 사용 — 단계 오류에서 회복하는 전략(react)이 부당하게 감점되지 않도록
      values: [s.summary.avgF1, s.summary.avgPrecision, s.summary.avgRecall, s.summary.avgSeqAccuracy, s.summary.exactMatchRate, 1 - (s.summary.hardErrorRate ?? s.summary.errorRate ?? 0)],
    }));
    const radarCard = el('div', { class: 'card' },
      el('div', { class: 'panel-title' }, '다차원 프로파일', el('span', { class: 'sub' }, '안정성 = 1 − 실행 실패율')),
      radarChart(radarAxes, radarSeries));

    // (c) 평균 지연 수평 막대
    const maxLat = Math.max(1, ...strat.map((s) => s.summary.avgLatencyMs || 0));
    const latCard = el('div', { class: 'card' },
      el('div', { class: 'panel-title' }, '평균 지연시간'),
      hBarChart(strat.map((s) => ({ label: s.strategyName, value: s.summary.avgLatencyMs || 0 })),
        { max: maxLat, fmtVal: (v) => fmt.ms(v) }));

    // (d) 난이도별 F1 (전략 세그먼트 전환)
    const diffBox = el('div', {});
    let selId = strat[0].id;
    function renderDiff() {
      const s = strat.find((x) => x.id === selId) || strat[0];
      const groupsByDiff = { easy: [], medium: [], hard: [] };
      for (const it of (s.items || [])) if (groupsByDiff[it.difficulty]) groupsByDiff[it.difficulty].push(it.metrics?.f1 || 0);
      const items = ['easy', 'medium', 'hard']
        .filter((k) => groupsByDiff[k].length)
        .map((k) => ({ label: DIFF_LABEL[k], value: groupsByDiff[k].reduce((a, b) => a + b, 0) / groupsByDiff[k].length, color: k === 'easy' ? SERIES_COLORS[0] : k === 'medium' ? SERIES_COLORS[2] : SERIES_COLORS[4] }));
      diffBox.replaceChildren(items.length
        ? hBarChart(items, { max: 1 })
        : el('div', { class: 'hint', style: { color: 'var(--tx3)', padding: '20px', textAlign: 'center' } }, '난이도 정보가 있는 항목이 없습니다.'));
    }
    renderDiff();
    const diffCard = el('div', { class: 'card' },
      el('div', { class: 'row between', style: { marginBottom: '12px', flexWrap: 'wrap', gap: '8px' } },
        el('div', { class: 'panel-title', style: { margin: 0 } }, '난이도별 F1'),
        strat.length > 1 ? segmented(strat.map((s) => ({ label: s.strategyName, value: s.id })), selId, (v) => { selId = v; renderDiff(); }) : null),
      diffBox);

    // (d-2) 카테고리별 F1 — 난이도별 F1과 동일 패턴(전략 세그먼트 전환). category 없는 구버전 run은 빈 안내.
    const catBox = el('div', {});
    let catSelId = strat[0].id;
    function renderCat() {
      const s = strat.find((x) => x.id === catSelId) || strat[0];
      const byCat = new Map();
      for (const it of (s.items || [])) {
        if (!it.category) continue; // 카테고리 미기록(구버전 run) 항목은 스킵
        if (!byCat.has(it.category)) byCat.set(it.category, []);
        byCat.get(it.category).push(it.metrics?.f1 || 0);
      }
      const items = [...byCat.entries()]
        .map(([label, arr]) => ({ label, value: arr.reduce((a, b) => a + b, 0) / arr.length }))
        .sort((a, b) => b.value - a.value)
        .map((x, i) => ({ ...x, color: SERIES_COLORS[i % SERIES_COLORS.length] }));
      catBox.replaceChildren(items.length
        ? hBarChart(items, { max: 1 })
        : el('div', { class: 'hint', style: { color: 'var(--tx3)', padding: '20px', textAlign: 'center' } }, '카테고리 정보가 있는 항목이 없습니다.'));
    }
    renderCat();
    const catCard = el('div', { class: 'card' },
      el('div', { class: 'row between', style: { marginBottom: '12px', flexWrap: 'wrap', gap: '8px' } },
        el('div', { class: 'panel-title', style: { margin: 0 } }, '카테고리별 F1'),
        strat.length > 1 ? segmented(strat.map((s) => ({ label: s.strategyName, value: s.id })), catSelId, (v) => { catSelId = v; renderCat(); }) : null),
      catBox);

    // (e) 전략별 토큰 사용량 (평균 입력/출력) — 토큰 데이터가 있을 때만
    const hasTokens = strat.some((s) => (s.summary.avgTotalTokens ?? 0) > 0
      || s.summary.avgInputTokens != null || s.summary.avgOutputTokens != null);
    let tokenCard = null;
    if (hasTokens) {
      const tokenGroups = [
        { label: '평균 입력 토큰', values: strat.map((s) => s.summary.avgInputTokens || 0) },
        { label: '평균 출력 토큰', values: strat.map((s) => s.summary.avgOutputTokens || 0) },
      ];
      const tokMax = Math.max(1, ...strat.flatMap((s) => [s.summary.avgInputTokens || 0, s.summary.avgOutputTokens || 0]));
      const anyEst = strat.some((s) => s.summary.anyTokensEstimated);
      tokenCard = el('div', { class: 'card' },
        el('div', { class: 'panel-title' }, '전략별 토큰 사용량',
          anyEst ? el('span', { class: 'sub', style: { color: 'var(--sig-amber)' } }, '≈ 추정치 포함') : null),
        groupedBarChart(tokenGroups, series, { max: tokMax, fmtVal: (v) => Math.round(v).toLocaleString('ko-KR') }),
        el('div', { class: 'hint', style: { marginTop: '8px' } },
          '프롬프트·스킬 전략은 카탈로그·컨텍스트를 프롬프트에 길게 넣어 DB(검색) 전략보다 입력 토큰이 많은 경향이 있습니다. 토큰이 적을수록 비용·지연이 낮습니다.'));
    }

    return el('div', { class: 'grid cols-2', style: { marginBottom: '16px' } },
      barCard, radarCard, latCard, diffCard, catCard, tokenCard);
  }

  /* ---------- 항목별 상세 ---------- */
  function buildDetail(run, strat) {
    const tableBox = el('div', {});
    let selId = strat[0].id;
    // 필터 상태 — 전략 전환 후에도 유지
    let statusFilter = 'all'; // all | error | goalmiss
    let diffFilter = 'all';   // all | easy | medium | hard
    let searchText = '';

    function applyFilters(items) {
      const q = searchText.trim().toLowerCase();
      return items.filter((it) => {
        if (statusFilter === 'error' && !(it.error || it.hasStepErrors)) return false;
        // 목표미달만: goalAchieved===0 (null=N/A는 미달 아님 — 제외)
        if (statusFilter === 'goalmiss' && it.metrics?.goalAchieved !== 0) return false;
        if (diffFilter !== 'all' && it.difficulty !== diffFilter) return false;
        if (q && !String(it.query || '').toLowerCase().includes(q)) return false;
        return true;
      });
    }

    const countLabel = el('span', { class: 'df-count' });

    function renderTable() {
      const s = strat.find((x) => x.id === selId) || strat[0];
      const items = s.items || [];
      if (!items.length) {
        countLabel.textContent = '';
        tableBox.replaceChildren(el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '항목이 없습니다.'));
        return;
      }
      const visible = applyFilters(items);
      countLabel.textContent = visible.length === items.length ? `${items.length}개` : `${visible.length} / ${items.length}개`;
      if (!visible.length) {
        tableBox.replaceChildren(el('div', { class: 'hint', style: { color: 'var(--tx3)', padding: '16px', textAlign: 'center' } }, '필터 조건에 맞는 항목이 없습니다.'));
        return;
      }

      const rows = visible.map((it) => {
        const { expMarks, actMarks } = diffMarks(it.expected || [], it.actual || []);
        return el('tr', { style: { cursor: 'pointer' }, onclick: () => openItemModal(s, it) },
          el('td', { style: { maxWidth: '260px' } }, el('div', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, it.query)),
          // 카테고리 뱃지 — badge(text)는 CATEGORY_COLORS('복합' 포함) 매칭, 미등록 카테고리는 dim 폴백
          el('td', {}, it.category ? badge(it.category) : el('span', { style: { color: 'var(--tx3)' } }, '-')),
          el('td', {}, workflowChips(it.expected || [], mcps, { marks: expMarks })),
          el('td', {}, (it.actual || []).length ? workflowChips(it.actual, mcps, { marks: actMarks }) : el('span', { class: 'hint', style: { color: 'var(--tx3)' } }, '(호출 없음)')),
          el('td', { class: 'num' }, fmt.pct(it.metrics?.f1)),
          el('td', { class: 'num' }, fmt.pct(it.metrics?.seqAccuracy)),
          el('td', { class: 'num' }, fmt.ms(it.latencyMs)),
          el('td', {}, it.error ? badge('오류', 'red') : it.hasStepErrors ? badge('부분 오류', 'amber') : badge('정상', 'green')));
      });

      tableBox.replaceChildren(el('div', { class: 'tbl-wrap' },
        el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {},
            el('th', {}, '질의'), el('th', {}, '카테고리'),
            el('th', {}, '기대 워크플로우'), el('th', {}, '실제 워크플로우'),
            el('th', {}, 'F1'), el('th', {}, '시퀀스'), el('th', {}, '지연'), el('th', {}, '상태'))),
          el('tbody', {}, rows))));
    }
    renderTable();

    /* 필터 바 — 상태 토글 · 난이도 select · 질의 검색 */
    const filterBar = el('div', { class: 'eval-detail-filters' },
      segmented([
        { label: '전체', value: 'all' },
        { label: '오류만', value: 'error' },
        { label: '목표미달만', value: 'goalmiss' },
      ], statusFilter, (v) => { statusFilter = v; renderTable(); }),
      el('select', {
        class: 'select',
        onchange: (e) => { diffFilter = e.target.value; renderTable(); },
      },
        el('option', { value: 'all' }, '난이도 전체'),
        el('option', { value: 'easy' }, DIFF_LABEL.easy),
        el('option', { value: 'medium' }, DIFF_LABEL.medium),
        el('option', { value: 'hard' }, DIFF_LABEL.hard)),
      el('input', {
        class: 'input', type: 'search', placeholder: '질의 검색…', style: { minWidth: '160px' },
        oninput: (e) => { searchText = e.target.value; renderTable(); },
      }),
      countLabel);

    return el('div', { class: 'card' },
      el('div', { class: 'row between', style: { marginBottom: '12px', flexWrap: 'wrap', gap: '8px' } },
        el('div', { class: 'panel-title', style: { margin: 0 } }, '항목별 상세', el('span', { class: 'sub' }, '행 클릭 시 실행 로그')),
        el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
          strat.length > 1 ? segmented(strat.map((s) => ({ label: s.strategyName, value: s.id })), selId, (v) => { selId = v; renderTable(); }) : null,
          // r8(§H4-6): 실행 시점 구성 스냅샷(run.numCtx/toolCount + 전략별 configSnapshot) 모달
          el('button', {
            class: 'btn btn-sm',
            title: '이 실행에 기록된 실행 환경(numCtx·전체 도구 수)과 전략별 구성 스냅샷을 확인합니다.',
            onclick: () => openConfigModal(run, strat),
          }, '⚙ 구성'))),
      filterBar,
      el('div', { class: 'hint', style: { marginBottom: '10px' } },
        '워크플로우 표식: ', el('span', { style: { color: 'var(--sig-red)' } }, '● 누락'), ' · ', el('span', { style: { color: 'var(--sig-amber)' } }, '● 초과')),
      tableBox);
  }

  /* ---------- 구성 스냅샷 모달 (r8 §H4-6) ---------- */
  // run.numCtx/toolCount + perStrategy.configSnapshot을 pretty JSON으로 노출.
  // 구버전 run(스냅샷·toolCount 미기록)은 크래시 없이 "기록 없음/스냅샷 없음" 안내.
  function openConfigModal(run, strat) {
    const preStyle = {
      fontFamily: 'var(--font-mono)', fontSize: '11.5px', lineHeight: '1.55', color: 'var(--tx1)',
      background: 'var(--bg2)', border: '1px solid var(--line-soft)', borderRadius: '6px',
      padding: '10px 12px', margin: 0, overflow: 'auto', maxHeight: '300px',
    };
    const runInfo = [
      `numCtx ${Number.isFinite(run.numCtx) ? Math.round(run.numCtx).toLocaleString('ko-KR') : '- (기록 없음)'}`,
      `전체 도구 ${Number.isFinite(run.toolCount) ? Math.round(run.toolCount).toLocaleString('ko-KR') + '개' : '- (기록 없음)'}`,
    ];
    if (run.model) runInfo.push(`모델 오버라이드 ${run.model}`);
    if (run.temperature != null) runInfo.push(`온도 통일 ${run.temperature}`);
    if (run.maxSteps != null) runInfo.push(`maxSteps 통일 ${run.maxSteps}`);
    const body = el('div', {},
      el('div', { class: 'fld' },
        el('label', {}, '실행 공통'),
        el('div', { style: { color: 'var(--tx1)', fontSize: '12.5px', lineHeight: 1.6 } }, runInfo.join(' · '))),
      ...strat.map((s) => el('div', { class: 'fld' },
        el('label', {}, `${s.strategyName} `, typeBadge(s.strategyType)),
        s.configSnapshot
          ? el('pre', { style: preStyle }, JSON.stringify(s.configSnapshot, null, 2))
          : el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '스냅샷 없음 — 이 실행(구버전)에는 전략 구성 스냅샷이 기록되지 않았습니다.'))),
      el('div', { class: 'hint', style: { marginTop: '4px' } },
        '실행 시점에 기록된 값입니다 — 이후 전략을 수정해도 이 스냅샷은 바뀌지 않아 결과 재현·비교에 사용할 수 있습니다.'));
    modal({ title: '⚙ 실행 구성 스냅샷', body, wide: true, actions: [{ label: '닫기', class: 'btn-ghost' }] });
  }

  /* ---------- 항목 상세 모달 ---------- */
  function openItemModal(s, it) {
    const { expMarks, actMarks } = diffMarks(it.expected || [], it.actual || []);
    const body = el('div', {},
      el('div', { class: 'fld' }, el('label', {}, '질의'), el('div', { style: { color: 'var(--tx0)', lineHeight: 1.6 } }, it.query)),
      el('div', { class: 'row', style: { gap: '8px', marginBottom: '14px', flexWrap: 'wrap' } },
        it.difficulty ? badge(DIFF_LABEL[it.difficulty] || it.difficulty, DIFF_KIND[it.difficulty] || 'dim') : null,
        it.metrics?.compositeScore != null ? badge(`품질점수 ${fmt.pct(it.metrics.compositeScore)}`, 'blue') : null,
        badge(`F1 ${fmt.pct(it.metrics?.f1)}`, 'blue'),
        // 목표 특정 불가(null) → N/A 표시(빨강 '목표미달' 금지)
        it.metrics?.goalAchieved == null
          ? badge('목표 —', 'dim')
          : badge(it.metrics.goalAchieved ? '목표달성 O' : '목표미달 X', it.metrics.goalAchieved ? 'green' : 'red'),
        it.metrics?.callSuccessRate != null ? badge(`도구성공률 ${fmt.pct(it.metrics.callSuccessRate)}`, 'dim') : null,
        badge(`시퀀스 ${fmt.pct(it.metrics?.seqAccuracy)}`, 'dim'),
        it.metrics?.exactMatch ? badge('완전일치', 'green') : null,
        it.metrics?.paramScore != null ? badge(`파라미터 ${fmt.pct(it.metrics.paramScore)}`, 'dim') : null,
        it.metrics?.matchedAlternative != null ? badge(`대안 정답 #${it.metrics.matchedAlternative + 1}`, 'blue') : null,
        // r8(§H4-4): 검색 리콜(retrievedTools 기록 문항만) + 목표 도구 미검색(goalRetrieved=false) 뱃지 — 구버전 run(키 부재)은 미표시
        it.metrics?.retrievalRecall != null
          ? el('span', { class: 'badge dim', title: '이 문항에서 정답 도구가 검색 후보(retrievedTools)에 포함된 비율 — 다중정답 후보 중 최대 커버리지' }, `검색리콜 ${fmt.pct(it.metrics.retrievalRecall)}`)
          : null,
        it.metrics?.goalRetrieved === false
          ? el('span', { class: 'badge amber', title: '목표(최종) 도구가 검색 후보(retrievedTools)에 포함되지 않았습니다 — 검색 단계 실패로, 플래너가 아무리 잘해도 목표 달성이 불가능한 문항입니다.' }, '목표도구 미검색')
          : null,
        (it.metrics?.inputTokens != null || it.metrics?.outputTokens != null)
          ? badge(`토큰 ${it.metrics?.tokensEstimated ? '≈' : ''}입력 ${fmtTok(it.metrics?.inputTokens)} · 출력 ${fmtTok(it.metrics?.outputTokens)}`, 'violet')
          : null,
        it.usedFallback ? badge('LLM 폴백', 'amber') : null,
        (it.hasStepErrors && !it.error) ? badge('부분 오류', 'amber') : null,
        // 신뢰도 뱃지 — 리더보드 ⚠ 뱃지와 동일 의미(문항 단위), title에 사유 표기
        it.metrics?.ctxOverflow === true
          ? el('span', { class: 'badge amber', title: '프롬프트가 numCtx를 넘어 잘렸을 가능성(추정 또는 실측) — 이 문항의 점수는 신뢰할 수 없습니다. numCtx 상향 또는 DB 전략을 권장합니다.' }, '⚠ctx')
          : null,
        it.metrics?.retrievalFallback
          ? el('span', { class: 'badge amber', title: String(it.metrics.retrievalFallback) }, '⚠폴백')
          : null,
        // 카탈로그 자동 축약 레벨 — 오류가 아닌 조건 표시(dim). 구버전 run(catalogDetail 없음)은 뱃지 없음
        (Number(it.metrics?.catalogDetail) || 0) > 0
          ? el('span', { class: 'badge dim', title: `카탈로그 자동 축약 레벨 L${it.metrics.catalogDetail} — 컨텍스트 예산에 맞춰 서버·도구는 전부 유지한 채 파라미터·설명 상세도만 낮춰 주입했습니다(오류 아님). numCtx를 높이면 상세도가 올라갑니다.` }, `축약 L${it.metrics.catalogDetail}`)
          : null,
        badge(fmt.ms(it.latencyMs), 'dim'),
        badge(`LLM ${it.llmCalls || 0}`, 'violet')),
      el('div', { class: 'diff-cols', style: { marginBottom: '14px' } },
        el('div', {}, el('h5', {}, '기대 워크플로우'), workflowChips(it.expected || [], mcps, { marks: expMarks })),
        el('div', {}, el('h5', {}, '실제 워크플로우'), (it.actual || []).length ? workflowChips(it.actual, mcps, { marks: actMarks }) : el('span', { class: 'hint', style: { color: 'var(--tx3)' } }, '(호출 없음)'))),
      it.error ? el('div', { class: 'fld' }, el('label', { style: { color: 'var(--sig-red)' } }, '오류'),
        el('div', { style: { color: '#ff9a8f', fontFamily: 'var(--font-mono)', fontSize: '12px', whiteSpace: 'pre-wrap' } }, it.error)) : null,
      it.finalAnswer ? el('div', { class: 'fld' }, el('label', {}, '최종 답변'),
        el('div', { style: { color: 'var(--tx1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' } }, it.finalAnswer)) : null,
      el('div', { class: 'fld' }, el('label', {}, '실행 로그 (trace)'), renderTrace(it.trace || [])));

    modal({ title: `${s.strategyName} · 항목 상세`, body, wide: true, actions: [{ label: '닫기', class: 'btn-ghost' }] });
  }

  /* ---------- trace 로그 렌더 ---------- */
  function renderTrace(trace) {
    if (!trace.length) return el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '(로그 없음)');
    const TAG = {
      info: ['info', 'INFO'], 'llm-request': ['llm', 'LLM→'], 'llm-response': ['llm', 'LLM←'],
      'tool-call': ['tool', 'TOOL'], 'tool-result': ['ok', 'RESULT'], error: ['err', 'ERR'],
    };
    return el('div', { class: 'trace-log' }, trace.map((ev) => {
      const [cls, label] = TAG[ev.type] || ['info', (ev.type || '').toUpperCase()];
      return el('div', { class: 'trace-line' },
        el('span', { class: 'trace-ts' }, fmtTraceTs(ev.ts)),
        el('span', { class: `trace-tag ${cls}` }, label),
        el('div', { class: 'trace-msg' }, ev.label || '',
          ev.detail ? el('details', {}, el('summary', {}, '상세'), el('pre', {}, ev.detail)) : null));
    }));
  }

  function fmtTraceTs(ts) {
    if (ts == null) return '';
    if (typeof ts === 'number') {
      if (ts > 1e12) { const d = new Date(ts); return d.toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
      return Math.round(ts) + 'ms';
    }
    return String(ts).slice(0, 14);
  }

  /* ---------- 내보내기 ---------- */
  function exportJSON(run) {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `eval-${(run.name || 'run').replace(/[^\w가-힣-]+/g, '_')}.json`);
    toast('JSON 파일을 내보냈습니다.', 'success');
  }

  function exportCSV(run) {
    const header = ['전략', '타입', '항목ID', '질의', '기대워크플로우', '실제워크플로우',
      'precision', 'recall', 'f1', 'seqAccuracy', 'exactMatch', 'paramScore',
      'callSuccessRate', 'extraToolRate', 'goalAchieved', 'compositeScore',
      'inputTokens', 'outputTokens', 'latencyMs', 'llmCalls', '오류',
      // r7 신규(맨 뒤 추가 — 기존 열 위치 보존): 신뢰도 플래그 + 검색 리콜. 구버전 run은 빈 값.
      'ctxOverflow', 'retrievalFallback', 'catalogDetail', 'retrievalRecall'];
    const rows = [header];
    for (const id of run.strategyIds || []) {
      const ps = run.perStrategy?.[id];
      if (!ps) continue;
      for (const it of ps.items || []) {
        const wf = (arr) => (arr || []).map((x) => `${x.serverId}/${x.toolName}`).join(' > ');
        const m = it.metrics || {};
        rows.push([
          ps.strategyName, ps.strategyType || '', it.itemId || '', it.query || '',
          wf(it.expected), wf(it.actual),
          num(m.precision), num(m.recall), num(m.f1), num(m.seqAccuracy),
          m.exactMatch ?? '', m.paramScore == null ? '' : num(m.paramScore),
          m.callSuccessRate == null ? '' : num(m.callSuccessRate),
          m.extraToolRate == null ? '' : num(m.extraToolRate),
          m.goalAchieved == null ? '' : m.goalAchieved,
          m.compositeScore == null ? '' : num(m.compositeScore),
          m.inputTokens == null ? '' : Math.round(m.inputTokens),
          m.outputTokens == null ? '' : Math.round(m.outputTokens),
          Math.round(it.latencyMs || 0), it.llmCalls || 0, it.error || '',
          m.ctxOverflow == null ? '' : m.ctxOverflow,
          m.retrievalFallback == null ? '' : String(m.retrievalFallback),
          m.catalogDetail == null ? '' : m.catalogDetail,
          m.retrievalRecall == null ? '' : num(m.retrievalRecall),
        ]);
      }
    }
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `eval-${(run.name || 'run').replace(/[^\w가-힣-]+/g, '_')}.csv`);
    toast('CSV 파일을 내보냈습니다.', 'success');
  }

  function num(v) { return v == null ? '' : Number(v).toFixed(4); }
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    // 수식 주입 방지: 위험 문자(= + - @ 탭 CR)로 시작하면 ' 프리픽스
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function triggerDownload(blob, filename) {
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
}
