// 실시간 테스트 플레이그라운드 — 전략 다중 선택 → 질의 병렬 실행 → 결과 비교 + 히스토리
// 오케스트레이션 편집기의 테스트 콘솔과 별개의 전용 화면. 무상태 단건 실행(executeStrategy)을
// 여러 전략에 대해 동시(Promise.all)로 수행하고, 각 전략별 개별 AbortController로 중단을 제어한다.
//
// 두 가지 모드를 지원한다.
//  · 자유 질의   : 정답이 없는 임의 질의 → 전략별 답변/워크플로우 비교만(채점 없음, 기존 동작).
//  · 벤치마크 문항: 벤치마크 세트→문항 선택 → 질의 자동 채움 + 기대 워크플로우/목표도구 표시.
//                  실행 후 evaluator.scoreItem으로 정답 대조 채점(F1·목표달성·도구성공률·토큰·종합점수).
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import { el, badge, fmt, toast, spinner, emptyState, workflowChips, downloadJSON, segmented, field } from '../core/ui.js';
import { executeStrategy } from '../services/orchestrator.js';
import { scoreItem } from '../services/evaluator.js';

// 전략 타입 → 뱃지 라벨/색 (오케스트레이션 스튜디오 TYPE_META와 동일 색 체계)
const TYPE_META = {
  prompt: { label: '프롬프트', kind: 'green' },
  skill: { label: '스킬', kind: 'blue' },
  rule: { label: '룰', kind: 'amber' },
  db: { label: 'DB', kind: 'violet' },
};
function typeBadge(type) {
  const m = TYPE_META[type] || { label: type || '?', kind: 'dim' };
  return badge(m.label, m.kind);
}

// 난이도 → 라벨/색 (evaluation.js와 동일 체계)
const DIFF_LABEL = { easy: '쉬움', medium: '보통', hard: '어려움' };
const DIFF_KIND = { easy: 'green', medium: 'amber', hard: 'red' };

// 트레이스 이벤트 타입 → CSS 태그/라벨 (orchestration.js와 동일하게 재현)
const TRACE_TAG = { 'info': 'info', 'llm-request': 'llm', 'llm-response': 'llm', 'tool-call': 'tool', 'tool-result': 'ok', 'error': 'err' };
const TRACE_LABEL = { 'info': 'INFO', 'llm-request': 'LLM▸', 'llm-response': '▸LLM', 'tool-call': 'TOOL', 'tool-result': 'DONE', 'error': 'ERR' };

/* ============================================================
   벤치마크 대조 모드 — 채점 헬퍼
   채점은 evaluator.scoreItem을 단일 소스로 사용한다. evaluator는 이제 목표달성(goalAchieved,
   목표 특정 불가 시 null)·도구성공률(callSuccessRate)·품질점수(compositeScore)를 직접 반환하므로
   그 값을 그대로 신뢰한다(값이 null이면 N/A로 구분 유지). 아래 로컬 파생 계산(computeGoalAchieved 등)은
   구버전 evaluator가 해당 키를 주지 않을 때만 쓰는 폴백 가드이다. 토큰(input/output/estimated)은
   실행 결과(res)에서 가져온다.
   ============================================================ */

// 문자열/숫자 느슨한 동등 비교 — 목표도구 params 매칭용(evaluator.paramValEq의 축약판)
function looseParamEq(ev, av) {
  if (ev == null && av == null) return true;
  if ((ev && typeof ev === 'object') || (av && typeof av === 'object')) {
    try { return JSON.stringify(ev) === JSON.stringify(av); } catch { return false; }
  }
  const es = String(ev ?? '').trim();
  const as = String(av ?? '').trim();
  const en = Number(es), an = Number(as);
  if (es !== '' && as !== '' && !Number.isNaN(en) && !Number.isNaN(an)) return en === an;
  return es.toLowerCase() === as.toLowerCase();
}

// 목표 step의 params 매칭 비율(키가 없으면 1)
function paramMatchRatio(expParams, actParams) {
  const keys = Object.keys(expParams || {});
  if (!keys.length) return 1;
  const ap = actParams || {};
  let m = 0;
  for (const k of keys) if (looseParamEq(expParams[k], ap[k])) m++;
  return m / keys.length;
}

// 목표 도구 결정: item.goal 우선, 없으면 채택된 gold 시퀀스의 마지막 step
function resolveGoal(item, matchedAlternative) {
  if (item.goal && item.goal.serverId && item.goal.toolName) return item.goal;
  const gold = (matchedAlternative != null && Array.isArray(item.alternatives?.[matchedAlternative]))
    ? item.alternatives[matchedAlternative]
    : (Array.isArray(item.expected) ? item.expected : []);
  return gold.length ? gold[gold.length - 1] : null;
}

