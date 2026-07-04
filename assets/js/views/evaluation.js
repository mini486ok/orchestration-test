// 평가 · 비교 — (A) 실행 설정 → (B) 진행 → (C) 결과(리더보드/차트/상세)
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import {
  el, badge, fmt, toast, modal, confirmDialog, segmented,
  emptyState, spinner, workflowChips,
} from '../core/ui.js';
import { groupedBarChart, radarChart, hBarChart, SERIES_COLORS } from '../core/charts.js';
import { runEvaluation } from '../services/evaluator.js';
import { checkConnection, listModels } from '../services/ollama.js';

/* ---------- 공통 헬퍼 ---------- */
const TYPE_LABEL = { prompt: '프롬프트', skill: '스킬', rule: '룰', db: 'DB' };
const TYPE_KIND = { prompt: 'violet', skill: 'blue', rule: 'amber', db: 'green' };
const DIFF_LABEL = { easy: '쉬움', medium: '보통', hard: '어려움' };
const DIFF_KIND = { easy: 'green', medium: 'amber', hard: 'red' };
const STATUS_LABEL = { running: '실행 중', done: '완료', cancelled: '중단됨', error: '오류' };
const STATUS_KIND = { running: 'blue', done: 'green', cancelled: 'amber', error: 'red' };

