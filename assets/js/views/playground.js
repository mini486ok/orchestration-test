// 실시간 테스트 플레이그라운드 — 전략 다중 선택 → 질의 병렬 실행 → 결과 비교 + 히스토리
// 오케스트레이션 편집기의 테스트 콘솔과 별개의 전용 화면. 무상태 단건 실행(executeStrategy)을
// 여러 전략에 대해 동시(Promise.all)로 수행하고, 각 전략별 개별 AbortController로 중단을 제어한다.
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import { el, badge, fmt, toast, spinner, emptyState, workflowChips, downloadJSON } from '../core/ui.js';
import { executeStrategy } from '../services/orchestrator.js';

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

// 트레이스 이벤트 타입 → CSS 태그/라벨 (orchestration.js와 동일하게 재현)
const TRACE_TAG = { 'info': 'info', 'llm-request': 'llm', 'llm-response': 'llm', 'tool-call': 'tool', 'tool-result': 'ok', 'error': 'err' };
const TRACE_LABEL = { 'info': 'INFO', 'llm-request': 'LLM▸', 'llm-response': '▸LLM', 'tool-call': 'TOOL', 'tool-result': 'DONE', 'error': 'ERR' };

export async function render(container, ctx) {
  const strategies = store.get('strategies') || [];
  const mcps = store.get('mcps') || [];

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

  const queryCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, '질의 실행'),
    el('div', { class: 'row', style: { gap: '8px' } }, el('div', { class: 'grow' }, queryInput), runBtn, stopBtn),
    runHint);

  function updateRunState() {
    runBtn.disabled = running || selectedIds.size === 0;
    runHint.textContent = selectedIds.size === 0
      ? '실행할 전략을 1개 이상 선택하세요.'
      : `선택한 전략 ${selectedIds.size}개를 동시에 실행해 결과를 나란히 비교합니다.`;
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
  updateRunState();
  refreshHistoryEmpty();

  /* ---------- 실행 진입 ---------- */
  function runFromInput() {
    const q = queryInput.value.trim();
    if (!q) { toast('테스트 질의를 입력하세요.', 'warn'); queryInput.focus(); return; }
    if (!selectedIds.size) { toast('전략을 1개 이상 선택하세요.', 'warn'); return; }
    const chosen = strategies.filter((s) => selectedIds.has(s.id));
    startBlock(q, chosen);
  }

  function startBlock(query, chosenStrategies) {
    if (running) { toast('이미 실행 중입니다. 완료 후 다시 시도하세요.', 'warn'); return; }
    if (!chosenStrategies.length) { toast('실행할 전략이 없습니다.', 'warn'); return; }
    const block = buildBlock(query, chosenStrategies);
    history.unshift(block);
    if (historyBody.contains(historyEmpty)) historyBody.replaceChildren();
    historyBody.prepend(block.node);
    executeBlock(block);
  }

  /* ---------- 블록(질의 1건) 구성 ---------- */
  function buildBlock(query, chosenStrategies) {
    const snapshot = JSON.parse(JSON.stringify(chosenStrategies)); // 재실행 시 당시 전략 구성을 그대로 사용
    const entries = snapshot.map((s) => makeStrategyCard(s));
    const executedAt = new Date().toISOString();

    const rerunBtn = el('button', { class: 'btn btn-sm btn-ghost', title: '이 질의를 같은 전략들로 현재 MCP 카탈로그·인덱스 상태에서 다시 실행', onclick: () => startBlock(query, snapshot) }, '↻ 재실행');
    const exportBtn = el('button', { class: 'btn btn-sm btn-ghost', title: '이 질의의 전략별 결과를 JSON으로 내보내기', onclick: () => exportBlock(block) }, '⬇ JSON');
    const deleteBtn = el('button', { class: 'btn btn-sm btn-danger', title: '이 질의 기록 삭제', onclick: () => deleteBlock(block) }, '🗑 삭제');

    const node = el('div', { style: { marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--line-soft)' } },
      el('div', { class: 'row between', style: { marginBottom: '12px', flexWrap: 'wrap', gap: '10px' } },
        el('div', { class: 'row', style: { gap: '10px', minWidth: 0, flexWrap: 'wrap', alignItems: 'baseline' } },
          el('span', { style: { fontSize: '11.5px', color: 'var(--tx3)', letterSpacing: '.03em' } }, '질의'),
          el('b', { style: { color: 'var(--tx0)', fontSize: '15px' } }, query),
          el('span', { class: 'hint', style: { color: 'var(--tx3)' } }, fmt.date(executedAt))),
        el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, rerunBtn, exportBtn, deleteBtn)),
      // 선택 전략 수에 맞춘 적응형 열(빈 칸·높이 불균일 완화). 1개=1열, 그 외 최소 320px 자동 채움
      el('div', {
        class: 'grid',
        style: { gridTemplateColumns: entries.length <= 1 ? '1fr' : 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' },
      }, ...entries.map((e) => e.card)));

    const block = { query, executedAt, entries, node, controllers: null };
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
    const payload = {
      query: block.query,
      executedAt: block.executedAt,
      results: block.entries.map((e) => ({
        name: e.strategy.name,
        type: e.strategy.type,
        ok: e.result ? !!e.result.ok : null,
        steps: (e.result?.steps || []).map((s) => ({ serverId: s.serverId, toolName: s.toolName, error: s.error || null })),
        finalAnswer: e.result?.finalAnswer || null,
        llmCalls: e.result?.llmCalls || 0,
        totalLatencyMs: e.result?.totalLatencyMs || 0,
      })),
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
    return { strategy, card, statusSlot, bodySlot, traceLog, result: null };
  }

  function setCardLoading(entry) {
    entry.statusSlot.replaceChildren(badge('실행 중', 'blue'));
    entry.bodySlot.replaceChildren(el('div', { class: 'row', style: { color: 'var(--tx2)' } }, spinner(), el('span', {}, '실행 중…')));
    entry.traceLog.replaceChildren();
  }

  function renderCardResult(entry, res) {
    entry.statusSlot.replaceChildren(resultBadge(res));
    const kids = [];
    if (res.error) kids.push(el('div', { class: 'hint', style: { color: 'var(--sig-red)' } }, res.error));
    else if (res.hasStepErrors) kids.push(el('div', { class: 'hint', style: { color: 'var(--sig-amber)' } }, '일부 단계에서 도구 오류가 발생했습니다(관찰로 전달되어 실행은 계속됨).'));
    if (res.usedFallback) kids.push(el('div', { class: 'hint' }, '⚙ 매치되는 룰이 없어 LLM 플래너로 폴백했습니다.'));

    // 호출된 워크플로우
    if (res.steps?.length) {
      kids.push(workflowChips(res.steps, mcps, { marks: res.steps.map((s) => (s.error ? 'miss' : '')) }));
    } else {
      kids.push(el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '(호출된 도구 없음)'));
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

  /* ---------- 블록 실행(병렬) ---------- */
  async function executeBlock(block) {
    running = true;
    updateRunState();
    stopBtn.style.display = '';
    const controllers = block.entries.map(() => new AbortController());
    block.controllers = controllers;
    activeControllers = controllers;

    await Promise.all(block.entries.map((entry, i) => runOne(entry, block.query, controllers[i])));

    running = false;
    block.controllers = null;
    if (activeControllers === controllers) activeControllers = null;
    stopBtn.style.display = 'none';
    updateRunState();
  }

  async function runOne(entry, query, controller) {
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
    renderCardResult(entry, res);
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