// 목표 달성(0/1): 목표도구 id가 실패 없이 실행 && (목표에 params 있으면 매칭 ≥ 0.5). 목표 특정 불가 시 null.
function computeGoalAchieved(item, steps, matchedAlternative) {
  const goal = resolveGoal(item, matchedAlternative);
  if (!goal) return null;
  const goalId = `${goal.serverId}/${goal.toolName}`;
  const hit = (steps || []).find((s) => `${s.serverId}/${s.toolName}` === goalId && !s.error);
  if (!hit) return 0;
  const gp = (goal.params && Object.keys(goal.params).length) ? goal.params : null;
  if (gp && paramMatchRatio(gp, hit.params) < 0.5) return 0;
  return 1;
}

// 도구 호출 성공률: (호출수 - 실패수)/호출수, 호출 0이면 null. 실패 = step.error 존재.
function computeCallSuccessRate(steps) {
  const n = (steps || []).length;
  if (!n) return null;
  const fail = steps.filter((s) => s && s.error).length;
  return (n - fail) / n;
}

// 한 전략 결과를 벤치마크 문항으로 채점 → 표시/내보내기용 통합 지표 객체
function scoreEntryMetrics(item, res) {
  const steps = res?.steps || [];
  // 계약 §8 시그니처. evaluator가 goal을 소비해 goalAchieved(null 가능)를 직접 채점한다.
  const scored = scoreItem(item.expected || [], steps, {
    ordered: item.ordered, alternatives: item.alternatives, goal: item.goal,
  });
  // evaluator 반환값을 단일 소스로 신뢰(값이 null이어도 의도된 N/A로 유지). 키 자체가 없을 때만(구버전) 로컬 폴백.
  const pick = (k, fb) => (Object.prototype.hasOwnProperty.call(scored, k) && scored[k] !== undefined) ? scored[k] : fb();
  const callSuccessRate = pick('callSuccessRate', () => computeCallSuccessRate(steps));
  const goalAchieved = pick('goalAchieved', () => computeGoalAchieved(item, steps, scored.matchedAlternative));
  const f1 = (typeof scored.f1 === 'number' && Number.isFinite(scored.f1)) ? scored.f1 : 0;
  const paramScore = scored.paramScore; // null 가능
  // 품질점수는 evaluator가 N/A 항목 가중치를 제외해 재정규화한 값을 우선 사용. 폴백은 단순 근사(구버전 대비).
  const compositeScore = pick('compositeScore',
    () => 0.4 * f1 + 0.3 * (goalAchieved || 0) + 0.15 * (callSuccessRate ?? 1) + 0.15 * (paramScore ?? 1));
  return {
    ...scored,
    f1,
    callSuccessRate,
    goalAchieved,
    compositeScore,
    inputTokens: res?.inputTokens ?? null,   // 아직 미계측일 수 있어 ?? null 가드
    outputTokens: res?.outputTokens ?? null,
    tokensEstimated: res?.tokensEstimated ?? null,
  };
}

// 기대 vs 실제 워크플로우 diff 마킹(누락=miss/빨강, 잉여=extra/노랑). evaluation.js와 동일 로직.
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