/** 리더보드 정렬 기준 (asc=오름차순) */
const SORT_OPTS = [
  { key: 'avgF1', label: 'F1', asc: false },
  { key: 'avgPrecision', label: 'Precision', asc: false },
  { key: 'avgRecall', label: 'Recall', asc: false },
  { key: 'avgSeqAccuracy', label: '시퀀스', asc: false },
  { key: 'exactMatchRate', label: '완전일치', asc: false },
  { key: 'avgLatencyMs', label: '평균 지연(오름차순)', asc: true },
];

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

    const scaleHint = el('div', { class: 'hint' });
    function updateScale() {
      const set = benchmarks.find((b) => b.id === selectedSetId);
      const items = set?.items?.length || 0;
      const nStrat = selectedStrategyIds.size;
      scaleHint.textContent = nStrat ? `예상 실행 규모: 항목 ${items}개 × 전략 ${nStrat}개 = 총 ${items * nStrat}회 실행` : '전략을 1개 이상 선택하세요.';
      startBtn.disabled = !(selectedSetId && nStrat);
      renderWarn();
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
      startProgress({ benchmarkSet: set, strategies: chosen, model, temperature, name: nameInput.value.trim() || defaultRunName() });
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
      el('div', { class: 'fld', style: { marginTop: '10px' } },
        el('label', { class: 'row', style: { gap: '8px', alignItems: 'center', cursor: 'pointer' } },
          tempChk, '온도 통일', tempNum),
        el('div', { class: 'hint' }, '체크 시 모든 전략을 지정 온도(0~1, 기본 0.1)로 실행하여 무작위성을 통제합니다.')),
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
  function startProgress({ benchmarkSet, strategies, model, temperature, name }) {
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
        run = await runEvaluation({ benchmarkSet, strategies, mcps, model, temperature, name, onProgress, signal: controller.signal });
      } catch (e) {
        clearInterval(timer);
        toast('평가 실행 중 오류: ' + (e?.message || e), 'error');
        showSetup();
        return;
      }
      clearInterval(timer);
      toast(run.status === 'cancelled' ? '평가가 중단되었습니다. 부분 결과를 저장했습니다.' : '평가가 완료되었습니다.', run.status === 'cancelled' ? 'warn' : 'success');

      // 저장: 최근 20개 유지, 실패(용량 초과) 시 10개로 절단해 1회 재시도
      const existing = (store.get('runs') || []).filter((r) => r.id !== run.id);
      let saved = store.set('runs', [run, ...existing].slice(0, 20));
      if (!saved) saved = store.set('runs', [run, ...existing].slice(0, 10));
      if (!saved) {
        toast('평가 결과 저장 실패 — 저장 공간 부족. 오래된 실행 기록을 삭제하세요.', 'error');
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
            `${run.benchmarkSetName || '-'} · ${fmt.date(run.createdAt)} · 전략 ${baseStrat.length}개${run.model ? ' · 모델 ' + run.model : ''}${run.temperature != null ? ' · 온도 통일 ' + run.temperature : ''}`)),
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
    let sortKey = 'avgF1';
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

    /* 4. 항목별 상세 (기본 F1 순) */
    root.appendChild(buildDetail(run, baseStrat));

    return root;
  }

  /* ---------- 인사이트 한 줄 ---------- */
  function buildInsight(strat) {
    const parts = [];
    const byF1 = [...strat].sort((a, b) => (b.summary.avgF1 || 0) - (a.summary.avgF1 || 0));
    const bestF1 = byF1[0];
    parts.push(`최고 F1은 “${bestF1.strategyName}” (${fmt.pct(bestF1.summary.avgF1)})`);
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
  function buildLeaderboard(strat, sortKey = 'avgF1', onSortChange) {
    const metricBar = (v) => el('div', { class: 'metric-bar' },
      el('div', { class: 'mb-track' }, el('div', { class: 'mb-fill', style: { width: Math.max(0, Math.min(1, v || 0)) * 100 + '%' } })),
      el('span', { class: 'mb-val' }, fmt.pct(v)));

    const rows = strat.map((s, i) => {
      const m = s.summary;
      const isRuleFallback = s.strategyType === 'rule' && (m.fallbackRate || 0) > 0;
      const nameCell = el('td', {},
        el('div', { class: 'row', style: { gap: '7px', flexWrap: 'wrap', alignItems: 'center' } },
          el('b', { style: { color: 'var(--tx0)' } }, s.strategyName),
          typeBadge(s.strategyType),
          isRuleFallback
            ? el('span', { class: 'badge amber', title: '매치 실패 항목은 LLM 폴백으로 실행됨 — 룰 자체 성능과 분리 해석 필요' }, `폴백 ${fmt.pct(m.fallbackRate)}`)
            : null),
        (isRuleFallback && m.avgF1Matched != null)
          ? el('div', { class: 'hint', style: { marginTop: '3px', color: 'var(--tx2)' } }, `룰 매치 항목만 F1 ${fmt.pct(m.avgF1Matched)}`)
          : null);
      return el('tr', {},
        el('td', {}, el('span', { class: 'leader-rank' + (i === 0 ? ' r1' : '') }, String(i + 1))),
        nameCell,
        el('td', { class: 'metric-cell' }, metricBar(m.avgF1)),
        el('td', { class: 'num' }, fmt.pct(m.avgPrecision)),
        el('td', { class: 'num' }, fmt.pct(m.avgRecall)),
        el('td', { class: 'num' }, fmt.pct(m.avgSeqAccuracy)),
        el('td', { class: 'num' }, fmt.pct(m.exactMatchRate)),
        el('td', { class: 'num' }, m.avgParamScore == null ? '-' : fmt.pct(m.avgParamScore)),
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
            el('th', {}, '순위'), el('th', {}, '전략'), el('th', {}, 'F1'),
            el('th', {}, 'Precision'), el('th', {}, 'Recall'), el('th', {}, '시퀀스'),
            el('th', {}, '완전일치'), el('th', {}, '파라미터'), el('th', {}, '평균 지연'),
            el('th', {}, 'LLM'), el('th', {}, '오류율'))),
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

    return el('div', { class: 'grid cols-2', style: { marginBottom: '16px' } }, barCard, radarCard, latCard, diffCard);
  }

  /* ---------- 항목별 상세 ---------- */
  function buildDetail(run, strat) {
    const tableBox = el('div', {});
    let selId = strat[0].id;

    function renderTable() {
      const s = strat.find((x) => x.id === selId) || strat[0];
      const items = s.items || [];
      if (!items.length) { tableBox.replaceChildren(el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '항목이 없습니다.')); return; }

      const rows = items.map((it) => {
        const { expMarks, actMarks } = diffMarks(it.expected || [], it.actual || []);
        return el('tr', { style: { cursor: 'pointer' }, onclick: () => openItemModal(s, it) },
          el('td', { style: { maxWidth: '260px' } }, el('div', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, it.query)),
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
            el('th', {}, '질의'), el('th', {}, '기대 워크플로우'), el('th', {}, '실제 워크플로우'),
            el('th', {}, 'F1'), el('th', {}, '시퀀스'), el('th', {}, '지연'), el('th', {}, '상태'))),
          el('tbody', {}, rows))));
    }
    renderTable();

    return el('div', { class: 'card' },
      el('div', { class: 'row between', style: { marginBottom: '12px', flexWrap: 'wrap', gap: '8px' } },
        el('div', { class: 'panel-title', style: { margin: 0 } }, '항목별 상세', el('span', { class: 'sub' }, '행 클릭 시 실행 로그')),
        strat.length > 1 ? segmented(strat.map((s) => ({ label: s.strategyName, value: s.id })), selId, (v) => { selId = v; renderTable(); }) : null),
      el('div', { class: 'hint', style: { marginBottom: '10px' } },
        '워크플로우 표식: ', el('span', { style: { color: 'var(--sig-red)' } }, '● 누락'), ' · ', el('span', { style: { color: 'var(--sig-amber)' } }, '● 초과')),
      tableBox);
  }

  /* ---------- 항목 상세 모달 ---------- */
  function openItemModal(s, it) {
    const { expMarks, actMarks } = diffMarks(it.expected || [], it.actual || []);
    const body = el('div', {},
      el('div', { class: 'fld' }, el('label', {}, '질의'), el('div', { style: { color: 'var(--tx0)', lineHeight: 1.6 } }, it.query)),
      el('div', { class: 'row', style: { gap: '8px', marginBottom: '14px', flexWrap: 'wrap' } },
        it.difficulty ? badge(DIFF_LABEL[it.difficulty] || it.difficulty, DIFF_KIND[it.difficulty] || 'dim') : null,
        badge(`F1 ${fmt.pct(it.metrics?.f1)}`, 'blue'),
        badge(`시퀀스 ${fmt.pct(it.metrics?.seqAccuracy)}`, 'dim'),
        it.metrics?.exactMatch ? badge('완전일치', 'green') : null,
        it.metrics?.paramScore != null ? badge(`파라미터 ${fmt.pct(it.metrics.paramScore)}`, 'dim') : null,
        it.metrics?.matchedAlternative != null ? badge(`대안 정답 #${it.metrics.matchedAlternative + 1}`, 'blue') : null,
        it.usedFallback ? badge('LLM 폴백', 'amber') : null,
        (it.hasStepErrors && !it.error) ? badge('부분 오류', 'amber') : null,
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
    const header = ['전략', '타입', '항목ID', '질의', '기대워크플로우', '실제워크플로우', 'precision', 'recall', 'f1', 'seqAccuracy', 'exactMatch', 'paramScore', 'latencyMs', 'llmCalls', '오류'];
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
          Math.round(it.latencyMs || 0), it.llmCalls || 0, it.error || '',
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