function truncateText(s, n) {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// 토큰 표시(천단위 구분 + 추정치면 ≈ 프리픽스). evaluation.js fmtTok 규칙과 동일하게 재현(U4).
function fmtTokens(v, estimated) {
  if (v == null) return '-';
  return (estimated ? '≈' : '') + Math.round(v).toLocaleString('ko-KR');
}

// 뷰 전용 확장 스타일 1회 주입(다크 테마 톤). id로 중복 주입 방지.
function ensureStyles() {
  if (document.getElementById('rbtl-playground-ext')) return;
  const css = `
.pg-bench-select { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px; }
@media (max-width:560px){ .pg-bench-select{ grid-template-columns:1fr; } }
.pg-bench-panel { background:var(--bg2); border:1px solid var(--line-soft); border-radius:10px; padding:12px 14px; margin-bottom:12px; }
.pg-exp-block { margin-top:8px; }
.pg-diff-label { font-size:11px; color:var(--tx2); letter-spacing:.04em; margin-bottom:5px; font-weight:600; }
.pg-goal { font-family:var(--font-mono); font-size:12.5px; color:var(--tx0); background:var(--bg1); border:1px solid var(--line-soft); padding:3px 8px; border-radius:6px; display:inline-block; }
.pg-score { margin-top:10px; padding:12px; border:1px solid var(--line-soft); border-radius:10px; background:linear-gradient(180deg, rgba(167,139,250,.07), transparent); }
.pg-score-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:8px; }
.pg-comp { display:flex; align-items:baseline; gap:8px; }
.pg-comp-label { font-size:11px; color:var(--tx2); letter-spacing:.04em; }
.pg-comp-val { font-family:var(--font-mono); font-size:24px; font-weight:700; line-height:1; }
.pg-score-diff { margin-top:10px; display:grid; gap:8px; }
.pg-diff-legend { color:var(--tx3); font-size:11.5px; }
`;
  document.head.appendChild(el('style', { id: 'rbtl-playground-ext' }, css));
}

export async function render(container, ctx) {
  ensureStyles();
  const strategies = store.get('strategies') || [];
  const mcps = store.get('mcps') || [];
  const benchmarks = store.get('benchmarks') || [];   // 벤치마크 세트 목록(대조 모드용)

  // 실행할 전략이 하나도 없으면 안내 후 종료
  if (!strategies.length) {
    container.replaceChildren(el('div', { class: 'card' }, emptyState({
      icon: '⚡', title: '등록된 전략이 없습니다',
      desc: '먼저 오케스트레이션에서 전략을 만든 뒤, 여기서 여러 전략을 골라 실시간으로 비교 테스트하세요.',
      action: { label: '오케스트레이션으로 이동', onClick: () => router.navigate('/orchestration') },
    })));
    return () => {};
  }

  const selectedIds = new Set();      // 현재 선택된 전략 id
  const history = [];                 // 실행 블록 목록(최신이 앞)
  let running = false;                // 실행 진행 중 여부(동시에 하나의 블록만 실행)
  let activeControllers = null;       // 현재 실행 중인 블록의 AbortController 배열(전체 중단용)

  // 모드/벤치마크 선택 상태
  let mode = 'free';                  // 'free'(자유 질의) | 'bench'(벤치마크 문항)
  let benchSet = null;                // 현재 선택된 벤치마크 세트
  let benchItem = null;               // 현재 선택된 문항

  /* ---------- 전략 선택 카드 ---------- */
  const stratList = el('div', { class: 'pick-list' });
  const selCount = el('span', { class: 'sub' }, '0개 선택됨');

  function renderStratPicker() {
    stratList.replaceChildren(...strategies.map((s) => {
      const on = selectedIds.has(s.id);
      return el('label', { class: 'pick' + (on ? ' on' : '') },
        el('input', {
          type: 'checkbox', checked: on,
          onchange: (e) => { e.target.checked ? selectedIds.add(s.id) : selectedIds.delete(s.id); renderStratPicker(); updateRunState(); },
        }),
        el('div', { class: 'pick-main' },
          el('div', { class: 'pick-name' }, s.name || '(이름 없음)', typeBadge(s.type)),
          el('div', { class: 'pick-sub' }, `수정 ${fmt.date(s.updatedAt || s.createdAt)}`)));
    }));
    selCount.textContent = `${selectedIds.size}개 선택됨`;
  }

  const selectAllBtn = el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { strategies.forEach((s) => selectedIds.add(s.id)); renderStratPicker(); updateRunState(); } }, '전체 선택');
  const clearAllBtn = el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { selectedIds.clear(); renderStratPicker(); updateRunState(); } }, '전체 해제');

  const selectCard = el('div', { class: 'card' },
    el('div', { class: 'row between', style: { marginBottom: '10px', flexWrap: 'wrap', gap: '8px' } },
      el('div', { class: 'panel-title', style: { margin: 0 } }, '전략 선택', selCount),
      el('div', { class: 'row', style: { gap: '6px' } }, selectAllBtn, clearAllBtn)),
    stratList);

  /* ---------- 질의 입력 카드 ---------- */
  const queryInput = el('input', { class: 'input', placeholder: '예: 경부선 KTX 지연 알려줘' });
  queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runFromInput(); });
  const runBtn = el('button', { class: 'btn btn-primary', onclick: runFromInput }, '▶ 실행');
  const stopBtn = el('button', { class: 'btn btn-danger', style: { display: 'none' }, onclick: () => activeControllers?.forEach((c) => c.abort()) }, '■ 중단');
  const runHint = el('div', { class: 'hint' }, '선택한 전략을 동시에 실행해 결과를 나란히 비교합니다.');

  // 모드 토글: 자유 질의 | 벤치마크 문항
  const modeToggle = segmented(
    [{ label: '자유 질의', value: 'free' }, { label: '벤치마크 문항', value: 'bench' }],
    mode, (v) => { mode = v; applyMode(); });

  // 벤치마크 세트/문항 드롭다운(벤치마크 모드에서만 표시)
  const benchSetSel = el('select', { class: 'input', onchange: onBenchSetChange });
  const benchItemSel = el('select', { class: 'input', onchange: onBenchItemChange });
  const benchSelectRow = el('div', { class: 'pg-bench-select', style: { display: 'none' } },
    field({ label: '벤치마크 세트', input: benchSetSel }),
    field({ label: '문항', input: benchItemSel }));
  const benchExpect = el('div', { class: 'pg-bench-panel', style: { display: 'none' } });

  function populateBenchSets() {
    benchSetSel.replaceChildren(
      el('option', { value: '' }, benchmarks.length ? '세트 선택…' : '저장된 벤치마크 세트 없음'),
      ...benchmarks.map((s) => el('option', { value: s.id }, `${s.name} (${(s.items || []).length}문항)`)));
    benchSetSel.disabled = !benchmarks.length;
  }
  function populateBenchItems() {
    const items = benchSet?.items || [];
    benchItemSel.replaceChildren(
      el('option', { value: '' }, items.length ? '문항 선택…' : '문항 없음'),
      ...items.map((it, i) => el('option', { value: it.id }, `${i + 1}. ${truncateText(it.query, 46)}`)));
    benchItemSel.disabled = !items.length;
  }
  function onBenchSetChange() {
    benchSet = benchmarks.find((s) => s.id === benchSetSel.value) || null;
    benchItem = null;
    populateBenchItems();
    renderExpect();
    updateRunState();
  }
  function onBenchItemChange() {
    benchItem = (benchSet?.items || []).find((it) => it.id === benchItemSel.value) || null;
    if (benchItem) queryInput.value = benchItem.query;   // 선택 시 query 자동 채움
    renderExpect();
    updateRunState();
  }

  // 선택 문항의 기대 워크플로우/대안/목표도구/메타 카드 렌더
  function renderExpect() {
    if (mode !== 'bench' || !benchItem) { benchExpect.style.display = 'none'; benchExpect.replaceChildren(); return; }
    const it = benchItem;
    const goal = (it.goal && it.goal.serverId) ? it.goal : null;
    const goalServer = goal ? mcps.find((m) => m.id === goal.serverId) : null;
    // 대안 정규화: 배열(기존) 또는 {steps, goal?} 객체(신규) 형태 모두 표시.
    // 원본 인덱스(idx)를 유지해 결과 카드의 '대안 정답 #N' 뱃지 번호와 일치시킨다(evaluator의 matchedAlternative와 동일 기준).
    const alts = (Array.isArray(it.alternatives) ? it.alternatives : [])
      .map((a, idx) => {
        const steps = Array.isArray(a) ? a : (a && Array.isArray(a.steps) ? a.steps : null);
        if (!steps || !steps.length) return null;
        const g = (!Array.isArray(a) && a.goal && typeof a.goal === 'object' && (a.goal.serverId || a.goal.toolName)) ? a.goal : null;
        return { idx, steps, goal: g };
      })
      .filter(Boolean);
    benchExpect.replaceChildren(
      el('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } },
        it.category ? badge(it.category) : null,
        it.difficulty ? badge(DIFF_LABEL[it.difficulty] || it.difficulty, DIFF_KIND[it.difficulty] || 'dim') : null,
        badge(it.ordered === false ? '순서 무관' : '순서 중요', 'dim'),
        alts.length ? badge(`대안 정답 ${alts.length}개`, 'blue') : null),
      el('div', { class: 'pg-exp-block' },
        el('div', { class: 'pg-diff-label' }, '기대 워크플로우'),
        workflowChips(it.expected || [], mcps)),
      ...alts.map((a) => {
        const gs = a.goal ? mcps.find((m) => m.id === a.goal.serverId) : null;
        return el('div', { class: 'pg-exp-block' },
          el('div', { class: 'pg-diff-label' }, `대안 #${a.idx + 1}`,
            // 객체 대안의 자체 goal 소표기 — 이 대안이 채택되면 이 목표로 목표 달성률을 채점
            a.goal ? el('span', { style: { color: 'var(--tx3)', fontWeight: 400 } },
              ` · 목표: ${gs ? gs.icon + ' ' + gs.nameKo : (a.goal.serverId || '?')} / ${a.goal.toolName || '?'}`) : null),
          workflowChips(a.steps, mcps));
      }),
      el('div', { class: 'pg-exp-block' },
        el('div', { class: 'pg-diff-label' }, '목표 도구'),
        goal
          ? el('span', { class: 'pg-goal' }, `${goalServer ? goalServer.icon + ' ' + goalServer.nameKo : goal.serverId} / ${goal.toolName}`)
          : el('span', { class: 'hint', style: { color: 'var(--tx3)' } },
              it.ordered === false
                ? '명시 없음 · 순서 무관 → 정답 도구 전부 완수를 목표로 간주'
                : '명시 없음 → 기대 워크플로우의 마지막 단계를 목표로 간주')),
      it.notes ? el('div', { class: 'hint', style: { marginTop: '8px', color: 'var(--tx3)' } }, it.notes) : null);
    benchExpect.style.display = '';
  }

  // 모드 전환 반영(드롭다운/기대 패널 표시 토글)
  function applyMode() {
    const bench = mode === 'bench';
    benchSelectRow.style.display = bench ? '' : 'none';
    benchExpect.style.display = (bench && benchItem) ? '' : 'none';
    queryInput.placeholder = bench ? '문항 선택 시 자동 입력됩니다(수정 가능)' : '예: 경부선 KTX 지연 알려줘';
    updateRunState();
  }

  const queryCard = el('div', { class: 'card' },
    el('div', { class: 'row between', style: { marginBottom: '10px', flexWrap: 'wrap', gap: '8px' } },
      el('div', { class: 'panel-title', style: { margin: 0 } }, '질의 실행'),
      modeToggle),
    benchSelectRow,
    benchExpect,
    el('div', { class: 'row', style: { gap: '8px' } }, el('div', { class: 'grow' }, queryInput), runBtn, stopBtn),
    runHint);

  function updateRunState() {
    const needItem = mode === 'bench' && !benchItem;
    runBtn.disabled = running || selectedIds.size === 0 || needItem;
    if (selectedIds.size === 0) runHint.textContent = '실행할 전략을 1개 이상 선택하세요.';
    else if (needItem) runHint.textContent = '대조할 벤치마크 문항을 선택하세요.';
    else if (mode === 'bench') runHint.textContent = `선택한 전략 ${selectedIds.size}개를 실행하고 정답 워크플로우와 대조·채점합니다.`;
    else runHint.textContent = `선택한 전략 ${selectedIds.size}개를 동시에 실행해 결과를 나란히 비교합니다.`;
  }

  /* ---------- 히스토리 영역 ---------- */
  const historyBody = el('div', {});
  const historyEmpty = el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '아직 실행한 질의가 없습니다. 위에서 전략을 고르고 질의를 실행하세요.');
  const historyCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, '대화 히스토리', el('span', { class: 'sub' }, '최신 질의가 위에 표시됩니다')),
    historyBody);
  function refreshHistoryEmpty() {
    if (!history.length && !historyBody.contains(historyEmpty)) historyBody.replaceChildren(historyEmpty);
  }

  container.replaceChildren(el('div', { class: 'stack', style: { gap: '16px' } }, selectCard, queryCard, historyCard));
  renderStratPicker();
  populateBenchSets();
  populateBenchItems();
  updateRunState();
  refreshHistoryEmpty();

  /* ---------- 실행 진입 ---------- */
  function runFromInput() {
    const q = queryInput.value.trim();
    if (!q) { toast('테스트 질의를 입력하세요.', 'warn'); queryInput.focus(); return; }
    if (!selectedIds.size) { toast('전략을 1개 이상 선택하세요.', 'warn'); return; }
    if (mode === 'bench' && !benchItem) { toast('벤치마크 문항을 선택하세요.', 'warn'); return; }
    const chosen = strategies.filter((s) => selectedIds.has(s.id));
    // 벤치마크 모드면 채점 대상 문항을 함께 캡처(재실행 시에도 동일 문항으로 채점)
    const bench = (mode === 'bench' && benchItem) ? { item: benchItem, setName: benchSet?.name || null } : null;
    startBlock(q, chosen, bench);
  }

  function startBlock(query, chosenStrategies, bench = null) {
    if (running) { toast('이미 실행 중입니다. 완료 후 다시 시도하세요.', 'warn'); return; }
    if (!chosenStrategies.length) { toast('실행할 전략이 없습니다.', 'warn'); return; }
    const block = buildBlock(query, chosenStrategies, bench);
    history.unshift(block);
    if (historyBody.contains(historyEmpty)) historyBody.replaceChildren();
    historyBody.prepend(block.node);
    executeBlock(block);
  }

  /* ---------- 블록(질의 1건) 구성 ---------- */
  function buildBlock(query, chosenStrategies, bench = null) {
    const snapshot = JSON.parse(JSON.stringify(chosenStrategies)); // 재실행 시 당시 전략 구성을 그대로 사용
    const entries = snapshot.map((s) => makeStrategyCard(s));
    const executedAt = new Date().toISOString();
    const benchItemRef = bench?.item || null;   // 채점 기준 문항(있으면 벤치마크 모드 블록)

    const rerunBtn = el('button', { class: 'btn btn-sm btn-ghost', title: '이 질의를 같은 전략들로 현재 MCP 카탈로그·인덱스 상태에서 다시 실행', onclick: () => startBlock(query, snapshot, bench) }, '↻ 재실행');
    const exportBtn = el('button', { class: 'btn btn-sm btn-ghost', title: '이 질의의 전략별 결과(벤치마크 모드면 채점 포함)를 JSON으로 내보내기', onclick: () => exportBlock(block) }, '⬇ JSON');
    const deleteBtn = el('button', { class: 'btn btn-sm btn-danger', title: '이 질의 기록 삭제', onclick: () => deleteBlock(block) }, '🗑 삭제');

    // 헤더: 질의 + (벤치마크 모드면 세트/난이도 배지) + 실행 시각
    const metaChips = el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', alignItems: 'baseline' } },
      el('span', { style: { fontSize: '11.5px', color: 'var(--tx3)', letterSpacing: '.03em' } }, '질의'),
      el('b', { style: { color: 'var(--tx0)', fontSize: '15px' } }, query),
      benchItemRef ? badge('벤치마크', 'violet') : null,
      benchItemRef && bench.setName ? el('span', { class: 'hint', style: { color: 'var(--tx3)' } }, bench.setName) : null,
      benchItemRef && benchItemRef.difficulty ? badge(DIFF_LABEL[benchItemRef.difficulty] || benchItemRef.difficulty, DIFF_KIND[benchItemRef.difficulty] || 'dim') : null,
      el('span', { class: 'hint', style: { color: 'var(--tx3)' } }, fmt.date(executedAt)));

    const node = el('div', { style: { marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--line-soft)' } },
      el('div', { class: 'row between', style: { marginBottom: '12px', flexWrap: 'wrap', gap: '10px' } },
        metaChips,
        el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, rerunBtn, exportBtn, deleteBtn)),
      // 선택 전략 수에 맞춘 적응형 열(빈 칸·높이 불균일 완화). 1개=1열, 그 외 최소 320px 자동 채움
      el('div', {
        class: 'grid',
        style: { gridTemplateColumns: entries.length <= 1 ? '1fr' : 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' },
      }, ...entries.map((e) => e.card)));

    const block = { query, executedAt, entries, node, controllers: null, bench, benchItem: benchItemRef };
    return block;
  }

  function deleteBlock(block) {
    block.controllers?.forEach((c) => c.abort());
    const i = history.indexOf(block);
    if (i >= 0) history.splice(i, 1);
    block.node.remove();
    refreshHistoryEmpty();
  }

  function exportBlock(block) {
    const item = block.benchItem;
    const payload = {
      query: block.query,
      executedAt: block.executedAt,
      mode: item ? 'benchmark' : 'free',
      // 벤치마크 모드면 채점 기준(정답/목표/대안)도 함께 기록
      benchmark: item ? {
        setName: block.bench?.setName || null,
        itemId: item.id,
        query: item.query,
        category: item.category || null,
        difficulty: item.difficulty || null,
        ordered: item.ordered !== false,
        goal: item.goal || null,
        expected: item.expected || [],
        alternatives: item.alternatives || null,
      } : null,
      results: block.entries.map((e) => {
        const sc = e.scored;   // 벤치마크 모드에서만 채워짐
        const row = {
          name: e.strategy.name,
          type: e.strategy.type,
          ok: e.result ? !!e.result.ok : null,
          steps: (e.result?.steps || []).map((s) => ({ serverId: s.serverId, toolName: s.toolName, error: s.error || null })),
          finalAnswer: e.result?.finalAnswer || null,
          llmCalls: e.result?.llmCalls || 0,
          totalLatencyMs: e.result?.totalLatencyMs || 0,
          inputTokens: e.result?.inputTokens ?? null,
          outputTokens: e.result?.outputTokens ?? null,
        };
        if (sc && item) {
          const { expMarks, actMarks } = diffMarks(item.expected || [], e.result?.steps || []);
          const idOf = (s) => `${s.serverId}/${s.toolName}`;
          row.score = {
            compositeScore: sc.compositeScore,
            f1: sc.f1,
            precision: sc.precision,
            recall: sc.recall,
            seqAccuracy: sc.seqAccuracy,
            exactMatch: sc.exactMatch,
            paramScore: sc.paramScore,
            callSuccessRate: sc.callSuccessRate,
            goalAchieved: sc.goalAchieved,
            matchedAlternative: sc.matchedAlternative,
            inputTokens: sc.inputTokens,
            outputTokens: sc.outputTokens,
            tokensEstimated: sc.tokensEstimated,
            missing: (item.expected || []).filter((_, i) => expMarks[i] === 'miss').map(idOf),   // 누락 도구
            extra: (e.result?.steps || []).filter((_, i) => actMarks[i] === 'extra').map(idOf),   // 잉여 도구
          };
        }
        return row;
      }),
    };
    const slug = (block.query || 'query').replace(/\s+/g, '-').slice(0, 40);
    downloadJSON(payload, `playground-${slug}.json`);
    toast('결과를 JSON으로 내보냈습니다.', 'success');
  }

  /* ---------- 전략 결과 카드 ---------- */
  function makeStrategyCard(strategy) {
    const statusSlot = el('span', {}, badge('대기 중', 'dim'));
    const bodySlot = el('div', { class: 'stack', style: { marginTop: '10px', gap: '8px' } });
    const traceLog = el('div', { class: 'trace-log' });
    const card = el('div', { class: 'card', style: { background: 'var(--bg1)' } },
      el('div', { class: 'row between', style: { gap: '8px' } },
        el('div', { class: 'row', style: { gap: '8px', minWidth: 0 } }, typeBadge(strategy.type),
          el('b', { style: { color: 'var(--tx0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, strategy.name || '(이름 없음)')),
        statusSlot),
      bodySlot,
      el('details', { style: { marginTop: '10px' } }, el('summary', { class: 'hint' }, '실행 트레이스'), traceLog));
    return { strategy, card, statusSlot, bodySlot, traceLog, result: null, scored: null };
  }

  function setCardLoading(entry) {
    entry.statusSlot.replaceChildren(badge('실행 중', 'blue'));
    entry.bodySlot.replaceChildren(el('div', { class: 'row', style: { color: 'var(--tx2)' } }, spinner(), el('span', {}, '실행 중…')));
    entry.traceLog.replaceChildren();
  }

  function renderCardResult(entry, res, benchItemRef) {
    entry.statusSlot.replaceChildren(resultBadge(res));
    const kids = [];
    if (res.error) kids.push(el('div', { class: 'hint', style: { color: 'var(--sig-red)' } }, res.error));
    else if (res.hasStepErrors) kids.push(el('div', { class: 'hint', style: { color: 'var(--sig-amber)' } }, '일부 단계에서 도구 오류가 발생했습니다(관찰로 전달되어 실행은 계속됨).'));
    if (res.usedFallback) kids.push(el('div', { class: 'hint' }, '⚙ 매치되는 룰이 없어 LLM 플래너로 폴백했습니다.'));

    // 호출된 워크플로우(실행 관점: 오류 단계는 miss로 표시)
    if (res.steps?.length) {
      kids.push(workflowChips(res.steps, mcps, { marks: res.steps.map((s) => (s.error ? 'miss' : '')) }));
    } else {
      kids.push(el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '(호출된 도구 없음)'));
    }

    // 벤치마크 모드: 정답 대조 채점 섹션(자유질의 모드에선 표시하지 않음)
    if (benchItemRef) {
      const scored = scoreEntryMetrics(benchItemRef, res);
      entry.scored = scored;
      kids.push(buildScoreSection(benchItemRef, res, scored));
    } else {
      entry.scored = null;
    }

    // DB 전략: 검색 방식·도구 수 표기(트레이스에서 추출)
    const dbInfo = entry.strategy.type === 'db' ? extractDbInfo(res) : null;
    if (dbInfo) kids.push(el('div', { class: 'hint', style: { color: 'var(--sig-violet)' } }, `🗄️ ${dbInfo.label}`));

    if (res.finalAnswer) {
      kids.push(el('div', { class: 'result-answer' },
        el('div', { class: 'panel-title', style: { margin: '0 0 6px' } }, '최종 답변'),
        el('div', { style: { whiteSpace: 'pre-wrap', color: 'var(--tx1)' } }, res.finalAnswer)));
    }

    const metrics = [
      stat('LLM 호출', String(res.llmCalls || 0)),
      stat('지연', fmt.ms(res.totalLatencyMs)),
      stat('단계', String(res.steps?.length || 0)),
    ];
    if (dbInfo) metrics.push(stat('검색 도구', String(dbInfo.count)));
    kids.push(el('div', { class: 'row wrap', style: { gap: '20px', marginTop: '4px' } }, ...metrics));

    entry.bodySlot.replaceChildren(...kids);
  }

  // 벤치마크 채점 섹션: 종합점수 강조 + 목표달성 O/X + 지표 + 기대 vs 실제 diff
  function buildScoreSection(item, res, scored) {
    const steps = res?.steps || [];
    const expected = item.expected || [];
    const { expMarks, actMarks } = diffMarks(expected, steps);

    const comp = scored.compositeScore;
    const compColor = comp >= 0.8 ? 'var(--sig-green)' : comp >= 0.5 ? 'var(--sig-amber)' : 'var(--sig-red)';
    const goalBadge = scored.goalAchieved == null
      ? badge('목표 —', 'dim')
      : scored.goalAchieved ? badge('✓ 목표 달성', 'green') : badge('✗ 목표 미달', 'red');

    const head = el('div', { class: 'pg-score-head' },
      el('div', { class: 'pg-comp' },
        el('span', { class: 'pg-comp-label' }, '종합점수'),
        el('span', { class: 'pg-comp-val', style: { color: compColor } }, fmt.pct(comp))),
      el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
        goalBadge,
        scored.matchedAlternative != null ? badge(`대안 정답 #${scored.matchedAlternative + 1}`, 'blue') : null));

    const metrics = el('div', { class: 'row wrap', style: { gap: '18px', marginTop: '2px' } },
      stat('F1', fmt.pct(scored.f1)),
      stat('도구 성공률', scored.callSuccessRate == null ? '-' : fmt.pct(scored.callSuccessRate)),
      scored.paramScore != null ? stat('파라미터', fmt.pct(scored.paramScore)) : null,
      stat('입력 토큰', fmtTokens(scored.inputTokens, scored.tokensEstimated)),
      stat('출력 토큰', fmtTokens(scored.outputTokens, scored.tokensEstimated)));

    const diff = el('div', { class: 'pg-score-diff' },
      el('div', {},
        el('div', { class: 'pg-diff-label' }, '기대'),
        expected.length ? workflowChips(expected, mcps, { marks: expMarks }) : el('span', { class: 'hint', style: { color: 'var(--tx3)' } }, '(없음)')),
      el('div', {},
        el('div', { class: 'pg-diff-label' }, '실제'),
        steps.length ? workflowChips(steps, mcps, { marks: actMarks }) : el('span', { class: 'hint', style: { color: 'var(--tx3)' } }, '(호출 없음)')),
      el('div', { class: 'pg-diff-legend' },
        el('span', { style: { color: 'var(--sig-red)' } }, '● 누락'), ' · ',
        el('span', { style: { color: 'var(--sig-amber)' } }, '● 잉여')));

    return el('div', { class: 'pg-score' }, head, metrics, diff);
  }

  /* ---------- 블록 실행(병렬) ---------- */
  async function executeBlock(block) {
    running = true;
    updateRunState();
    stopBtn.style.display = '';
    const controllers = block.entries.map(() => new AbortController());
    block.controllers = controllers;
    activeControllers = controllers;

    await Promise.all(block.entries.map((entry, i) => runOne(entry, block.query, controllers[i], block.benchItem)));

    running = false;
    block.controllers = null;
    if (activeControllers === controllers) activeControllers = null;
    stopBtn.style.display = 'none';
    updateRunState();
  }

  async function runOne(entry, query, controller, benchItemRef) {
    setCardLoading(entry);
    let res;
    try {
      res = await executeStrategy(entry.strategy, query, {
        mcps,
        signal: controller.signal,
        onTrace: (ev) => appendTrace(entry.traceLog, ev),
      });
    } catch (e) {
      // executeStrategy는 throw하지 않지만 방어적으로 처리
      res = { ok: false, steps: [], trace: [], llmCalls: 0, totalLatencyMs: 0, error: String(e?.message || e) };
    }
    entry.result = res;
    renderCardResult(entry, res, benchItemRef);
  }

  /* ---------- 트레이스/결과 헬퍼 ---------- */
  function appendTrace(logEl, ev) {
    const tag = TRACE_TAG[ev.type] || 'info';
    const time = new Date(ev.ts).toLocaleTimeString('ko-KR', { hour12: false });
    const msg = el('div', { class: 'trace-msg' }, ev.label);
    if (ev.detail) msg.appendChild(el('details', {}, el('summary', {}, '상세'), el('pre', {}, ev.detail)));
    logEl.appendChild(el('div', { class: 'trace-line' },
      el('span', { class: 'trace-ts' }, time),
      el('span', { class: `trace-tag ${tag}` }, TRACE_LABEL[ev.type] || 'INFO'),
      msg));
    logEl.scrollTop = logEl.scrollHeight;
  }

  function stat(label, value) {
    return el('div', { class: 'stat-inline' }, el('span', { class: 'si-label' }, label), el('span', { class: 'si-value' }, value));
  }

  // ok/단계오류/성공단계 유무로 성공·부분 성공·부분 실패·실패 뱃지 구분 (orchestration.js와 동일)
  function resultBadge(res) {
    const steps = res.steps || [];
    const errored = steps.filter((s) => s.error).length;
    const succeeded = steps.length - errored;
    if (res.ok) return res.hasStepErrors ? badge('부분 성공', 'amber') : badge('성공', 'green');
    return succeeded > 0 ? badge('부분 실패', 'amber') : badge('실패', 'red');
  }

  // DB 전략 실행 트레이스에서 "검색 N개 도구" 정보를 추출(runDb가 emit하는 검색 요약 라인)
  function extractDbInfo(res) {
    for (const ev of res.trace || []) {
      const label = ev.label || '';
      if (!/검색/.test(label)) continue;
      const m = /(\d+)\s*개\s*도구/.exec(label);
      if (m) return { count: Number(m[1]), label };
    }
    return null;
  }

  // cleanup: 라우트 이탈 시 진행 중 실행 모두 중단
  return () => { activeControllers?.forEach((c) => c.abort()); };
}
