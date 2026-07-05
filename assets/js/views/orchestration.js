// 오케스트레이션 스튜디오 — 전략 목록 + 3타입 편집기 + 테스트 콘솔
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import {
  el, uuid, toast, modal, confirmDialog, badge, field, segmented,
  jsonEditor, emptyState, downloadJSON, pickJSONFile, fmt, workflowChips,
} from '../core/ui.js';
import { listModels, checkConnection } from '../services/ollama.js';
import { executeStrategy, buildToolCatalog, DEFAULT_PLANNER_PROMPT, DEFAULT_SKILL_SELECTOR_PROMPT } from '../services/orchestrator.js';
import { buildIndex, indexStatus } from '../services/catalogIndex.js';

const TYPE_META = {
  prompt: { label: '프롬프트', kind: 'green', icon: '💬', desc: 'LLM이 도구 카탈로그를 보고 계획(Plan) 또는 ReAct 방식으로 실행합니다.' },
  skill: { label: '스킬', kind: 'blue', icon: '🧰', desc: 'LLM이 미리 정의한 스킬(작업 절차) 중 하나를 골라 단계를 실행합니다.' },
  rule: { label: '룰', kind: 'amber', icon: '📐', desc: '키워드·정규식 규칙으로 LLM 없이 결정적으로 워크플로우를 매칭합니다.' },
  db: { label: 'DB', kind: 'violet', icon: '🗄️', desc: '카탈로그를 vector/graph db로 구축해 관련 도구만 플래너에 공급합니다.' },
};

// catalogGraph.js(그래프 엔진)는 별도 에이전트가 작성하는 선택적 모듈이다.
// 정적 import는 모듈 부재 시 오케스트레이션 뷰 전체(기존 3타입 편집기 포함)를 깨뜨리므로,
// 동적 import + 폴백으로 한 번만 로드하고 그래프 기능은 있으면 활성화·없으면 비활성 안내한다.
let _graphModPromise = null;
function loadGraphMod() {
  if (!_graphModPromise) {
    _graphModPromise = import('../services/catalogGraph.js').catch(() => null);
  }
  return _graphModPromise;
}

const MODE_HINT = {
  plan: '플랜 우선: LLM이 한 번의 호출로 전체 계획을 세운 뒤 순차 실행합니다. 빠르지만 중간 관찰을 반영하지 못합니다.',
  react: 'ReAct: 매 단계마다 관찰 결과를 보고 다음 행동을 결정합니다. 유연하지만 LLM 호출이 많습니다.',
};

// 트레이스 이벤트 타입 → CSS 태그/라벨
const TRACE_TAG = { 'info': 'info', 'llm-request': 'llm', 'llm-response': 'llm', 'tool-call': 'tool', 'tool-result': 'ok', 'error': 'err' };
const TRACE_LABEL = { 'info': 'INFO', 'llm-request': 'LLM▸', 'llm-response': '▸LLM', 'tool-call': 'TOOL', 'tool-result': 'DONE', 'error': 'ERR' };

export async function render(container, ctx) {
  let strategies = store.get('strategies') || [];
  const mcps = store.get('mcps') || [];
  const benchmarks = store.get('benchmarks') || [];
  let selectedId = ctx?.params?.id || null;
  let abortCtrl = null; // 실행 중 AbortController (한 번에 하나)
  // 뷰 생명주기 동안 진행 중인 비동기 작업 추적 — 라우트 이탈(cleanup)·편집기 전환 시 중단(U7).
  // 그래프 구축(LLM 추출·임베딩)이 백그라운드에서 계속돼 완료 시 store를 조용히 덮어쓰는 문제를 막는다.
  let graphBuildAbort = null;   // dbGraphEditor 그래프 구축 중 AbortController
  let vectorBuildAbort = null;  // dbVectorEditor 인덱스 구축 중 AbortController
  let pendingRedrawTimer = null; // 그래프 시각화 재그리기 디바운스 타이머
  function cancelActiveWork() {
    if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
    if (graphBuildAbort) { graphBuildAbort.abort(); graphBuildAbort = null; }
    if (vectorBuildAbort) { vectorBuildAbort.abort(); vectorBuildAbort = null; }
    if (pendingRedrawTimer) { clearTimeout(pendingRedrawTimer); pendingRedrawTimer = null; }
  }

  // 그래프 엔진 모듈(있으면 graph db 기능 활성화). 없으면 null → UI·저장은 동작, 실행부만 안내.
  const graphMod = await loadGraphMod();

  /* ---------- 좌측 목록 ---------- */
  const listBody = el('div', { class: 'stack', style: { maxHeight: '70vh', overflowY: 'auto' } });
  const leftCard = el('div', { class: 'card strat-list-card' },
    el('div', { class: 'row between', style: { marginBottom: '12px' } },
      el('div', { class: 'panel-title', style: { margin: 0 } }, '전략'),
      el('button', { class: 'btn btn-sm btn-primary', onclick: openNewModal }, '＋ 새 전략')),
    el('div', { class: 'row', style: { marginBottom: '10px' } },
      el('button', { class: 'btn btn-sm btn-ghost grow', onclick: importStrategies }, '⬆ 가져오기')),
    listBody);

  const editorWrap = el('div', { class: 'grow', style: { minWidth: 0 } });
  container.replaceChildren(el('div', { class: 'split' }, leftCard, editorWrap));

  function renderList() {
    if (!strategies.length) {
      listBody.replaceChildren(emptyState({
        icon: '🧠', title: '전략이 없습니다',
        desc: '새 전략을 만들어 오케스트레이션을 설계하세요.',
        action: { label: '＋ 새 전략', onClick: openNewModal },
      }));
      return;
    }
    listBody.replaceChildren(...strategies.map(s => {
      const meta = TYPE_META[s.type] || { label: s.type, kind: 'dim' };
      const actions = el('div', { class: 'li-actions' },
        el('button', { title: '복제', onclick: (e) => { e.stopPropagation(); cloneStrategy(s); } }, '⧉'),
        el('button', { title: '삭제', onclick: (e) => { e.stopPropagation(); deleteStrategy(s); } }, '🗑'));
      return el('div', {
        class: 'list-item strat-item' + (s.id === selectedId ? ' on' : ''),
        onclick: () => selectStrategy(s.id),
      },
        el('div', { class: 'li-name' }, badge(meta.label, meta.kind), el('span', { class: 'grow' }, s.name || '(이름 없음)')),
        el('div', { class: 'li-sub' }, `수정 ${fmt.date(s.updatedAt || s.createdAt)}`),
        actions);
    }));
  }

  function selectStrategy(id) {
    selectedId = id;
    renderList();
    const s = strategies.find(x => x.id === id);
    if (s) openEditor(s);
  }

  /* ---------- 새 전략 / 가져오기 / 복제 / 삭제 ---------- */
  function openNewModal() {
    const card = (type) => {
      const meta = TYPE_META[type];
      return el('div', { class: 'card hoverable strat-type-card', onclick: () => { m.close(); createStrategy(type); } },
        el('div', { class: 'stc-ico' }, meta.icon),
        el('div', { class: 'panel-title', style: { margin: '4px 0' } }, `${meta.label} 전략`),
        el('p', { class: 'hint' }, meta.desc));
    };
    const m = modal({
      title: '새 전략 만들기', wide: true,
      body: el('div', { class: 'grid cols-4' }, card('prompt'), card('skill'), card('rule'), card('db')),
    });
  }

  function defaultVectorCfg() {
    return {
      method: 'hybrid', topK: 8, threshold: 0, hybridAlpha: 0.5, expandServer: true, expandCategory: false, embedModel: 'bge-m3:latest',
      // v2 신규(§2): 임베딩 문서 구성 토글 + MMR 다양성. 기본값은 현행과 동일(desc+params 포함, MMR off).
      docFields: { desc: true, params: true, outputs: false, examples: false, tags: false },
      mmrLambda: 1.0,   // 1.0=관련도만(MMR off) · 0.0=다양성 최대. 검색 시점 적용(재색인 불필요).
    };
  }
  function defaultGraphCfg() {
    return {
      edges: {
        io: { on: true, weight: 1.0, threshold: 0.0 },
        semantic: { on: true, weight: 1.0, threshold: 0.55 },
        server: { on: true, weight: 0.5 },
        category: { on: false, weight: 0.3 },
        cooccur: { on: false, weight: 1.0, threshold: 1 },  // 벤치마크 정보 누출 주의 → 기본 off
        llm: { on: false, weight: 1.0, threshold: 1 },   // 무거움(도구당 LLM 호출) → 기본 off
      },
      seedMethod: 'hybrid', seedK: 5, hops: 2, decay: 0.5, topK: 8,
      embedModel: null,    // null → 임베딩 기본 'bge-m3:latest'
      extractModel: null,  // null → settings.defaultModel (llm 엣지 추출용)
      // v2 신규(§3): degree 상한 · 허브 정규화 · 경로 추천 파라미터.
      maxDegree: 12,       // 노드별 최대 연결(io 출력 상한 포함). effectiveAdjacency 캡.
      hubNorm: true,       // 확산 시 허브 degree 정규화(1/√deg) on/off.
      path: { beamWidth: 6, maxLen: 4, edges: ['io'] },  // recommendPaths 빔 폭/최대 길이/사용 엣지.
    };
  }

  // v2 하위호환 back-fill — 구버전·가져온 전략에 신규 필드가 없을 때만 기본값으로 채운다(기존 값 보존·회귀 방지).
  function backfillVectorCfg(v) {
    if (!v) return v;
    const d = defaultVectorCfg();
    if (!v.docFields || typeof v.docFields !== 'object') v.docFields = { ...d.docFields };
    else for (const k in d.docFields) if (typeof v.docFields[k] !== 'boolean') v.docFields[k] = d.docFields[k];
    if (typeof v.mmrLambda !== 'number') v.mmrLambda = d.mmrLambda;
    return v;
  }
  function backfillGraphCfg(g) {
    if (!g) return g;
    const d = defaultGraphCfg();
    if (typeof g.maxDegree !== 'number') g.maxDegree = d.maxDegree;
    if (typeof g.hubNorm !== 'boolean') g.hubNorm = d.hubNorm;
    if (!g.path || typeof g.path !== 'object') g.path = { ...d.path };
    else {
      if (typeof g.path.beamWidth !== 'number') g.path.beamWidth = d.path.beamWidth;
      if (typeof g.path.maxLen !== 'number') g.path.maxLen = d.path.maxLen;
      if (!Array.isArray(g.path.edges) || !g.path.edges.length) g.path.edges = [...d.path.edges];
    }
    return g;
  }

  function defaultConfig(type) {
    if (type === 'prompt') return { systemPrompt: DEFAULT_PLANNER_PROMPT, planningMode: 'plan', temperature: 0.2, maxSteps: 6 };
    if (type === 'skill') return { skills: [newSkill()], selectorPrompt: DEFAULT_SKILL_SELECTOR_PROMPT, paramFill: 'template' };
    if (type === 'db') return {
      store: 'vector', planningMode: 'plan', temperature: 0.1, maxSteps: 6,
      systemPrompt: DEFAULT_PLANNER_PROMPT, vector: defaultVectorCfg(), graph: defaultGraphCfg(),
    };
    return { rules: [newRule(0)], onNoMatch: 'error', fallbackPrompt: '' };
  }
  function newSkill() { return { id: uuid(), name: '새 스킬', trigger: '', description: '', steps: [newStep()] }; }
  function newRule(priority) { return { id: uuid(), name: '새 룰', priority: priority || 0, matchMode: 'any', conditions: [{ type: 'keyword', value: '' }], steps: [newStep()] }; }
  function newStep() { return { serverId: mcps[0]?.id || '', toolName: '', paramsTemplate: {} }; }

  function createStrategy(type) {
    const now = new Date().toISOString();
    const s = { id: uuid(), name: `새 ${TYPE_META[type].label} 전략`, description: '', type, model: null, createdAt: now, updatedAt: now, config: defaultConfig(type) };
    strategies = [s, ...strategies];
    store.set('strategies', strategies);
    selectedId = s.id;
    renderList();
    openEditor(s);
    toast('새 전략이 생성되었습니다. 편집 후 저장하세요.', 'success');
  }

  function cloneStrategy(s) {
    const copy = JSON.parse(JSON.stringify(s));
    copy.id = uuid();
    copy.name = (s.name || '전략') + ' 복제';
    const now = new Date().toISOString();
    copy.createdAt = now; copy.updatedAt = now;
    strategies = [copy, ...strategies];
    store.set('strategies', strategies);
    selectedId = copy.id;
    renderList();
    openEditor(copy);
    toast('전략을 복제했습니다.', 'success');
  }

  async function deleteStrategy(s) {
    if (!await confirmDialog(`전략 '${s.name}'을(를) 삭제할까요?`)) return;
    strategies = strategies.filter(x => x.id !== s.id);
    store.set('strategies', strategies);
    if (selectedId === s.id) selectedId = strategies[0]?.id || null;
    renderList();
    if (selectedId) openEditor(strategies.find(x => x.id === selectedId));
    else editorWrap.replaceChildren(emptyEditor());
    toast('삭제되었습니다.', 'success');
  }

  async function importStrategies() {
    try {
      const data = await pickJSONFile();
      if (!data) return;
      const arr = Array.isArray(data) ? data : [data];
      const ids = new Set(strategies.map(s => s.id));
      let added = 0, firstId = null;
      for (const raw of arr) {
        if (!raw || !raw.type || !raw.config || !TYPE_META[raw.type]) continue;
        const s = JSON.parse(JSON.stringify(raw));
        if (!s.id || ids.has(s.id)) s.id = uuid();
        ids.add(s.id);
        const now = new Date().toISOString();
        s.createdAt = s.createdAt || now;
        s.updatedAt = now;
        s.model = s.model || null;
        strategies = [s, ...strategies];
        added++;
        if (!firstId) firstId = s.id;
      }
      if (!added) { toast('가져올 유효한 전략이 없습니다.', 'warn'); return; }
      store.set('strategies', strategies);
      selectedId = firstId;
      renderList();
      openEditor(strategies.find(s => s.id === firstId));
      toast(`${added}개 전략을 가져왔습니다.`, 'success');
      // 가져온 전략의 참조 무결성 사후 검증 — 차단하지 않고 경고(먼저 MCP를 가져와야 하는 순서 문제 방지)
      const problems = [];
      for (const s of strategies.slice(0, added)) {
        const err = validateStrategy(s, { strict: true });
        if (err) problems.push(`'${s.name || s.id}': ${err}`);
      }
      if (problems.length) {
        toast(`가져온 전략 ${problems.length}개에 문제가 있습니다 — ${problems[0]}${problems.length > 1 ? ` 외 ${problems.length - 1}건` : ''}. 편집기에서 확인하세요.`, 'warn', 6000);
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ---------- 유효성 ---------- */
  // step의 serverId/toolName이 현재 등록된 MCP에 실존하는지 검사
  function stepRefError(step, where) {
    const server = mcps.find(m => m.id === step.serverId);
    if (!step.serverId || !server) return `${where}: 서버를 선택하세요(삭제되었거나 존재하지 않는 서버 참조).`;
    if (!step.toolName || !(server.tools || []).some(t => t.name === step.toolName)) {
      return `${where}: 서버 '${server.nameKo || server.name}'에 존재하는 도구를 선택하세요.`;
    }
    return null;
  }
  // strict=true(저장 시): step 참조 실존 + 정규식 컴파일까지 검증. strict=false(실행 시): 구조 검증만.
  function validateStrategy(s, { strict = false } = {}) {
    if (!s.name || !s.name.trim()) return '전략 이름을 입력하세요.';
    if (s.type === 'prompt') {
      if (!s.config.systemPrompt || !s.config.systemPrompt.trim()) return '시스템 프롬프트를 입력하세요.';
    } else if (s.type === 'db') {
      if (!s.config.systemPrompt || !s.config.systemPrompt.trim()) return '시스템 프롬프트를 입력하세요.';
      if (s.config.store !== 'vector' && s.config.store !== 'graph') return 'DB 종류(vector db / graph db)를 선택하세요.';
      if (s.config.store === 'graph') {
        const edges = s.config.graph?.edges || {};
        const anyOn = ['io', 'semantic', 'server', 'category', 'cooccur', 'llm'].some(t => edges[t]?.on);
        if (!anyOn) return '그래프 db는 최소 한 가지 엣지 유형을 켜야 합니다.';
      }
    } else if (s.type === 'skill') {
      if (!s.config.skills?.length) return '스킬을 하나 이상 추가하세요.';
      for (const sk of s.config.skills) {
        if (!sk.name?.trim()) return '모든 스킬에 이름을 입력하세요.';
        if (!sk.steps?.length) return `스킬 '${sk.name}'에 단계를 하나 이상 추가하세요.`;
        if (strict) {
          for (let i = 0; i < sk.steps.length; i++) {
            const e = stepRefError(sk.steps[i], `스킬 '${sk.name}' ${i + 1}단계`);
            if (e) return e;
          }
        }
      }
    } else if (s.type === 'rule') {
      if (!s.config.rules?.length) return '룰을 하나 이상 추가하세요.';
      for (const r of s.config.rules) {
        if (!r.conditions?.length) return `룰 '${r.name}'에 조건을 하나 이상 추가하세요.`;
        if (strict) {
          for (const c of r.conditions) {
            if (!c.value || !String(c.value).trim()) return `룰 '${r.name}'의 조건 값을 입력하세요.`;
            if (c.type === 'regex') {
              try { new RegExp(c.value, 'i'); }
              catch (e) { return `룰 '${r.name}'의 정규식이 잘못되었습니다: ${e.message}`; }
            }
          }
        }
        if (!r.steps?.length) return `룰 '${r.name}'에 단계를 하나 이상 추가하세요.`;
        if (strict) {
          for (let i = 0; i < r.steps.length; i++) {
            const e = stepRefError(r.steps[i], `룰 '${r.name}' ${i + 1}단계`);
            if (e) return e;
          }
        }
      }
    }
    return null;
  }
  const coreJSON = (s) => JSON.stringify({ name: s.name, description: s.description, model: s.model, type: s.type, config: s.config });

  /* ---------- 공용 steps 편집기 ---------- */
  function stepsEditor(steps) {
    const body = el('div', {});
    function draw() {
      body.replaceChildren();
      steps.forEach((step, i) => body.appendChild(stepRow(step, i)));
      body.appendChild(el('button', {
        class: 'btn btn-sm', style: { marginTop: '2px' },
        onclick: () => { steps.push(newStep()); draw(); },
      }, '＋ 단계 추가'));
    }
    function stepRow(step, i) {
      const serverSel = el('select', { class: 'select' },
        el('option', { value: '' }, '— 서버 선택 —'),
        ...mcps.map(m => el('option', { value: m.id, selected: m.id === step.serverId }, `${m.icon || ''} ${m.nameKo || m.name}`)));
      const toolSel = el('select', { class: 'select' });
      const warn = el('div', {});

      function fillTools() {
        const server = mcps.find(m => m.id === step.serverId);
        const tools = server?.tools || [];
        toolSel.replaceChildren(
          el('option', { value: '' }, '— 도구 선택 —'),
          ...tools.map(t => el('option', { value: t.name, selected: t.name === step.toolName, title: t.description || '' }, t.name)));
        // 주의: 네이티브 replaceChildren(null)은 "null" 텍스트를 삽입하므로 노드가 있을 때만 전달
        const warnNode = (step.serverId && !server)
          ? el('div', { class: 'hint', style: { color: 'var(--sig-red)' } }, '⚠ 삭제되었거나 존재하지 않는 서버입니다.')
          : ((step.toolName && server && !tools.some(t => t.name === step.toolName))
            ? el('div', { class: 'hint', style: { color: 'var(--sig-red)' } }, `⚠ 서버에 '${step.toolName}' 도구가 없습니다.`)
            : null);
        warn.replaceChildren(...(warnNode ? [warnNode] : []));
      }
      fillTools();
      serverSel.addEventListener('change', () => { step.serverId = serverSel.value; step.toolName = ''; fillTools(); });
      toolSel.addEventListener('change', () => { step.toolName = toolSel.value; fillTools(); });

      const paramsEd = jsonEditor({
        value: step.paramsTemplate || {}, height: 96,
        onChange: (v) => { if (v === null) step.paramsTemplate = {}; else if (v && typeof v === 'object' && !Array.isArray(v)) step.paramsTemplate = v; },
      });
      const details = el('details', {},
        el('summary', {}, 'paramsTemplate — {{QUERY}}, {{step1.output.필드}} 참조 가능'),
        el('div', { style: { marginTop: '6px' } }, paramsEd.root));

      const move = (d) => {
        const j = i + d;
        if (j < 0 || j >= steps.length) return;
        [steps[i], steps[j]] = [steps[j], steps[i]];
        draw();
      };
      return el('div', { class: 'step-row' },
        el('div', { class: 'step-no' }, String(i + 1)),
        el('div', { class: 'grow stack', style: { minWidth: 0 } },
          el('div', { class: 'row', style: { gap: '8px' } }, serverSel, toolSel),
          warn, details),
        el('div', { class: 'stack', style: { gap: '4px' } },
          el('button', { class: 'btn btn-icon btn-sm', title: '위로', onclick: () => move(-1) }, '↑'),
          el('button', { class: 'btn btn-icon btn-sm', title: '아래로', onclick: () => move(1) }, '↓'),
          el('button', { class: 'btn btn-icon btn-sm btn-danger', title: '삭제', onclick: () => { steps.splice(i, 1); draw(); } }, '✕')));
    }
    draw();
    return body;
  }

  /* ---------- prompt 편집기 ---------- */
  function promptEditor(draft) {
    const cfg = draft.config;
    const modeHint = el('div', { class: 'hint' }, MODE_HINT[cfg.planningMode || 'plan']);
    const modeSeg = segmented(
      [{ value: 'plan', label: '플랜 우선' }, { value: 'react', label: 'ReAct' }],
      cfg.planningMode || 'plan',
      (v) => { cfg.planningMode = v; modeHint.textContent = MODE_HINT[v]; });

    const tempVal = el('span', { class: 'mono', style: { minWidth: '34px' } }, String(cfg.temperature ?? 0.2));
    const tempInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(cfg.temperature ?? 0.2) });
    tempInput.addEventListener('input', () => { cfg.temperature = Number(tempInput.value); tempVal.textContent = tempInput.value; });

    const stepsInput = numStepper(cfg.maxSteps ?? 6, 1, 20, (v) => { cfg.maxSteps = v; }); // clamp+동기화 통일(U2)

    const ta = el('textarea', { class: 'input mono-input', spellcheck: 'false', style: { minHeight: '280px', lineHeight: '1.75' } });
    ta.value = cfg.systemPrompt || '';
    ta.addEventListener('input', () => { cfg.systemPrompt = ta.value; });

    const chips = ['{{TOOL_CATALOG}}', '{{QUERY}}', '{{DATE}}'].map(ph =>
      el('button', { type: 'button', class: 'chip', onclick: () => insertAtCursor(ta, ph) }, ph));
    const resetBtn = el('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: async () => {
        if (!await confirmDialog('시스템 프롬프트를 기본값으로 되돌립니다. 계속할까요?', { danger: false, okLabel: '재설정' })) return;
        ta.value = DEFAULT_PLANNER_PROMPT; cfg.systemPrompt = DEFAULT_PLANNER_PROMPT;
      },
    }, '기본 프롬프트로 재설정');

    const catalogPreview = el('details', { style: { marginTop: '4px' } },
      el('summary', { class: 'hint' }, '현재 도구 카탈로그 미리보기 ({{TOOL_CATALOG}} 치환 값)'),
      el('pre', { class: 'catalog-pre' }, buildToolCatalog(mcps)));

    return el('div', { class: 'stack' },
      field({ label: '플래닝 모드', input: el('div', { class: 'stack' }, modeSeg, modeHint) }),
      field({ label: 'temperature (창의성)', input: el('div', { class: 'row' }, tempInput, tempVal) }),
      field({ label: '최대 단계 수 (maxSteps)', input: stepsInput, hint: 'plan: 실행할 계획 단계 상한 · react: 최대 반복 횟수' }),
      field({
        label: '시스템 프롬프트',
        input: el('div', { class: 'stack' },
          el('div', { class: 'ph-chips' }, el('span', { class: 'hint' }, '플레이스홀더 삽입:'), ...chips),
          ta,
          el('div', { class: 'row' }, resetBtn),
          catalogPreview),
      }),
      catalogSection(cfg));
  }

  /* ---------- 도구 카탈로그 공급 (전체 / 검색 기반 RAG) ---------- */
  function catalogSection(cfg) {
    if (cfg.catalogMode !== 'retrieval') cfg.catalogMode = 'full';
    if (!cfg.retrieval) cfg.retrieval = { method: 'hybrid', topK: 8, threshold: 0, hybridAlpha: 0.5, expandServer: true, expandCategory: false, embedModel: 'bge-m3:latest' };
    const r = cfg.retrieval;

    // 하이브리드 α 슬라이더 (하이브리드에서만 표시)
    const alphaLabel = (a) => `${Number(a).toFixed(2)} (벡터)`;
    const alphaVal = el('span', { class: 'mono', style: { minWidth: '76px' } }, alphaLabel(r.hybridAlpha ?? 0.5));
    const alphaInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(r.hybridAlpha ?? 0.5) });
    alphaInput.addEventListener('input', () => { r.hybridAlpha = Number(alphaInput.value); alphaVal.textContent = alphaLabel(r.hybridAlpha); });
    const alphaWrap = field({ label: '하이브리드 가중 (α = 벡터 비중)', input: el('div', { class: 'row' }, alphaInput, alphaVal), hint: 'α=1 벡터 전용 · α=0 키워드 전용 · 두 점수 각각 정규화 후 가중합' });
    alphaWrap.style.display = (r.method === 'hybrid') ? '' : 'none';

    const methodSeg = segmented(
      [{ value: 'vector', label: '벡터' }, { value: 'keyword', label: '키워드' }, { value: 'hybrid', label: '하이브리드' }],
      r.method || 'hybrid',
      (v) => { r.method = v; alphaWrap.style.display = (v === 'hybrid') ? '' : 'none'; });

    const topKInput = el('input', { class: 'input', type: 'number', min: '1', max: '30', value: String(r.topK ?? 8), style: { maxWidth: '120px' } });
    topKInput.addEventListener('input', () => { r.topK = Math.min(30, Math.max(1, Number(topKInput.value) || 8)); });

    const thVal = el('span', { class: 'mono', style: { minWidth: '34px' } }, String(r.threshold ?? 0));
    const thInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(r.threshold ?? 0) });
    thInput.addEventListener('input', () => { r.threshold = Number(thInput.value); thVal.textContent = thInput.value; });

    const embedI = el('input', { class: 'input', value: r.embedModel || 'bge-m3:latest', style: { maxWidth: '260px' } });
    // 임베딩 모델을 바꾸면 인덱스가 stale로 감지되므로 상태 카드를 즉시 재평가한다.
    embedI.addEventListener('input', () => { r.embedModel = embedI.value.trim() || 'bge-m3:latest'; renderStatus(); });

    const expSrv = el('input', { type: 'checkbox', checked: r.expandServer !== false });
    expSrv.addEventListener('change', () => { r.expandServer = expSrv.checked; });
    const expCat = el('input', { type: 'checkbox', checked: !!r.expandCategory });
    expCat.addEventListener('change', () => { r.expandCategory = expCat.checked; });
    const checks = el('div', { class: 'row wrap', style: { gap: '18px' } },
      el('label', { class: 'chk-row' }, expSrv, el('span', {}, '같은 서버 도구 포함 (expandServer)')),
      el('label', { class: 'chk-row' }, expCat, el('span', {}, '같은 카테고리 도구 포함 (expandCategory)')));

    // 인덱스 상태 카드 + 구축/재구축
    const statusBox = el('div', { class: 'idx-card' });
    const progBar = el('div', { class: 'idx-prog-fill' });
    const progText = el('div', { class: 'idx-prog-text' }, '준비 중…');
    const progWrap = el('div', { class: 'idx-prog', style: { display: 'none' } },
      el('div', { class: 'idx-prog-track' }, progBar), progText);
    let building = false;

    function renderStatus() {
      // 현재 전략의 임베딩 모델을 함께 넘겨, 모델이 인덱스 구축 시점과 다르면 stale로 표시되게 한다.
      const st = indexStatus(mcps, r.embedModel || 'bge-m3:latest');
      const rows = [];
      if (!st.exists) {
        rows.push(el('div', { class: 'idx-state' }, el('span', { class: 'idx-dot off' }),
          el('span', {}, '인덱스가 아직 구축되지 않았습니다. 벡터·하이브리드 검색을 사용하려면 먼저 구축하세요(그 전까지 키워드로 폴백).')));
      } else {
        rows.push(el('div', { class: 'idx-state' }, el('span', { class: 'idx-dot ' + (st.stale ? 'stale' : 'on') }),
          el('span', {}, `도구 ${st.docCount}개 인덱싱됨 · ${st.embedModel || '?'} · dim ${st.dim} · 구축 ${fmt.date(st.builtAt)}`)));
        if (st.stale) rows.push(el('div', { class: 'idx-warn' },
          '⚠ MCP 구성이 변경되었습니다. 검색 정확도를 위해 인덱스를 재구축하세요(재구축 전까지 벡터·하이브리드는 키워드로 폴백됩니다).'));
      }
      const btn = el('button', { class: 'btn btn-sm btn-primary', onclick: build, disabled: building },
        building ? '구축 중…' : (st.exists ? '↻ 인덱스 재구축' : '⚙ 인덱스 구축'));
      statusBox.replaceChildren(
        el('div', { class: 'row between', style: { alignItems: 'flex-start', gap: '12px' } },
          el('div', { class: 'stack', style: { gap: '6px', minWidth: 0 } }, ...rows), btn),
        progWrap);
    }

    async function build() {
      if (building) return;
      const conn = await checkConnection();
      if (!conn.ok) { toast(`인덱스 구축에는 Ollama 연결이 필요합니다 (${conn.error}). 설정에서 연결을 확인하세요.`, 'error'); return; }
      building = true; vectorBuildAbort = new AbortController(); // 라우트 이탈 시 중단되도록 뷰 스코프에 등록(U4)
      progWrap.style.display = '';
      progBar.style.width = '0%';
      progText.textContent = '준비 중…';
      renderStatus();
      const model = r.embedModel || 'bge-m3:latest';
      const t0 = performance.now();
      try {
        await buildIndex({
          mcps, embedModel: model, signal: vectorBuildAbort.signal,
          onProgress: ({ done, total }) => {
            const pct = total ? Math.round(done / total * 100) : 0;
            progBar.style.width = pct + '%';
            progText.textContent = `임베딩 ${done}/${total} (${pct}%)`;
          },
        });
        toast(`카탈로그 인덱스를 구축했습니다 · 도구 ${mcps.reduce((n, m) => n + (m.tools?.length || 0), 0)}개 · ${Math.round((performance.now() - t0) / 1000)}초 (${model}).`, 'success');
      } catch (e) {
        if (e?.name === 'AbortError') toast('인덱스 구축을 중단했습니다.', 'warn');
        else toast('인덱스 구축 실패: ' + (e?.message || e), 'error');
      }
      building = false; vectorBuildAbort = null;
      progWrap.style.display = 'none';
      renderStatus();
    }
    renderStatus();

    const formBody = el('div', { class: 'stack', style: { display: cfg.catalogMode === 'retrieval' ? '' : 'none', marginTop: '2px' } },
      field({ label: '검색 방식 (method)', input: methodSeg, hint: '벡터: 임베딩 코사인 · 키워드: 간이 BM25(한글 2-gram) · 하이브리드: 두 점수 결합' }),
      el('div', { class: 'grid cols-2' },
        field({ label: '상위 K (topK)', input: topKInput, hint: '검색으로 공급할 도구 수 (1~30)' }),
        field({ label: '임베딩 모델 (embedModel)', input: embedI, hint: '인덱스 구축·벡터/하이브리드 질의에 사용' })),
      field({ label: '점수 임계값 (threshold)', input: el('div', { class: 'row' }, thInput, thVal), hint: '이 점수 미만 도구 제외 · 벡터=코사인, 하이브리드=정규화 0~1' }),
      alphaWrap,
      field({ label: '이웃 확장', input: checks, hint: '검색된 도구의 서버/카테고리 이웃 도구를 함께 공급합니다.' }),
      el('div', { class: 'panel-title', style: { marginTop: '4px' } }, '인덱스 상태'),
      statusBox);

    const modeSeg = segmented(
      [{ value: 'full', label: '전체 제공' }, { value: 'retrieval', label: '검색 기반 (RAG)' }],
      cfg.catalogMode || 'full',
      (v) => { cfg.catalogMode = v; formBody.style.display = (v === 'retrieval') ? '' : 'none'; });

    return el('div', { class: 'stack catalog-section' },
      el('div', { style: { height: '1px', background: 'var(--line-soft)', margin: '6px 0 2px' } }),
      el('div', { class: 'panel-title' }, '도구 카탈로그 공급'),
      field({ input: modeSeg, hint: '전체 제공: 모든 도구를 프롬프트에 나열 · 검색 기반: 질의와 관련된 도구만 검색해 공급(컨텍스트 절약)' }),
      formBody);
  }

  /* ---------- skill 편집기 ---------- */
  function skillEditor(draft) {
    const cfg = draft.config;
    const selTa = el('textarea', { class: 'input mono-input', spellcheck: 'false', style: { minHeight: '120px', lineHeight: '1.75' } });
    selTa.value = cfg.selectorPrompt || DEFAULT_SKILL_SELECTOR_PROMPT;
    selTa.addEventListener('input', () => { cfg.selectorPrompt = selTa.value; });
    const selReset = el('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: () => { selTa.value = DEFAULT_SKILL_SELECTOR_PROMPT; cfg.selectorPrompt = DEFAULT_SKILL_SELECTOR_PROMPT; },
    }, '기본값으로');

    const fillSeg = segmented(
      [{ value: 'llm', label: 'LLM이 채움' }, { value: 'template', label: '템플릿 사용' }],
      cfg.paramFill || 'template', (v) => { cfg.paramFill = v; });

    const skillsBody = el('div', { class: 'stack' });
    function drawSkills() {
      skillsBody.replaceChildren();
      (cfg.skills || []).forEach((sk, i) => skillsBody.appendChild(skillCard(sk, i)));
      skillsBody.appendChild(el('button', { class: 'btn btn-sm', onclick: () => { cfg.skills.push(newSkill()); drawSkills(); } }, '＋ 스킬 추가'));
    }
    function skillCard(sk, i) {
      const nameI = el('input', { class: 'input', value: sk.name || '' }); nameI.addEventListener('input', () => sk.name = nameI.value);
      const trigI = el('input', { class: 'input', value: sk.trigger || '' }); trigI.addEventListener('input', () => sk.trigger = trigI.value);
      const descI = el('input', { class: 'input', value: sk.description || '' }); descI.addEventListener('input', () => sk.description = descI.value);
      return el('div', { class: 'card', style: { padding: '12px' } },
        el('details', { open: i === 0 },
          el('summary', { class: 'accordion-sum' }, `🧰 ${sk.name || '스킬'}`),
          el('div', { class: 'stack', style: { marginTop: '10px' } },
            field({ label: '스킬 이름', input: nameI, required: true }),
            field({ label: '트리거 (한 줄 설명)', input: trigI, hint: '선택 라우터가 참고하는 짧은 트리거 문구' }),
            field({ label: '설명', input: descI }),
            el('div', { class: 'panel-title', style: { marginTop: '2px' } }, '단계'),
            stepsEditor(sk.steps || (sk.steps = [])),
            el('div', { class: 'row', style: { marginTop: '4px' } },
              el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { cfg.skills.splice(i + 1, 0, cloneSkill(sk)); drawSkills(); } }, '복제'),
              el('button', { class: 'btn btn-sm btn-danger', onclick: () => { cfg.skills.splice(i, 1); drawSkills(); } }, '삭제')))));
    }
    function cloneSkill(sk) { const c = JSON.parse(JSON.stringify(sk)); c.id = uuid(); c.name = (sk.name || '스킬') + ' 복제'; return c; }
    drawSkills();

    return el('div', { class: 'stack' },
      field({
        label: '스킬 선택 프롬프트 (selectorPrompt)',
        input: el('div', { class: 'stack' }, selTa, el('div', { class: 'row' }, selReset)),
        hint: 'LLM이 어떤 스킬을 고를지 판단하는 지침 · 플레이스홀더 {{SKILLS}}(스킬 목록) / {{QUERY}} / {{DATE}} 지원',
      }),
      field({
        label: '파라미터 채움 방식',
        input: el('div', { class: 'stack' }, fillSeg,
          el('div', { class: 'hint' }, 'LLM이 채움: 매 단계 파라미터를 LLM으로 생성 · 템플릿 사용: paramsTemplate 치환만 사용')),
      }),
      el('div', { class: 'panel-title' }, '스킬 목록'),
      skillsBody);
  }

  /* ---------- rule 편집기 ---------- */
  function ruleEditor(draft) {
    const cfg = draft.config;
    const rulesBody = el('div', { class: 'stack' });

    function drawRules() {
      rulesBody.replaceChildren();
      (cfg.rules || []).forEach((r, i) => rulesBody.appendChild(ruleCard(r, i)));
      rulesBody.appendChild(el('button', { class: 'btn btn-sm', onclick: () => { cfg.rules.push(newRule(cfg.rules.length * 10)); drawRules(); } }, '＋ 룰 추가'));
    }
    function ruleCard(r, i) {
      const nameI = el('input', { class: 'input', value: r.name || '' }); nameI.addEventListener('input', () => r.name = nameI.value);
      const prioI = el('input', { class: 'input', type: 'number', value: String(r.priority ?? 0), style: { maxWidth: '90px' } });
      prioI.addEventListener('input', () => r.priority = Number(prioI.value) || 0);
      const modeSeg = segmented([{ value: 'any', label: '하나라도(any)' }, { value: 'all', label: '모두(all)' }], r.matchMode || 'any', (v) => r.matchMode = v);

      const condBody = el('div', { class: 'stack' });
      function drawConds() {
        condBody.replaceChildren();
        (r.conditions || []).forEach((c, ci) => condBody.appendChild(condRow(c, ci)));
        condBody.appendChild(el('button', { class: 'btn btn-sm', onclick: () => { r.conditions.push({ type: 'keyword', value: '' }); drawConds(); } }, '＋ 조건'));
      }
      function condRow(c, ci) {
        const warn = el('div', { class: 'hint' });
        const valI = el('input', { class: 'input mono-input', value: c.value || '', placeholder: (c.type === 'regex') ? '정규식 패턴 (예: KTX|무궁화)' : '포함될 키워드' });
        const typeSeg = segmented([{ value: 'keyword', label: '키워드' }, { value: 'regex', label: '정규식' }], c.type || 'keyword', (v) => { c.type = v; valI.placeholder = (v === 'regex') ? '정규식 패턴 (예: KTX|무궁화)' : '포함될 키워드'; validate(); });
        function validate() {
          if ((c.type || 'keyword') === 'regex') {
            try { new RegExp(c.value, 'i'); warn.textContent = ''; warn.style.color = ''; }
            catch (e) { warn.textContent = '⚠ 잘못된 정규식: ' + e.message; warn.style.color = 'var(--sig-red)'; }
          } else { warn.textContent = ''; }
        }
        valI.addEventListener('input', () => { c.value = valI.value; validate(); });
        validate();
        return el('div', { class: 'stack', style: { gap: '5px' } },
          el('div', { class: 'row', style: { gap: '8px' } }, typeSeg, el('div', { class: 'grow' }, valI),
            el('button', { class: 'btn btn-icon btn-sm btn-danger', title: '조건 삭제', onclick: () => { r.conditions.splice(ci, 1); drawConds(); } }, '✕')),
          warn);
      }
      drawConds();

      const move = (d) => {
        const j = i + d;
        if (j < 0 || j >= cfg.rules.length) return;
        [cfg.rules[i], cfg.rules[j]] = [cfg.rules[j], cfg.rules[i]];
        drawRules();
      };
      return el('div', { class: 'card', style: { padding: '12px' } },
        el('div', { class: 'row between' },
          el('div', { class: 'row', style: { gap: '8px', minWidth: 0 } }, el('div', { class: 'step-no' }, String(i + 1)), el('div', { class: 'grow' }, nameI)),
          el('div', { class: 'row', style: { gap: '4px' } },
            el('button', { class: 'btn btn-icon btn-sm', title: '위로', onclick: () => move(-1) }, '↑'),
            el('button', { class: 'btn btn-icon btn-sm', title: '아래로', onclick: () => move(1) }, '↓'),
            el('button', { class: 'btn btn-sm btn-danger', onclick: () => { cfg.rules.splice(i, 1); drawRules(); } }, '삭제'))),
        el('div', { class: 'row wrap', style: { marginTop: '10px', gap: '14px', alignItems: 'flex-start' } },
          field({ label: '우선순위 (낮을수록 먼저)', input: prioI }),
          field({ label: '매칭 모드', input: modeSeg })),
        el('div', { class: 'panel-title', style: { marginTop: '2px' } }, '조건'),
        condBody,
        el('div', { class: 'panel-title', style: { marginTop: '8px' } }, '단계'),
        stepsEditor(r.steps || (r.steps = [])));
    }
    drawRules();

    const fbTa = el('textarea', { class: 'input mono-input', spellcheck: 'false', style: { minHeight: '140px', lineHeight: '1.75' } });
    fbTa.value = cfg.fallbackPrompt || '';
    fbTa.addEventListener('input', () => cfg.fallbackPrompt = fbTa.value);
    const fbReset = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { fbTa.value = DEFAULT_PLANNER_PROMPT; cfg.fallbackPrompt = DEFAULT_PLANNER_PROMPT; } }, '기본 플래너 프롬프트 채우기');
    const fbWrap = el('div', { class: 'stack', style: { display: (cfg.onNoMatch === 'llmFallback') ? '' : 'none' } },
      field({ label: '폴백 프롬프트 (fallbackPrompt)', input: fbTa, hint: '비워두면 기본 플래너 프롬프트가 사용됩니다.' }),
      el('div', { class: 'row' }, fbReset));
    const noMatchSeg = segmented(
      [{ value: 'error', label: '오류 처리' }, { value: 'llmFallback', label: 'LLM 폴백' }],
      cfg.onNoMatch || 'error',
      (v) => { cfg.onNoMatch = v; fbWrap.style.display = (v === 'llmFallback') ? '' : 'none'; });

    return el('div', { class: 'stack' },
      el('div', { class: 'panel-title' }, '룰 목록 (우선순위 오름차순으로 평가)'),
      rulesBody,
      el('div', { class: 'panel-title', style: { marginTop: '6px' } }, '매치 실패 시 (onNoMatch)'),
      noMatchSeg, fbWrap);
  }

  /* ---------- db 편집기 (vector / graph) ---------- */
  function dbEditor(draft) {
    ensureDbUiExtStyles(); // v2 확장 스타일(.gv-tip 등)을 main.css 수정 없이 1회만 주입
    const cfg = draft.config;
    // 이전 버전·가져온 전략 방어: 누락 필드 보강
    if (cfg.store !== 'vector' && cfg.store !== 'graph') cfg.store = 'vector';
    if (!cfg.vector) cfg.vector = defaultVectorCfg();
    if (!cfg.graph) cfg.graph = defaultGraphCfg();
    if (!cfg.graph.edges) cfg.graph.edges = defaultGraphCfg().edges;
    backfillVectorCfg(cfg.vector);  // v2 신규 필드(docFields/mmrLambda) 보강
    backfillGraphCfg(cfg.graph);    // v2 신규 필드(maxDegree/hubNorm/path) 보강
    if (cfg.temperature == null) cfg.temperature = 0.1;
    if (cfg.maxSteps == null) cfg.maxSteps = 6;
    if (!cfg.planningMode) cfg.planningMode = 'plan';
    if (!cfg.systemPrompt) cfg.systemPrompt = DEFAULT_PLANNER_PROMPT;

    const modeHint = el('div', { class: 'hint' }, MODE_HINT[cfg.planningMode || 'plan']);
    const modeSeg = segmented(
      [{ value: 'plan', label: '플랜 우선' }, { value: 'react', label: 'ReAct' }],
      cfg.planningMode || 'plan',
      (v) => { cfg.planningMode = v; modeHint.textContent = MODE_HINT[v]; });

    const tempVal = el('span', { class: 'mono', style: { minWidth: '34px' } }, String(cfg.temperature ?? 0.1));
    const tempInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(cfg.temperature ?? 0.1) });
    tempInput.addEventListener('input', () => { cfg.temperature = Number(tempInput.value); tempVal.textContent = tempInput.value; });

    const stepsInput = numStepper(cfg.maxSteps ?? 6, 1, 20, (v) => { cfg.maxSteps = v; }); // clamp+동기화 통일(U2)

    const ta = el('textarea', { class: 'input mono-input', spellcheck: 'false', style: { minHeight: '240px', lineHeight: '1.75' } });
    ta.value = cfg.systemPrompt || '';
    ta.addEventListener('input', () => { cfg.systemPrompt = ta.value; });
    const chips = ['{{TOOL_CATALOG}}', '{{QUERY}}', '{{DATE}}'].map(ph =>
      el('button', { type: 'button', class: 'chip', onclick: () => insertAtCursor(ta, ph) }, ph));
    const resetBtn = el('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: async () => {
        if (!await confirmDialog('시스템 프롬프트를 기본값으로 되돌립니다. 계속할까요?', { danger: false, okLabel: '재설정' })) return;
        ta.value = DEFAULT_PLANNER_PROMPT; cfg.systemPrompt = DEFAULT_PLANNER_PROMPT;
      },
    }, '기본 프롬프트로 재설정');

    const storeBody = el('div', { class: 'stack', style: { marginTop: '2px' } });
    function renderStoreBody() {
      storeBody.replaceChildren(cfg.store === 'graph' ? dbGraphEditor(cfg) : dbVectorEditor(cfg));
    }
    const storeSeg = segmented(
      [{ value: 'vector', label: '🔎 vector db' }, { value: 'graph', label: '🕸️ graph db' }],
      cfg.store, (v) => { cfg.store = v; renderStoreBody(); });
    renderStoreBody();

    return el('div', { class: 'stack db-editor' },
      field({ label: 'DB 종류', input: storeSeg, hint: 'vector db: 임베딩 인덱스로 유사 도구 검색 · graph db: 도구 관계 그래프를 순회해 연관 도구 확장' }),
      field({ label: '플래닝 모드', input: el('div', { class: 'stack' }, modeSeg, modeHint) }),
      field({ label: 'temperature (창의성)', input: el('div', { class: 'row' }, tempInput, tempVal) }),
      field({ label: '최대 단계 수 (maxSteps)', input: stepsInput, hint: 'plan: 실행할 계획 단계 상한 · react: 최대 반복 횟수' }),
      field({
        label: '플래너 시스템 프롬프트',
        input: el('div', { class: 'stack' },
          el('div', { class: 'ph-chips' }, el('span', { class: 'hint' }, '플레이스홀더 삽입:'), ...chips),
          ta,
          el('div', { class: 'row' }, resetBtn),
          el('div', { class: 'hint' }, '{{TOOL_CATALOG}}는 vector/graph db로 검색된 도구 목록으로 치환됩니다(전체 카탈로그가 아님).')),
      }),
      el('div', { style: { height: '1px', background: 'var(--line-soft)', margin: '6px 0 2px' } }),
      storeBody);
  }

  /* ----- db: vector db 편집기 ----- */
  function dbVectorEditor(cfg) {
    const r = cfg.vector;
    backfillVectorCfg(r); // 직접 참조(docFields/mmrLambda) 전 보강
    const alphaLabel = (a) => `${Number(a).toFixed(2)} (벡터)`;
    const alphaVal = el('span', { class: 'mono', style: { minWidth: '76px' } }, alphaLabel(r.hybridAlpha ?? 0.5));
    const alphaInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(r.hybridAlpha ?? 0.5) });
    alphaInput.addEventListener('input', () => { r.hybridAlpha = Number(alphaInput.value); alphaVal.textContent = alphaLabel(r.hybridAlpha); });
    const alphaWrap = field({ label: '하이브리드 가중 (α = 벡터 비중)', input: el('div', { class: 'row' }, alphaInput, alphaVal), hint: 'α=1 벡터 전용 · α=0 키워드 전용 · 두 점수 각각 정규화 후 가중합' });
    alphaWrap.style.display = (r.method === 'hybrid') ? '' : 'none';

    const methodSeg = segmented(
      [{ value: 'vector', label: '벡터' }, { value: 'keyword', label: '키워드' }, { value: 'hybrid', label: '하이브리드' }],
      r.method || 'hybrid',
      (v) => { r.method = v; alphaWrap.style.display = (v === 'hybrid') ? '' : 'none'; });

    const topKInput = el('input', { class: 'input', type: 'number', min: '1', max: '30', value: String(r.topK ?? 8), style: { maxWidth: '120px' } });
    const clampTopK = (n) => Math.min(30, Math.max(1, Number.isFinite(n) ? n : 8));
    topKInput.addEventListener('input', () => { r.topK = clampTopK(Number(topKInput.value)); });
    topKInput.addEventListener('change', () => { r.topK = clampTopK(Number(topKInput.value)); topKInput.value = String(r.topK); }); // clamp 값 UI 동기화(U6)

    const thVal = el('span', { class: 'mono', style: { minWidth: '34px' } }, String(r.threshold ?? 0));
    const thInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(r.threshold ?? 0) });
    thInput.addEventListener('input', () => { r.threshold = Number(thInput.value); thVal.textContent = thInput.value; });

    // 임베딩 모델 드롭다운(설치된 모델 선택, 미연결 시 텍스트 폴백). 변경 시 인덱스 stale 재평가.
    // embedding:null → 전체 모델 노출(bge-m3 등 임베딩 모델이 보이도록).
    const embedI = modelPicker({
      value: r.embedModel && r.embedModel !== 'bge-m3:latest' ? r.embedModel : null,
      defaultModel: 'bge-m3:latest', embedding: null,
      onChange: (v) => { r.embedModel = v || 'bge-m3:latest'; renderStatus(); },
    });

    const expSrv = el('input', { type: 'checkbox', checked: r.expandServer !== false });
    expSrv.addEventListener('change', () => { r.expandServer = expSrv.checked; });
    const expCat = el('input', { type: 'checkbox', checked: !!r.expandCategory });
    expCat.addEventListener('change', () => { r.expandCategory = expCat.checked; });
    const checks = el('div', { class: 'row wrap', style: { gap: '18px' } },
      el('label', { class: 'chk-row' }, expSrv, el('span', {}, '같은 서버 도구 포함 (expandServer)')),
      el('label', { class: 'chk-row' }, expCat, el('span', {}, '같은 카테고리 도구 포함 (expandCategory)')));

    // v2(§2): 임베딩 문서 구성 — 인덱싱 시 각 도구 문서에 포함할 요소. 변경 시 재색인 필요(amber 안내).
    const DOC_FIELD_DEFS = [
      ['desc', '설명 (desc)', '도구·서버 설명 텍스트'],
      ['params', '입력 파라미터 (params)', '입력 파라미터 이름·설명'],
      ['outputs', '출력 스키마 (outputs)', '출력 스키마 키·설명'],
      ['examples', '예시 (examples)', 'examples·mock 샘플 값'],
      ['tags', '태그 (tags)', '서버 tags'],
    ];
    const docFieldsWarn = el('div', { class: 'idx-warn', style: { display: 'none', marginTop: '6px' } },
      '⚠ 임베딩 문서 구성을 변경했습니다. 검색에 반영하려면 아래에서 인덱스를 재구축(재색인)하세요.');
    const docChecks = el('div', { class: 'row wrap', style: { gap: '14px' } },
      ...DOC_FIELD_DEFS.map(([key, label, tip]) => {
        const chk = el('input', { type: 'checkbox', checked: !!r.docFields[key] });
        chk.addEventListener('change', () => { r.docFields[key] = chk.checked; docFieldsWarn.style.display = ''; renderStatus(); });
        return el('label', { class: 'chk-row', title: tip }, chk, el('span', {}, label));
      }));
    const docFieldsGroup = el('div', { class: 'stack', style: { gap: '2px' } }, docChecks, docFieldsWarn);

    // v2(§2): MMR 다양성 λ — 검색 시점 재정렬(재색인 불필요). 1=관련도만(MMR off), 0=다양성 최대.
    const mmrLabel = (v) => {
      const n = Number(v);
      if (n >= 0.999) return '1.00 · 관련도만(MMR off)';
      if (n <= 0.001) return '0.00 · 다양성 최대';
      return n.toFixed(2);
    };
    const mmrVal = el('span', { class: 'mono', style: { minWidth: '156px' } }, mmrLabel(r.mmrLambda ?? 1));
    const mmrInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(r.mmrLambda ?? 1) });
    mmrInput.addEventListener('input', () => { r.mmrLambda = Number(mmrInput.value); mmrVal.textContent = mmrLabel(r.mmrLambda); });

    // 인덱스 상태 카드 (catalogIndex 재사용)
    const statusBox = el('div', { class: 'idx-card' });
    const progBar = el('div', { class: 'idx-prog-fill' });
    const progText = el('div', { class: 'idx-prog-text' }, '준비 중…');
    const progWrap = el('div', { class: 'idx-prog', style: { display: 'none' } },
      el('div', { class: 'idx-prog-track' }, progBar), progText);
    let building = false;
    function renderStatus() {
      // §2/U2: 현재 문서 구성(docFields)까지 함께 넘겨, 인덱스 구축 시점과 구성이 다르면 stale로 정확히 표시(재진입 시 stale 정확 표시).
      const st = indexStatus(mcps, r.embedModel || 'bge-m3:latest', r.docFields);
      const rows = [];
      if (!st.exists) {
        rows.push(el('div', { class: 'idx-state' }, el('span', { class: 'idx-dot off' }),
          el('span', {}, '벡터 인덱스가 아직 구축되지 않았습니다. 벡터·하이브리드 검색을 사용하려면 먼저 구축하세요(그 전까지 키워드로 폴백).')));
      } else {
        rows.push(el('div', { class: 'idx-state' }, el('span', { class: 'idx-dot ' + (st.stale ? 'stale' : 'on') }),
          el('span', {}, `도구 ${st.docCount}개 인덱싱됨 · ${st.embedModel || '?'} · dim ${st.dim} · 구축 ${fmt.date(st.builtAt)}`)));
        if (st.stale) rows.push(el('div', { class: 'idx-warn' },
          '⚠ MCP 구성이 변경되었습니다. 검색 정확도를 위해 인덱스를 재구축하세요(재구축 전까지 벡터·하이브리드는 키워드로 폴백됩니다).'));
      }
      const btn = el('button', { class: 'btn btn-sm btn-primary', onclick: build, disabled: building },
        building ? '구축 중…' : (st.exists ? '↻ 인덱스 재구축' : '⚙ 인덱스 구축'));
      statusBox.replaceChildren(
        el('div', { class: 'row between', style: { alignItems: 'flex-start', gap: '12px' } },
          el('div', { class: 'stack', style: { gap: '6px', minWidth: 0 } }, ...rows), btn),
        progWrap);
    }
    async function build() {
      if (building) return;
      const conn = await checkConnection();
      if (!conn.ok) { toast(`인덱스 구축에는 Ollama 연결이 필요합니다 (${conn.error}). 설정에서 연결을 확인하세요.`, 'error'); return; }
      building = true; vectorBuildAbort = new AbortController(); // 라우트 이탈 시 중단되도록 뷰 스코프에 등록(U7)
      progWrap.style.display = ''; progBar.style.width = '0%'; progText.textContent = '준비 중…'; renderStatus();
      const model = r.embedModel || 'bge-m3:latest';
      const t0 = performance.now();
      try {
        await buildIndex({
          mcps, embedModel: model, docFields: r.docFields, signal: vectorBuildAbort.signal, // §2: 문서 구성 토글 전달
          onProgress: ({ done, total }) => {
            const pct = total ? Math.round(done / total * 100) : 0;
            progBar.style.width = pct + '%'; progText.textContent = `임베딩 ${done}/${total} (${pct}%)`;
          },
        });
        docFieldsWarn.style.display = 'none'; // 재색인 완료 → 문서 구성 변경 경고 해제
        toast(`벡터 인덱스를 구축했습니다 · 도구 ${mcps.reduce((n, m) => n + (m.tools?.length || 0), 0)}개 · ${Math.round((performance.now() - t0) / 1000)}초 (${model}).`, 'success');
      } catch (e) {
        if (e?.name === 'AbortError') toast('인덱스 구축을 중단했습니다.', 'warn');
        else toast('인덱스 구축 실패: ' + (e?.message || e), 'error');
      }
      building = false; vectorBuildAbort = null; progWrap.style.display = 'none'; renderStatus();
    }
    renderStatus();

    return el('div', { class: 'stack catalog-section' },
      el('div', { class: 'panel-title' }, '🔎 vector db — 임베딩 검색 파라미터'),
      field({ label: '검색 방식 (method)', input: methodSeg, hint: '벡터: 임베딩 코사인 · 키워드: 간이 BM25(한글 2-gram) · 하이브리드: 두 점수 결합' }),
      el('div', { class: 'grid cols-2' },
        field({ label: '상위 K (topK)', input: topKInput, hint: '검색으로 공급할 도구 수 (1~30)' }),
        field({ label: '임베딩 모델 (embedModel)', input: embedI, hint: '인덱스 구축·벡터/하이브리드 질의에 사용' })),
      field({ label: '점수 임계값 (threshold)', input: el('div', { class: 'row' }, thInput, thVal), hint: '이 점수 미만 도구 제외 · 벡터=코사인, 하이브리드=정규화 0~1' }),
      alphaWrap,
      field({ label: '이웃 확장', input: checks, hint: '검색된 도구의 서버/카테고리 이웃 도구를 함께 공급합니다.' }),
      field({ label: '임베딩 문서 구성 (docFields)', input: docFieldsGroup, hint: '인덱싱 시 각 도구 문서에 포함할 요소. 기본: 설명+입력 파라미터. 변경하면 인덱스를 재구축해야 반영됩니다.' }),
      field({ label: 'MMR 다양성 (λ)', input: el('div', { class: 'row' }, mmrInput, mmrVal), hint: 'λ=1 관련도만(MMR off·현행) · λ=0 다양성 최대 · 검색 시점 재정렬이라 재색인 불필요' }),
      el('div', { class: 'panel-title', style: { marginTop: '4px' } }, '벡터 인덱스 상태'),
      statusBox);
  }

  /* ----- db: graph db 편집기 + 시각화 ----- */
  function dbGraphEditor(cfg) {
    const g = cfg.graph;
    // 누락 필드 방어(구버전/가져온 db 전략): llm 엣지·extractModel 보강
    if (!g.edges) g.edges = defaultGraphCfg().edges;
    if (!g.edges.llm) g.edges.llm = { on: false, weight: 1.0, threshold: 1 };
    backfillGraphCfg(g); // v2 신규 필드(maxDegree/hubNorm/path) 직접 참조 전 보강
    const defaultEmbed = 'bge-m3:latest';
    const defaultExtract = store.get('settings')?.defaultModel || 'exaone3.5:7.8b';
    const GRAPH_KEY = graphMod?.GRAPH_KEY || 'catalogGraph';
    const getGraph = () => store.get(GRAPH_KEY);
    let graphCache = getGraph();
    const refreshGraphCache = () => { graphCache = getGraph(); };

    const vizHost = el('div', { class: 'graph-viz' });
    const vizState = { focusNode: null, seeds: new Set(), selected: new Set(), layout: null, layoutKey: null, nmap: null, nkey: null };
    // 시각화 표시 옵션(U2): 요약 보기는 노드당 상위 N개 엣지만·노드 상한 축소, semantic 엣지는 기본 숨김(토글 on).
    const vizOpts = { mode: 'summary', showSemantic: false, perNodeCap: 3 };

    function nodeIndexOf(graph, serverId, toolName) {
      if (!vizState.nmap || vizState.nkey !== graph.builtAt) {
        vizState.nmap = new Map((graph.nodes || []).map((n, i) => [`${n.serverId}/${n.toolName}`, i]));
        vizState.nkey = graph.builtAt;
      }
      return vizState.nmap.get(`${serverId}/${toolName}`);
    }

    function graphUnavailableNote() {
      return el('div', { class: 'graph-empty' }, '그래프 엔진 모듈(catalogGraph.js)을 불러오지 못해 시각화를 표시할 수 없습니다. 파라미터 설정·저장은 정상 동작합니다.');
    }

    // 시드/선택 노드는 항상 표시에서 보존한다(검색 미리보기 강조 유지).
    const pinnedNodes = () => new Set([...vizState.seeds, ...vizState.selected, ...(vizState.focusNode != null ? [vizState.focusNode] : [])]);

    // 노드당 상위 cap개 엣지만 남긴다(가중치 내림차순, 한쪽 끝점이라도 여유 있으면 유지 → 읽을 수 있는 밀도).
    function capEdgesPerNode(edges, cap) {
      const deg = new Map();
      const sorted = [...edges].sort((a, b) => b.w - a.w);
      const kept = [];
      for (const e of sorted) {
        const da = deg.get(e.a) || 0, db = deg.get(e.b) || 0;
        if (da < cap || db < cap) { kept.push(e); deg.set(e.a, da + 1); deg.set(e.b, db + 1); }
      }
      return kept;
    }

    // effectiveAdjacency → 무방향 중복 제거 + 표시 옵션(semantic 숨김·요약 캡·노드 상한) 적용.
    // 반환: { edges, nodeIdxs, note } 또는 { error }
    function prepareVizEdges(graph, edgeParams) {
      let adj;
      // §3: 노드 degree 상한·허브 정규화를 엔진에 전달(런타임 캡 → 재구축 불필요).
      try { adj = graphMod.effectiveAdjacency(graph, edgeParams, { maxDegree: g.maxDegree, hubNorm: g.hubNorm }); }
      catch (e) { return { error: '그래프 계산 오류: ' + (e?.message || e) }; }
      const edgeMap = new Map();
      adj.forEach((arr, from) => {
        for (const e of arr || []) {
          const directed = !!e.directed;
          const key = directed ? `d|${from}|${e.to}|${e.type}` : `u|${Math.min(from, e.to)}|${Math.max(from, e.to)}|${e.type}`;
          const prev = edgeMap.get(key);
          if (!prev || (e.w || 0) > prev.w) edgeMap.set(key, { a: from, b: e.to, w: e.w || 0, type: e.type, directed });
        }
      });
      let edges = [...edgeMap.values()];
      const notes = [];
      // U2: semantic 엣지 기본 숨김(토글로 표시). config는 그대로 두고 표시에서만 제외.
      const semanticCount = edges.filter(e => e.type === 'semantic').length;
      if (!vizOpts.showSemantic && semanticCount) {
        edges = edges.filter(e => e.type !== 'semantic');
        notes.push(`semantic 엣지 ${semanticCount}개 숨김(위 "semantic 표시"로 켜기)`);
      }
      // U2: 요약 보기 — 노드당 상위 N개 엣지만
      if (vizOpts.mode === 'summary') {
        const before = edges.length;
        edges = capEdgesPerNode(edges, vizOpts.perNodeCap);
        if (edges.length < before) notes.push(`요약: 노드당 상위 ${vizOpts.perNodeCap}개 엣지만 표시(${before}→${edges.length})`);
      }
      // U2: 표시 노드 상한(요약 60 / 전체 130) — 가중치 상위 엣지 중심으로 축소하되 시드/선택 노드는 보존
      const allNodes = new Set();
      edges.forEach(e => { allNodes.add(e.a); allNodes.add(e.b); });
      const MAX_NODES = vizOpts.mode === 'summary' ? 60 : 130;
      if (allNodes.size > MAX_NODES) {
        const pin = pinnedNodes();
        edges.sort((x, y) => y.w - x.w);
        const keep = new Set(pin); const kept = [];
        for (const e of edges) {
          if (keep.size >= MAX_NODES && !(keep.has(e.a) && keep.has(e.b))) continue;
          kept.push(e); keep.add(e.a); keep.add(e.b);
        }
        edges = kept.filter(e => keep.has(e.a) && keep.has(e.b));
        notes.push(`노드 과다(${allNodes.size}개) → 가중치 상위 ${keep.size}개만 표시`);
      }
      const nodeIdxs = [...new Set(edges.flatMap(e => [e.a, e.b]))].sort((x, y) => x - y);
      return { edges, nodeIdxs, note: notes.length ? notes.join(' · ') : null };
    }

    // 색+대시로 엣지 유형을 나타내는 범례 스와치(카테고리 색과 구분, 방향 엣지는 화살촉).
    function edgeSwatch(type) {
      const m = EDGE_META[type];
      const s = svgEl('svg', { class: 'gl-swatch', width: 26, height: 10, viewBox: '0 0 26 10' });
      s.appendChild(svgEl('line', { x1: 1, y1: 5, x2: m.directed ? 18 : 25, y2: 5, stroke: m.color, 'stroke-width': 2, 'stroke-dasharray': m.dash || null, 'stroke-linecap': 'round' }));
      if (m.directed) s.appendChild(svgEl('path', { d: 'M18,2 L25,5 L18,8 z', fill: m.color }));
      return s;
    }

    function legendBlocks(edges, nodeIdxs, graph) {
      const typesPresent = EDGE_ORDER.filter(t => edges.some(e => e.type === t));
      const catsPresent = [...new Set(nodeIdxs.map(i => graph.nodes[i]?.category || '기타'))];
      return [
        el('div', { class: 'graph-legend' }, el('span', { class: 'gl-title' }, '엣지(선)'),
          ...typesPresent.map(t => el('span', { class: 'gl-item' }, edgeSwatch(t), EDGE_META[t].short))),
        el('div', { class: 'graph-legend' }, el('span', { class: 'gl-title' }, '카테고리(노드)'),
          ...catsPresent.map(c => el('span', { class: 'gl-item' }, el('span', { class: 'gl-dot', style: { background: catColor(c) } }), c))),
      ];
    }

    const arrowMarker = (id, color) => svgEl('marker', { id, viewBox: '0 0 8 8', refX: 11, refY: 4, markerWidth: 5.5, markerHeight: 5.5, orient: 'auto' },
      svgEl('path', { d: 'M0,0 L8,4 L0,8 z', fill: color }));

    // 팬/줌 가능한 SVG 그래프를 만든다. idPrefix로 마커 id 충돌 방지(인라인/모달 공존).
    // wheelNeedsCtrl=true면 Ctrl/⌘+휠로만 확대(인라인에서 페이지 스크롤 가로채기 방지).
    function buildGraphSvg({ graph, edges, nodeIdxs, pos, state, W, H, idPrefix, onNodeClick, wheelNeedsCtrl }) {
      const focus = state.focusNode;
      const neighbors = new Set();
      if (focus != null) { neighbors.add(focus); edges.forEach(e => { if (e.a === focus) neighbors.add(e.b); if (e.b === focus) neighbors.add(e.a); }); }
      const dimmed = (i) => focus != null && !neighbors.has(i);

      // 표시 엣지 기준 노드별 연결 수(툴팁의 "연결 N"에 사용)
      const degMap = new Map();
      for (const e of edges) { degMap.set(e.a, (degMap.get(e.a) || 0) + 1); degMap.set(e.b, (degMap.get(e.b) || 0) + 1); }

      // §4 리치 호버 툴팁 — 뷰포트(.graph-viz-wrap) 내부 절대배치 HTML 오버레이(pointer-events:none).
      const wrap = el('div', { class: 'graph-viz-wrap' });
      const tip = el('div', { class: 'gv-tip', style: { display: 'none' } });
      function moveTip(clientX, clientY) {
        const wr = wrap.getBoundingClientRect();
        if (!wr.width) return;
        const tw = tip.offsetWidth || 190, th = tip.offsetHeight || 60;
        let x = clientX - wr.left + 14, y = clientY - wr.top + 14;
        if (x + tw > wr.width - 4) x = clientX - wr.left - tw - 14;   // 오른쪽 경계 → 왼쪽으로
        if (x < 4) x = 4;
        if (y + th > wr.height - 4) y = wr.height - th - 4;            // 아래 경계 → 위로 clamp
        if (y < 4) y = 4;
        tip.style.left = x.toFixed(0) + 'px';
        tip.style.top = y.toFixed(0) + 'px';
      }
      function showTip(clientX, clientY, rows) {
        tip.replaceChildren(...rows.filter(Boolean));
        tip.style.display = '';
        moveTip(clientX, clientY);
      }
      const hideTip = () => { tip.style.display = 'none'; };

      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'graph-svg', preserveAspectRatio: 'xMidYMid meet' });
      svg.appendChild(svgEl('defs', {}, arrowMarker(`${idPrefix}-arrow-io`, EDGE_META.io.color), arrowMarker(`${idPrefix}-arrow-llm`, EDGE_META.llm.color)));
      const pan = svgEl('g', { class: 'gv-pan' });

      const gEdges = svgEl('g', {});
      for (const e of edges) {
        const pa = pos.get(e.a), pb = pos.get(e.b);
        if (!pa || !pb) continue;
        const meta = EDGE_META[e.type] || { color: '#8894ab' };
        const on = focus == null || (e.a === focus || e.b === focus);
        // U4: 흐림(비포커스) 엣지는 화살표 마커를 제거해 잔상이 남지 않게 한다.
        const showArrow = meta.directed && on;
        const line = svgEl('line', {
          x1: pa.x.toFixed(1), y1: pa.y.toFixed(1), x2: pb.x.toFixed(1), y2: pb.y.toFixed(1),
          stroke: meta.color, 'stroke-width': (0.7 + Math.min(2, e.w) * 1.15).toFixed(2),
          'stroke-dasharray': meta.dash || null,
          'stroke-opacity': on ? (0.34 + Math.min(0.5, e.w * 0.3)).toFixed(2) : '0.05',
          'marker-end': showArrow ? `url(#${idPrefix}-arrow-${e.type === 'llm' ? 'llm' : 'io'})` : null,
        });
        line.appendChild(svgEl('title', {}, `${e.type}${meta.directed ? ' (A→B)' : ''} · w=${e.w.toFixed(2)}`));
        // §4: 엣지 리치 호버 — 유형 라벨 + 의미 1줄 + 방향(A도구→B도구) + 가중치.
        const emeta = EDGE_META[e.type] || {};
        const eLabel = emeta.label || e.type;
        const eDesc = emeta.desc || EDGE_DESC_FALLBACK[e.type] || '두 도구 사이의 연결입니다.';
        const nodeA = graph.nodes[e.a], nodeB = graph.nodes[e.b];
        const dirText = emeta.directed
          ? `${nodeA?.toolName || '?'} → ${nodeB?.toolName || '?'}`
          : `${nodeA?.toolName || '?'} ↔ ${nodeB?.toolName || '?'}`;
        line.addEventListener('pointerenter', (ev) => showTip(ev.clientX, ev.clientY, [
          el('div', { class: 'gv-tip-h' }, eLabel),
          el('div', { class: 'gv-tip-meta' }, eDesc),
          el('div', { class: 'gv-tip-tool' }, dirText),
          el('div', { class: 'gv-tip-meta' }, `가중치 w=${(e.w ?? 0).toFixed(2)}`),
        ]));
        line.addEventListener('pointermove', (ev) => moveTip(ev.clientX, ev.clientY));
        line.addEventListener('pointerleave', hideTip);
        gEdges.appendChild(line);
      }
      pan.appendChild(gEdges);

      const panState = { dragged: false };
      const gNodes = svgEl('g', {});
      for (const i of nodeIdxs) {
        const p = pos.get(i), node = graph.nodes[i];
        if (!p || !node) continue;
        const isSeed = state.seeds.has(i), isSel = state.selected.has(i);
        const rad = isSeed ? 7.5 : isSel ? 6.5 : 5;
        const grp = svgEl('g', { class: 'gv-node', style: 'cursor:pointer' });
        const circ = svgEl('circle', {
          cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: rad, fill: catColor(node.category || '기타'),
          'fill-opacity': dimmed(i) ? '0.16' : '0.92',
          stroke: isSeed ? '#ffffff' : isSel ? '#e8eef6' : 'rgba(0,0,0,.5)',
          'stroke-width': isSeed ? 2 : isSel ? 1.6 : 0.8,
          'stroke-opacity': dimmed(i) ? '0.2' : '1',
        });
        circ.appendChild(svgEl('title', {}, `${node.serverNameKo || node.serverId} / ${node.toolName}${node.category ? '  ·  ' + node.category : ''}`));
        grp.appendChild(circ);
        if ((isSeed || isSel || i === focus) && !dimmed(i)) {
          const label = String(node.toolName || '');
          const t = svgEl('text', { x: p.x.toFixed(1), y: (p.y - rad - 4).toFixed(1), 'text-anchor': 'middle', 'font-size': 9.5, fill: '#e8eef6', 'font-family': 'IBM Plex Mono, monospace' });
          t.textContent = label.length > 16 ? label.slice(0, 15) + '…' : label;
          grp.appendChild(t);
        }
        grp.addEventListener('click', () => { if (panState.dragged) return; onNodeClick(i); });
        // §4: 노드 리치 호버 — 아이콘 + 서버 nameKo + / 도구명 + 분야 + (연결 수/시드/선택).
        const srv = mcps.find(m => m.id === node.serverId);
        const nIcon = srv?.icon || '🔧';
        const nServerKo = srv?.nameKo || node.serverNameKo || node.serverId;
        const nCat = node.category || '기타';
        const nDeg = degMap.get(i) || 0;
        const tags = [`연결 ${nDeg}`, isSeed ? '시드' : null, isSel ? '선택' : null].filter(Boolean).join(' · ');
        grp.addEventListener('pointerenter', (ev) => showTip(ev.clientX, ev.clientY, [
          el('div', { class: 'gv-tip-h' }, `${nIcon} ${nServerKo}`),
          el('div', { class: 'gv-tip-tool' }, '/ ' + (node.toolName || '')),
          el('div', { class: 'gv-tip-meta' }, `분야 ${nCat} · ${tags}`),
        ]));
        grp.addEventListener('pointermove', (ev) => moveTip(ev.clientX, ev.clientY));
        grp.addEventListener('pointerleave', hideTip);
        gNodes.appendChild(grp);
      }
      pan.appendChild(gNodes);
      svg.appendChild(pan);

      // --- 팬/줌 (U5) ---
      let scale = 1, tx = 0, ty = 0, down = false, sx = 0, sy = 0;
      const apply = () => pan.setAttribute('transform', `translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale.toFixed(3)})`);
      svg.addEventListener('wheel', (e) => {
        if (wheelNeedsCtrl && !(e.ctrlKey || e.metaKey)) return; // 인라인: Ctrl/⌘+휠만 확대
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width * W;
        const py = (e.clientY - rect.top) / rect.height * H;
        const ns = Math.max(0.5, Math.min(6, scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        tx = px - (px - tx) * (ns / scale); ty = py - (py - ty) * (ns / scale);
        scale = ns; apply();
      }, { passive: false });
      svg.addEventListener('pointerdown', (e) => { down = true; panState.dragged = false; sx = e.clientX; sy = e.clientY; });
      svg.addEventListener('pointermove', (e) => {
        if (!down) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!panState.dragged && Math.hypot(dx, dy) < 3) return;
        panState.dragged = true; svg.style.cursor = 'grabbing';
        const rect = svg.getBoundingClientRect();
        tx += dx / rect.width * W; ty += dy / rect.height * H;
        sx = e.clientX; sy = e.clientY; apply();
      });
      const endDrag = () => { down = false; svg.style.cursor = ''; };
      svg.addEventListener('pointerup', endDrag);
      svg.addEventListener('pointerleave', endDrag);
      svg.addEventListener('dblclick', (e) => { e.preventDefault(); scale = 1; tx = 0; ty = 0; apply(); }); // 더블클릭: 확대/이동 초기화
      // svg + 툴팁 오버레이를 한 뷰포트(.graph-viz-wrap)에 담아 반환한다(오버레이 절대배치 기준).
      wrap.appendChild(svg);
      wrap.appendChild(tip);
      return wrap;
    }

    // 표시 옵션 컨트롤 바(요약/전체 · semantic 표시 · 크게 보기)
    function vizControlsBar() {
      const modeSeg = segmented(
        [{ value: 'summary', label: '요약(핵심)' }, { value: 'full', label: '전체 표시' }],
        vizOpts.mode, (v) => { vizOpts.mode = v; redrawViz(); });
      const semChk = el('input', { type: 'checkbox', checked: vizOpts.showSemantic });
      semChk.addEventListener('change', () => { vizOpts.showSemantic = semChk.checked; redrawViz(); });
      return el('div', { class: 'graph-viz-controls' },
        el('div', { class: 'gvc-seg' }, modeSeg),
        el('label', { class: 'chk-row gvc-chk' }, semChk, el('span', {}, 'semantic 표시')),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: openBigModal }, '⛶ 크게 보기'));
    }

    function drawGraphViz(host, graph, edgeParams, state) {
      host.replaceChildren();
      if (!graphMod) { host.appendChild(graphUnavailableNote()); return; }
      if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) {
        host.appendChild(el('div', { class: 'graph-empty' }, '그래프 db가 아직 구축되지 않았습니다. 위에서 [그래프 구축]을 실행하세요.'));
        return;
      }
      host.appendChild(vizControlsBar());
      const prep = prepareVizEdges(graph, edgeParams);
      if (prep.error) { host.appendChild(el('div', { class: 'graph-empty' }, prep.error)); return; }
      const { edges, nodeIdxs, note } = prep;
      if (!nodeIdxs.length) {
        host.appendChild(el('div', { class: 'graph-empty' }, vizOpts.showSemantic
          ? '현재 엣지 설정으로는 표시할 연결이 없습니다. 엣지 유형을 켜거나 임계값을 낮춰 보세요.'
          : '표시할 연결이 없습니다. "semantic 표시"를 켜거나 다른 엣지 유형을 켜 보세요.'));
        return;
      }

      const W = 720, H = 470, PAD = 28;
      const lkey = nodeIdxs.join(',') + '|' + vizOpts.mode + '|' + (vizOpts.showSemantic ? 1 : 0);
      let pos;
      if (state.layout && state.layoutKey === lkey) pos = state.layout;
      else { pos = forceLayout(graph, nodeIdxs, edges, W, H, PAD); state.layout = pos; state.layoutKey = lkey; }

      // buildGraphSvg는 .graph-viz-wrap(svg + 툴팁 오버레이)을 통째로 반환한다.
      const vizWrap = buildGraphSvg({
        graph, edges, nodeIdxs, pos, state, W, H, idPrefix: 'gv', wheelNeedsCtrl: true,
        onNodeClick: (i) => { state.focusNode = (state.focusNode === i ? null : i); redrawViz(); },
      });
      host.appendChild(vizWrap);
      legendBlocks(edges, nodeIdxs, graph).forEach(b => host.appendChild(b));
      if (note) host.appendChild(el('div', { class: 'hint', style: { color: 'var(--sig-amber)', marginTop: '4px' } }, 'ⓘ ' + note));
      host.appendChild(el('div', { class: 'hint', style: { marginTop: '2px' } },
        `표시 노드 ${nodeIdxs.length} · 엣지 ${edges.length} · 노드 hover=도구명, 클릭=이웃 강조 · 드래그=이동, Ctrl+휠=확대, 더블클릭=초기화`));
    }

    // "크게 보기" 확대 모달 — 넓은 캔버스 + 자유 휠 줌/드래그 팬(U5). 자체 focus 상태로 인라인과 독립.
    function openBigModal() {
      if (!graphMod || !(graphCache || getGraph())) { toast('먼저 그래프 db를 구축하세요.', 'warn'); return; }
      const graph = graphCache || getGraph();
      const host = el('div', { class: 'graph-modal-host' });
      const legendHost = el('div', {});
      const bigState = { focusNode: vizState.focusNode, seeds: vizState.seeds, selected: vizState.selected, layout: null, layoutKey: null };
      // 모바일(≤480px)은 세로 비율 캔버스로 화면을 채워 레터박스 빈공간을 줄인다(U3).
      const mobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
      const W = mobile ? 480 : 1040, H = mobile ? 760 : 680, PAD = mobile ? 24 : 34;
      function paint() {
        const prep = prepareVizEdges(graph, g.edges);
        if (prep.error || !prep.nodeIdxs.length) {
          host.replaceChildren(el('div', { class: 'graph-empty' }, prep.error || '표시할 연결이 없습니다.'));
          legendHost.replaceChildren();
          return;
        }
        const lkey = prep.nodeIdxs.join(',') + '|' + vizOpts.mode + '|' + (vizOpts.showSemantic ? 1 : 0);
        if (!bigState.layout || bigState.layoutKey !== lkey) {
          bigState.layout = forceLayout(graph, prep.nodeIdxs, prep.edges, W, H, PAD);
          bigState.layoutKey = lkey;
        }
        const vizWrap = buildGraphSvg({
          graph, edges: prep.edges, nodeIdxs: prep.nodeIdxs, pos: bigState.layout, state: bigState, W, H,
          idPrefix: 'gvbig', wheelNeedsCtrl: false,
          onNodeClick: (i) => { bigState.focusNode = (bigState.focusNode === i ? null : i); paint(); },
        });
        host.replaceChildren(vizWrap);
        legendHost.replaceChildren(...[
          ...legendBlocks(prep.edges, prep.nodeIdxs, graph),
          prep.note ? el('div', { class: 'hint', style: { color: 'var(--sig-amber)', marginTop: '4px' } }, 'ⓘ ' + prep.note) : null,
        ].filter(Boolean));
      }
      const modeSeg = segmented(
        [{ value: 'summary', label: '요약(핵심)' }, { value: 'full', label: '전체 표시' }],
        vizOpts.mode, (v) => { vizOpts.mode = v; bigState.layout = null; paint(); });
      const semChk = el('input', { type: 'checkbox', checked: vizOpts.showSemantic });
      semChk.addEventListener('change', () => { vizOpts.showSemantic = semChk.checked; bigState.layout = null; paint(); });
      paint();
      modal({
        title: '🕸️ 그래프 크게 보기', wide: true,
        body: el('div', { class: 'graph-modal' },
          el('div', { class: 'graph-viz-controls' },
            el('div', { class: 'gvc-seg' }, modeSeg),
            el('label', { class: 'chk-row gvc-chk' }, semChk, el('span', {}, 'semantic 표시')),
            el('span', { class: 'grow' }),
            el('span', { class: 'hint' }, '휠=확대 · 드래그=이동 · 더블클릭=초기화')),
          host, legendHost),
        onClose: () => { redrawViz(); }, // 모달에서 바꾼 표시 옵션을 인라인에도 반영
      });
    }

    let redrawTimer = null;
    function redrawViz() { drawGraphViz(vizHost, graphCache, g.edges, vizState); }
    // 디바운스 타이머를 뷰 스코프(pendingRedrawTimer)에도 반영해 cleanup에서 clearTimeout 되게 한다(U7).
    function scheduleRedraw() {
      clearTimeout(redrawTimer);
      redrawTimer = pendingRedrawTimer = setTimeout(() => { pendingRedrawTimer = null; redrawViz(); }, 120);
    }

    /* --- 엣지 설정 카드 --- */
    function edgeCard(type) {
      const meta = EDGE_META[type];
      if (!g.edges[type]) g.edges[type] = { on: false, weight: 1, ...(meta.hasTh ? { threshold: 0 } : {}) };
      const ep = g.edges[type];
      const onChk = el('input', { type: 'checkbox', checked: !!ep.on });
      const wVal = el('span', { class: 'mono', style: { minWidth: '34px' } }, Number(ep.weight ?? 1).toFixed(2));
      const wInput = el('input', { type: 'range', min: '0', max: '2', step: '0.05', value: String(ep.weight ?? 1) });
      wInput.addEventListener('input', () => { ep.weight = Number(wInput.value); wVal.textContent = Number(ep.weight).toFixed(2); scheduleRedraw(); });
      const controls = [
        el('label', { class: 'chk-row ec-on' }, onChk, el('span', { class: 'ec-title', style: { color: meta.color } }, meta.label)),
        el('div', { class: 'ec-ctrl' }, el('span', { class: 'ec-lbl' }, '가중치'), wInput, wVal),
      ];
      if (meta.hasTh) {
        const thInput = el('input', { class: 'input', type: 'number', min: '0', step: meta.thStep, value: String(ep.threshold ?? 0), style: { maxWidth: '84px' } });
        thInput.addEventListener('input', () => { ep.threshold = Number(thInput.value) || 0; scheduleRedraw(); });
        controls.push(el('div', { class: 'ec-ctrl' }, el('span', { class: 'ec-lbl' }, '임계값'), thInput));
      }
      const card = el('div', { class: 'edge-card' + (ep.on ? '' : ' off') + (meta.heavy ? ' heavy' : '') + (meta.warn ? ' leak' : '') },
        el('div', { class: 'ec-head' }, ...controls),
        el('div', { class: 'ec-desc hint' + (meta.heavy ? ' ec-warn' : '') }, meta.desc),
        // 정보 누출 경고(cooccur 등) — el 헬퍼가 null 자식을 걸러내므로 조건부로 전달(U9)
        meta.warn ? el('div', { class: 'ec-desc hint ec-warn' }, meta.warn) : null);
      // semantic/llm은 상태 카드(인덱스·LLM 안내)에도 영향 → 토글 시 상태 카드 갱신
      // llm 토글은 경로 추천 "사용 엣지" 세그먼트 활성/비활성에도 영향 → 함께 동기화.
      onChk.addEventListener('change', () => { ep.on = onChk.checked; card.classList.toggle('off', !ep.on); scheduleRedraw(); if (type === 'semantic' || type === 'llm') renderGraphStatus(); if (type === 'llm') renderPathEdgesSeg(); });
      return card;
    }

    /* --- 순회 파라미터 --- */
    // 공용 numStepper로 통일(clamp 후 blur 시 입력창 동기화, U2/U6).
    const numInput = (val, min, max, onSet) => numStepper(val, min, max, onSet, '110px');
    const seedSeg = segmented([{ value: 'vector', label: '벡터' }, { value: 'keyword', label: '키워드' }, { value: 'hybrid', label: '하이브리드' }], g.seedMethod || 'hybrid', (v) => g.seedMethod = v);
    const seedKInput = numInput(g.seedK ?? 5, 1, 20, (v) => g.seedK = v);
    const hopsInput = numInput(g.hops ?? 2, 1, 4, (v) => g.hops = v);
    const decayVal = el('span', { class: 'mono', style: { minWidth: '34px' } }, String(g.decay ?? 0.5));
    const decayInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(g.decay ?? 0.5) });
    decayInput.addEventListener('input', () => { g.decay = Number(decayInput.value); decayVal.textContent = decayInput.value; });
    const topKInput = numInput(g.topK ?? 8, 1, 30, (v) => g.topK = v);
    // 모델 드롭다운(설치된 모델 선택, 미연결 시 텍스트 폴백)
    // 임베딩 모델: embedding:null(전체 — bge-m3 등 임베딩 모델 노출) · 추출 LLM: embedding:false(채팅 모델)
    const gEmbedI = modelPicker({
      value: g.embedModel || null, defaultModel: defaultEmbed, embedding: null,
      onChange: (v) => { g.embedModel = v; renderGraphStatus(); },
    });
    const gExtractI = modelPicker({
      value: g.extractModel || null, defaultModel: defaultExtract, embedding: false,
      onChange: (v) => { g.extractModel = v; renderGraphStatus(); },
    });

    /* --- v2(§3): degree 상한 · 허브 정규화 · 경로 추천 파라미터 --- */
    // maxDegree/hubNorm은 effectiveAdjacency(시각화)에 즉시 반영 → 변경 시 재그리기.
    const maxDegInput = numInput(g.maxDegree ?? 12, 4, 30, (v) => { g.maxDegree = v; scheduleRedraw(); });
    const hubChk = el('input', { type: 'checkbox', checked: g.hubNorm !== false });
    hubChk.addEventListener('change', () => { g.hubNorm = hubChk.checked; scheduleRedraw(); });
    // 경로 추천: 빔 폭·최대 길이(런타임 파라미터, 재구축 불필요).
    const beamInput = numInput(g.path.beamWidth ?? 6, 1, 20, (v) => g.path.beamWidth = v);
    const pathLenInput = numInput(g.path.maxLen ?? 4, 2, 6, (v) => g.path.maxLen = v);
    // 사용 엣지 세그먼트(io / io+llm) — 자체 제어. io+llm은 llm 엣지가 켜져 있을 때만 활성.
    const pathEdgesSeg = el('div', { class: 'seg', role: 'tablist' });
    function renderPathEdgesSeg() {
      const llmOn = !!g.edges.llm?.on;
      // llm 엣지가 꺼지면 경로 엣지에서 llm 제거(강제 io).
      if (!llmOn && Array.isArray(g.path.edges) && g.path.edges.includes('llm')) g.path.edges = ['io'];
      const useLlm = llmOn && Array.isArray(g.path.edges) && g.path.edges.includes('llm');
      const cur = useLlm ? 'io_llm' : 'io';
      const mk = (val, label, disabled) => {
        const b = el('button', { class: val === cur ? 'on' : '', type: 'button', role: 'tab', disabled,
          title: disabled ? 'llm 엣지를 먼저 켜야 사용할 수 있습니다.' : '' }, label);
        if (!disabled) b.addEventListener('click', () => {
          if (val === cur) return;
          g.path.edges = (val === 'io_llm') ? ['io', 'llm'] : ['io'];
          renderPathEdgesSeg();
        });
        return b;
      };
      pathEdgesSeg.replaceChildren(mk('io', 'io만', false), mk('io_llm', 'io + llm', !llmOn));
    }
    renderPathEdgesSeg();

    /* --- 그래프 db 상태 카드 + 구축 --- */
    const statusBox = el('div', { class: 'idx-card' });
    const progBar = el('div', { class: 'idx-prog-fill' });
    const progText = el('div', { class: 'idx-prog-text' }, '준비 중…');
    const progWrap = el('div', { class: 'idx-prog', style: { display: 'none' } },
      el('div', { class: 'idx-prog-track' }, progBar), progText);
    let building = false, buildAbort = null;

    function renderGraphStatus() {
      statusBox.replaceChildren();
      if (!graphMod) {
        statusBox.appendChild(el('div', { class: 'idx-warn' }, '⚠ 그래프 엔진 모듈(catalogGraph.js)을 불러오지 못했습니다. 파라미터 설정·저장은 가능하지만 그래프 구축·시각화·검색은 사용할 수 없습니다.'));
        return;
      }
      // graphStatus 5번째 인자로 현재 원하는 엣지(semantic/llm on 여부)를 넘겨 needsRebuild 판정에 사용(U8).
      // 엔진이 아직 needsRebuild/rebuildReasons를 반환하지 않을 수 있으므로 undefined-safe하게 다룬다.
      const st = graphMod.graphStatus(mcps, benchmarks, g.embedModel || defaultEmbed, g.extractModel || defaultExtract,
        { wantSemantic: !!g.edges.semantic?.on, wantLlm: !!g.edges.llm?.on });
      const rows = [];
      if (!st.exists) {
        rows.push(el('div', { class: 'idx-state' }, el('span', { class: 'idx-dot off' }),
          el('span', {}, '그래프 db가 아직 구축되지 않았습니다. 도구 관계 그래프를 만들려면 구축하세요.')));
      } else {
        const ec = st.edgeCountByType || {};
        const needsRebuild = !!st.needsRebuild;
        rows.push(el('div', { class: 'idx-state' }, el('span', { class: 'idx-dot ' + ((st.stale || needsRebuild) ? 'stale' : 'on') }),
          el('span', {}, `노드 ${st.nodeCount}개 · 구축 ${fmt.date(st.builtAt)} · 의미유사 ${st.usedEmbed ? '사용(' + (st.embedModel || '?') + ')' : '미사용'} · LLM추출 ${st.usedLlm ? '사용(' + (st.extractModel || '?') + ')' : '미사용'}`)));
        // U10: 유형별 수는 "후보 총량"(구축 시 계산된 전량)임을 명시. 실제 활성은 파라미터로 결정.
        rows.push(el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '유형별 후보 엣지 수(구축된 전량) — 실제 활성 엣지는 아래 on/off·가중치·임계값으로 결정됩니다:'));
        rows.push(el('div', { class: 'graph-edge-counts' },
          ...EDGE_ORDER.map(t => el('span', { class: 'gec' }, el('span', { class: 'gec-dot', style: { background: EDGE_META[t].color } }), `${t} ${ec[t] || 0}`))));
        // U8: needsRebuild면 사유를 amber로 노출(신규 semantic/llm 포함·모델 변경·도구 변경 등).
        if (needsRebuild) {
          const reasons = Array.isArray(st.rebuildReasons)
            ? st.rebuildReasons.map(r => typeof r === 'string' ? r : (r?.label || r?.reason || String(r))).filter(Boolean)
            : [];
          rows.push(el('div', { class: 'idx-warn' }, '⚠ 재구축 필요: ' + (reasons.length ? reasons.join(' · ') : '요청한 엣지·모델·도구 구성이 현재 그래프와 다릅니다.')));
        } else if (st.stale) {
          rows.push(el('div', { class: 'idx-warn' }, '⚠ MCP·벤치마크·모델 구성이 변경되었습니다. 그래프를 재구축하세요.'));
        }
      }
      const idxSt = indexStatus(mcps, g.embedModel || defaultEmbed);
      if (g.edges.semantic?.on && !idxSt.exists) {
        rows.push(el('div', { class: 'hint', style: { color: 'var(--sig-amber)' } }, 'ℹ 임베딩 인덱스가 없어 지금 구축하면 의미 유사(semantic) 엣지는 제외됩니다. vector db에서 인덱스를 먼저 구축하면 포함됩니다.'));
      }
      if (g.edges.llm?.on) {
        rows.push(el('div', { class: 'hint', style: { color: 'var(--sig-amber)' } }, `⏱ llm 엣지가 켜져 있어 구축 시 도구마다 1회 LLM 호출(추출 모델: ${g.extractModel || defaultExtract})로 시간이 걸립니다.`));
      }
      const btn = el('button', { class: 'btn btn-sm btn-primary', onclick: buildGraphNow, disabled: building },
        building ? '구축 중…' : (st.exists ? '↻ 그래프 재구축' : '⚙ 그래프 구축'));
      const stopB = building ? el('button', { class: 'btn btn-sm btn-danger', onclick: () => buildAbort?.abort() }, '■ 중단') : null;
      statusBox.appendChild(el('div', { class: 'row between', style: { alignItems: 'flex-start', gap: '12px' } },
        el('div', { class: 'stack', style: { gap: '6px', minWidth: 0 } }, ...rows),
        el('div', { class: 'row', style: { gap: '6px' } }, stopB, btn)));
      statusBox.appendChild(progWrap);
    }

    async function buildGraphNow() {
      if (building || !graphMod) return;
      const idxSt = indexStatus(mcps, g.embedModel || defaultEmbed);
      const llmOn = !!g.edges.llm?.on;
      // llm(무거움) 우선 확인: Ollama 연결 필수 + 도구당 1회 호출 경고
      if (llmOn) {
        const conn = await checkConnection();
        if (!conn.ok) { toast(`llm 엣지 추출에는 Ollama 연결이 필요합니다 (${conn.error}). llm 엣지를 끄거나 설정에서 연결을 확인하세요.`, 'error'); return; }
        const ok = await confirmDialog(`llm 엣지가 켜져 있어 그래프 구축 시 도구마다 1회 LLM 호출로 의미 관계를 추출합니다(추출 모델: ${g.extractModel || defaultExtract}). 도구 수에 따라 수십 초~수 분 걸릴 수 있습니다. 계속할까요?`, { danger: false, okLabel: '구축' });
        if (!ok) return;
      } else if (g.edges.semantic?.on && !idxSt.exists) {
        const ok = await confirmDialog('임베딩 인덱스가 없습니다. 의미 유사(semantic) 엣지를 제외하고 그래프를 구축할까요? (vector db에서 인덱스를 구축하면 다음 재구축 때 포함됩니다.)', { danger: false, okLabel: '구축' });
        if (!ok) return;
      }
      building = true; buildAbort = new AbortController();
      graphBuildAbort = buildAbort; // 라우트 이탈·편집기 전환 시 중단되도록 뷰 스코프에 등록(U7)
      progWrap.style.display = ''; progBar.style.width = '0%'; progText.textContent = '준비 중…';
      renderGraphStatus();
      const t0 = performance.now();
      try {
        await graphMod.buildGraph({
          mcps, benchmarks, embedModel: g.embedModel || defaultEmbed,
          buildSemanticThreshold: g.edges.semantic?.threshold ?? 0.55,
          includeLlm: llmOn, extractModel: g.extractModel || defaultExtract,
          signal: buildAbort.signal,
          onProgress: ({ phase, done, total } = {}) => {
            const pct = total ? Math.round(done / total * 100) : 0;
            progBar.style.width = pct + '%';
            const label = PHASE_LABEL[phase] || phase || '구축';
            progText.textContent = `${label} ${done || 0}/${total || 0} (${pct}%)`;
          },
        });
        toast(`그래프 db를 구축했습니다 · ${Math.round((performance.now() - t0) / 1000)}초.`, 'success');
        refreshGraphCache();
        vizState.layout = null; vizState.layoutKey = null;
        vizState.seeds = new Set(); vizState.selected = new Set(); vizState.focusNode = null;
      } catch (e) {
        if (e?.name === 'AbortError') toast('그래프 구축을 중단했습니다.', 'warn');
        else toast('그래프 구축 실패: ' + (e?.message || e), 'error');
      }
      building = false; buildAbort = null; graphBuildAbort = null;
      progWrap.style.display = 'none';
      renderGraphStatus();
      redrawViz();
    }
    renderGraphStatus();

    /* --- 검색 미리보기 + 경로 추천 --- */
    const qInput = el('input', { class: 'input', placeholder: '예: 내일 서울에서 부산 가는 KTX 예매' });
    const searchBtn = el('button', { class: 'btn btn-primary', onclick: runPreview }, '🔍 검색');
    qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPreview(); });
    const previewHost = el('div', { class: 'stack graph-preview' });
    const pathHost = el('div', { class: 'stack graph-paths' });
    let previewing = false;

    function renderPreview(ret, graph) {
      vizState.seeds = new Set(); vizState.selected = new Set(); vizState.focusNode = null;
      (ret.seeds || []).forEach(s => { const i = nodeIndexOf(graph, s.serverId, s.toolName); if (i != null) vizState.seeds.add(i); });
      (ret.results || []).forEach(r => { const i = nodeIndexOf(graph, r.serverId, r.toolName); if (i != null && !vizState.seeds.has(i)) vizState.selected.add(i); });
      redrawViz();
      const rows = (ret.results || []).map(r => {
        const srv = mcps.find(m => m.id === r.serverId);
        const src = r.source === 'seed' ? badge('시드', 'green') : badge(`hop ${r.hop ?? 1}`, 'violet');
        return el('div', { class: 'gr-row' },
          el('span', { class: 'gr-name' }, srv ? `${srv.icon || ''} ${srv.nameKo || srv.name}` : r.serverId, el('small', {}, ' / ' + r.toolName)),
          src,
          el('span', { class: 'gr-score mono' }, (r.score ?? 0).toFixed(3)));
      });
      // 네이티브 replaceChildren는 null을 "null" 텍스트로 삽입하므로 falsy를 걸러 전달한다(U1).
      previewHost.replaceChildren(...[
        el('div', { class: 'panel-title', style: { margin: '0 0 4px' } }, `검색된 도구 ${ret.results?.length || 0}개${ret.usedEmbed === false ? ' · 의미유사 미사용' : ''}`),
        ret.fallbackReason ? el('div', { class: 'idx-warn' }, '⚠ ' + ret.fallbackReason) : null,
        ret.results?.length ? workflowChips(ret.results, mcps) : el('div', { class: 'hint' }, '관련 도구를 찾지 못했습니다. 시드 방식·홉·임계값을 조정해 보세요.'),
        ret.results?.length ? el('div', { class: 'gr-list' }, ...rows) : null,
      ].filter(Boolean));
    }

    function renderPaths(rec, graph, pathEdges) {
      if (!rec.paths?.length) {
        pathHost.replaceChildren(el('div', { class: 'hint' }, rec.note || 'io(방향) 엣지가 없어 추천할 워크플로우 경로가 없습니다.'));
        return;
      }
      // 근거 엣지 유형 표기(U1) — 경로 탐색에 사용한 방향 엣지 종류(io / io·llm)를 명시.
      const basis = (Array.isArray(pathEdges) && pathEdges.length ? pathEdges : ['io']).join('·');
      pathHost.replaceChildren(
        el('div', { class: 'row between', style: { margin: '0 0 4px', alignItems: 'baseline' } },
          el('div', { class: 'panel-title', style: { margin: 0 } }, `추천 워크플로우 경로 ${rec.paths.length}개`),
          el('span', { class: 'hint mono', style: { color: 'var(--tx3)' } }, `근거 엣지: ${basis}`)),
        ...rec.paths.map((p, i) => el('div', { class: 'gr-path' },
          el('div', { class: 'row', style: { gap: '8px' } }, el('span', { class: 'gr-path-no' }, `#${i + 1}`), el('span', { class: 'gr-score mono' }, 'score ' + (p.score ?? 0).toFixed(3))),
          workflowChips(p.steps || [], mcps))));
    }

    async function runPreview() {
      if (!graphMod) { toast('그래프 엔진 모듈이 없어 검색 미리보기를 사용할 수 없습니다.', 'warn'); return; }
      const graph = graphCache || getGraph();
      if (!graph) { toast('먼저 그래프 db를 구축하세요.', 'warn'); return; }
      const q = qInput.value.trim();
      if (!q) { toast('검색할 질의를 입력하세요.', 'warn'); qInput.focus(); return; }
      if (previewing) return;
      previewing = true; searchBtn.disabled = true;
      previewHost.replaceChildren(el('div', { class: 'row', style: { color: 'var(--tx2)' } }, el('div', { class: 'spin' }), el('span', {}, '그래프 검색 중…')));
      pathHost.replaceChildren();
      try {
        const ret = await graphMod.graphRetrieve(q, {
          mcps, graph, edgeParams: g.edges, seedMethod: g.seedMethod, seedK: g.seedK,
          hops: g.hops, decay: g.decay, topK: g.topK, embedModel: g.embedModel,
          maxDegree: g.maxDegree, hubNorm: g.hubNorm, // §3: degree 상한·허브 정규화
        });
        renderPreview(ret, graph);
      } catch (e) {
        previewHost.replaceChildren(el('div', { class: 'idx-warn' }, '검색 실패: ' + (e?.message || e)));
      }
      try {
        // §3: 경로 추천 파라미터(edges/beamWidth/maxLen)를 설정값에서 사용. llm은 llm 엣지 on일 때만 유효.
        const pathEdges = (Array.isArray(g.path.edges) ? g.path.edges : ['io'])
          .filter(t => t === 'io' || (t === 'llm' && g.edges.llm?.on));
        if (!pathEdges.length) pathEdges.push('io');
        const rec = await graphMod.recommendPaths(q, {
          mcps, graph, edgeParams: g.edges, seedMethod: g.seedMethod, seedK: Math.min(3, g.seedK || 3),
          edges: pathEdges, beamWidth: g.path.beamWidth, maxLen: g.path.maxLen,
          maxDegree: g.maxDegree, // §3/arch A2: 노드 최대 연결 상한을 경로 탐색에도 동일 적용(미리보기·실행 일관)
          pathEdges, // 하위호환: 구 시그니처(pathEdges) 병행 전달
          embedModel: g.embedModel,
        });
        renderPaths(rec, graph, pathEdges);
      } catch (e) {
        pathHost.replaceChildren(el('div', { class: 'hint' }, '경로 추천 실패: ' + (e?.message || e)));
      }
      previewing = false; searchBtn.disabled = false;
    }

    // 초기 시각화
    redrawViz();

    return el('div', { class: 'stack graph-editor' },
      el('div', { class: 'panel-title' }, '🕸️ graph db — 엣지 설정'),
      // U10: 후보/활성 구분 안내 — 이미 구축된 후보의 필터/가중치는 재구축 불필요, 신규 semantic/llm·모델 변경은 재구축 필요.
      el('div', { class: 'hint' }, '이미 구축된 후보 엣지의 on/off·가중치·임계값 조절은 아래 시각화·검색에 즉시 반영됩니다(재구축 불필요). semantic/llm 엣지를 새로 포함하거나 임베딩/추출 모델을 바꾸면 후보를 다시 계산해야 하므로 그래프 재구축이 필요합니다.'),
      el('div', { class: 'edge-cards' }, ...EDGE_ORDER.map(edgeCard)),
      el('div', { class: 'panel-title', style: { marginTop: '6px' } }, '순회 파라미터'),
      el('div', { class: 'grid cols-2' },
        field({ label: '시드 방식 (seedMethod)', input: seedSeg, hint: '질의로 시작 도구(시드)를 찾는 방식' }),
        field({ label: '시드 수 (seedK)', input: seedKInput, hint: '시작 도구 개수 (1~20)' }),
        field({ label: '홉 수 (hops)', input: hopsInput, hint: '시드에서 몇 단계까지 확산할지 (1~4)' }),
        field({ label: '감쇠 (decay)', input: el('div', { class: 'row' }, decayInput, decayVal), hint: '홉이 멀수록 점수를 줄이는 비율 (0~1)' }),
        field({ label: '상위 K (topK)', input: topKInput, hint: '최종 공급할 도구 수 (1~30)' }),
        field({ label: '노드 최대 연결 (maxDegree)', input: maxDegInput, hint: '노드별 최대 연결 수(io 출력 상한 포함) 4~30 · 축소는 즉시 반영, 확대는 재구축이 필요할 수 있음' }),
        field({ label: '허브 정규화 (hubNorm)', input: el('label', { class: 'chk-row' }, hubChk, el('span', {}, '허브 degree 정규화(1/√deg)')), hint: '연결이 많은 허브 노드의 확산 기여를 낮춰 결과 편중을 줄입니다.' })),
      el('div', { class: 'panel-title', style: { marginTop: '6px' } }, '경로 추천 (recommendPaths)'),
      el('div', { class: 'grid cols-2' },
        field({ label: '빔 폭 (beamWidth)', input: beamInput, hint: '경로 탐색 시 유지할 후보 경로 수 (1~20)' }),
        field({ label: '최대 경로 길이 (maxLen)', input: pathLenInput, hint: '추천 워크플로우의 최대 단계 수 (2~6)' }),
        field({ label: '사용 엣지 (edges)', input: pathEdgesSeg, hint: 'io: 입출력 방향 엣지만 · io+llm: llm 방향 엣지도 포함(llm 엣지 on일 때만 활성)' })),
      el('div', { class: 'panel-title', style: { marginTop: '6px' } }, '모델 선택'),
      el('div', { class: 'grid cols-2' },
        field({ label: '임베딩 모델 (embedModel)', input: gEmbedI, hint: 'semantic 엣지·벡터/하이브리드 시드에 사용 · 미선택 시 bge-m3:latest' }),
        field({ label: '추출 LLM (extractModel)', input: gExtractI, hint: 'llm 엣지 의미 관계 추출에 사용 · 미선택 시 기본 모델' })),
      el('div', { class: 'panel-title', style: { marginTop: '6px' } }, '그래프 db 상태'),
      statusBox,
      el('div', { class: 'panel-title', style: { marginTop: '6px' } }, '그래프 시각화'),
      vizHost,
      el('div', { class: 'panel-title', style: { marginTop: '6px' } }, '검색 미리보기 · 워크플로우 경로 추천'),
      el('div', { class: 'hint' }, '질의를 입력하면 graphRetrieve로 도구를 검색하고, 같은 질의로 recommendPaths 경로를 추천합니다. 시드/선택 노드는 위 그래프에서 강조됩니다.'),
      el('div', { class: 'row', style: { gap: '8px' } }, el('div', { class: 'grow' }, qInput), searchBtn),
      previewHost,
      pathHost);
  }

  function buildTypeEditor(draft) {
    if (draft.type === 'prompt') return promptEditor(draft);
    if (draft.type === 'skill') return skillEditor(draft);
    if (draft.type === 'rule') return ruleEditor(draft);
    if (draft.type === 'db') return dbEditor(draft);
    return el('div', { class: 'hint' }, '알 수 없는 전략 타입입니다.');
  }

  /* ---------- 편집기 본체 ---------- */
  function emptyEditor() {
    return el('div', { class: 'card' }, emptyState({
      icon: '🧠', title: '전략을 선택하세요',
      desc: '왼쪽 목록에서 전략을 선택하거나 새 전략을 만들어 편집을 시작하세요.',
      action: { label: '＋ 새 전략', onClick: openNewModal },
    }));
  }

  function openEditor(strategy) {
    cancelActiveWork(); // 편집기 전환 시 이전 편집기의 실행·그래프/벡터 구축·재그리기 타이머 정리(U7)
    const draft = JSON.parse(JSON.stringify(strategy));
    const meta = TYPE_META[draft.type] || { label: draft.type, kind: 'dim' };

    const nameInput = el('input', { class: 'input', value: draft.name || '' });
    const descInput = el('textarea', { class: 'input', rows: '2', spellcheck: 'false', style: { resize: 'vertical', minHeight: '46px', lineHeight: '1.5' } });
    descInput.value = draft.description || '';
    const modelSelect = el('select', { class: 'select' }, el('option', { value: '' }, '기본 모델 따름'));
    populateModels(modelSelect, draft.model);

    const persistDraft = () => {
      draft.updatedAt = new Date().toISOString();
      const clean = JSON.parse(JSON.stringify(draft));
      strategies = strategies.some(s => s.id === draft.id)
        ? strategies.map(s => s.id === draft.id ? clean : s)
        : [clean, ...strategies];
      store.set('strategies', strategies);
      renderList();
    };
    const syncCommon = () => { draft.name = nameInput.value.trim(); draft.description = descInput.value.trim(); draft.model = modelSelect.value || null; };

    const saveBtn = el('button', {
      class: 'btn btn-primary',
      onclick: () => { syncCommon(); const err = validateStrategy(draft, { strict: true }); if (err) { toast(err, 'error'); return; } persistDraft(); toast('전략이 저장되었습니다.', 'success'); },
    }, '💾 저장');
    const exportBtn = el('button', {
      class: 'btn btn-ghost',
      onclick: () => { syncCommon(); downloadJSON(JSON.parse(JSON.stringify(draft)), `strategy-${(draft.name || 'export').replace(/\s+/g, '-')}.json`); },
    }, '⬇ 내보내기');

    const editorCard = el('div', { class: 'card' },
      el('div', { class: 'row between', style: { marginBottom: '14px' } },
        el('div', { class: 'row', style: { gap: '8px' } }, badge(meta.label, meta.kind), el('span', { class: 'mono', style: { color: 'var(--tx3)', fontSize: '11px' } }, draft.id.slice(0, 8))),
        el('div', { class: 'row', style: { gap: '8px' } }, exportBtn, saveBtn)),
      el('div', { class: 'grid cols-2' },
        field({ label: '전략 이름', input: nameInput, required: true }),
        field({ label: '모델', input: modelSelect, hint: '비워두면 설정의 기본 모델을 사용합니다.' })),
      field({ label: '설명', input: descInput }),
      el('div', { style: { height: '1px', background: 'var(--line-soft)', margin: '4px 0 14px' } }),
      buildTypeEditor(draft));

    /* ----- 테스트 콘솔 ----- */
    const queryInput = el('input', { class: 'input', placeholder: '예: 내일 아침 서울에서 부산 가는 KTX 알려줘' });
    queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runTest(); });
    const runBtn = el('button', { class: 'btn btn-primary', onclick: runTest }, '▶ 실행');
    const stopBtn = el('button', { class: 'btn btn-danger', onclick: () => abortCtrl?.abort(), style: { display: 'none' } }, '■ 중단');
    const traceLog = el('div', { class: 'trace-log' });
    const traceHint = () => el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '질의를 입력하고 실행하면 실행 추적이 실시간으로 표시됩니다.');
    traceLog.appendChild(traceHint());
    const resultBox = el('div', {});

    const testCard = el('div', { class: 'card', style: { marginTop: '16px' } },
      el('div', { class: 'panel-title' }, '테스트 콘솔'),
      el('div', { class: 'row', style: { marginBottom: '12px', gap: '8px' } }, el('div', { class: 'grow' }, queryInput), runBtn, stopBtn),
      resultBox,
      el('div', { style: { marginTop: '12px' } }, traceLog));

    editorWrap.replaceChildren(editorCard, testCard);

    async function runTest() {
      const q = queryInput.value.trim();
      if (!q) { toast('테스트 질의를 입력하세요.', 'warn'); queryInput.focus(); return; }
      syncCommon();
      const err = validateStrategy(draft);
      if (err) { toast(err, 'error'); return; }

      const stored = strategies.find(s => s.id === draft.id);
      if (!stored || coreJSON(stored) !== coreJSON(draft)) {
        const ok = await confirmDialog('변경사항을 저장한 뒤 실행합니다. 계속할까요?', { danger: false, okLabel: '저장 후 실행' });
        if (!ok) return;
        persistDraft();
      }

      const needsLLM = draft.type !== 'rule' || draft.config.onNoMatch === 'llmFallback';
      if (needsLLM) {
        const conn = await checkConnection();
        if (!conn.ok) {
          toast(`이 전략은 LLM 연결이 필요합니다. Ollama 미연결(${conn.error}). 설정에서 연결을 확인하세요.`, 'error');
          return;
        }
      }
      await doRun(JSON.parse(JSON.stringify(draft)), q);
    }

    async function doRun(strategyToRun, query) {
      abortCtrl = new AbortController();
      runBtn.disabled = true; stopBtn.style.display = '';
      traceLog.replaceChildren();
      resultBox.replaceChildren(el('div', { class: 'row', style: { color: 'var(--tx2)' } }, el('div', { class: 'spin' }), el('span', {}, '실행 중…')));

      let res;
      try {
        res = await executeStrategy(strategyToRun, query, {
          mcps,
          signal: abortCtrl.signal,
          onTrace: (ev) => appendTrace(traceLog, ev),
        });
      } catch (e) {
        res = { ok: false, steps: [], trace: [], llmCalls: 0, totalLatencyMs: 0, error: String(e?.message || e) };
      }
      runBtn.disabled = false; stopBtn.style.display = 'none';
      abortCtrl = null;
      renderResult(resultBox, res);
    }
  }

  /* ---------- 트레이스 / 결과 렌더 ---------- */
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

  // ok/단계오류/성공단계 유무로 성공·부분 성공·부분 실패·실패 뱃지를 구분
  function resultBadge(res) {
    const steps = res.steps || [];
    const errored = steps.filter(s => s.error).length;
    const succeeded = steps.length - errored;
    if (res.ok) return res.hasStepErrors ? badge('부분 성공', 'amber') : badge('성공', 'green');
    return succeeded > 0 ? badge('부분 실패', 'amber') : badge('실패', 'red');
  }

  function renderResult(box, res) {
    const children = [
      el('div', { class: 'row between' },
        el('div', { class: 'panel-title', style: { margin: 0 } }, '실행 결과'),
        resultBadge(res)),
    ];
    if (res.error) children.push(el('div', { class: 'hint', style: { color: 'var(--sig-red)', marginTop: '4px' } }, res.error));
    else if (res.hasStepErrors) children.push(el('div', { class: 'hint', style: { color: 'var(--sig-amber)', marginTop: '4px' } }, '일부 단계에서 도구 오류가 발생했습니다(관찰로 전달되어 실행은 계속됨).'));
    if (res.usedFallback) children.push(el('div', { class: 'hint', style: { marginTop: '4px' } }, '⚙ 매치되는 룰이 없어 LLM 플래너로 폴백했습니다.'));
    if (res.steps?.length) {
      children.push(el('div', { style: { marginTop: '10px' } },
        workflowChips(res.steps, mcps, { marks: res.steps.map(s => s.error ? 'miss' : '') })));
    }
    if (res.finalAnswer) {
      children.push(el('div', { class: 'result-answer', style: { marginTop: '10px' } },
        el('div', { class: 'panel-title', style: { margin: '0 0 6px' } }, '최종 답변'),
        el('div', { style: { whiteSpace: 'pre-wrap', color: 'var(--tx1)' } }, res.finalAnswer)));
    }
    children.push(el('div', { class: 'row wrap', style: { marginTop: '12px', gap: '22px' } },
      stat('LLM 호출', String(res.llmCalls || 0)),
      stat('총 지연', fmt.ms(res.totalLatencyMs)),
      stat('실행 단계', String(res.steps?.length || 0))));
    box.replaceChildren(el('div', { class: 'card', style: { background: 'var(--bg1)' } }, ...children));
  }

  /* ---------- 모델 목록 로드 ---------- */
  async function populateModels(sel, current) {
    try {
      const models = await listModels();
      for (const m of models) sel.appendChild(el('option', { value: m.name, selected: m.name === current }, m.name));
      if (current && !models.some(m => m.name === current)) sel.appendChild(el('option', { value: current, selected: true }, current + ' (미설치)'));
    } catch {
      if (current) sel.appendChild(el('option', { value: current, selected: true }, current));
    }
  }

  /* ---------- 초기 마운트 ---------- */
  renderList();
  const initial = (selectedId && strategies.find(s => s.id === selectedId)) || strategies[0];
  if (initial) { selectedId = initial.id; renderList(); openEditor(initial); }
  else editorWrap.replaceChildren(emptyEditor());

  // cleanup: 라우트 이탈 시 실행·그래프/벡터 구축·재그리기 타이머 모두 중단(U7)
  return () => { cancelActiveWork(); };
}

/* ---------- DB(graph) 전략 공용 상수/헬퍼 ---------- */
// 엣지 유형 메타: 라벨·시각화 색·임계값 사용 여부·한국어 설명. heavy=구축 비용 큼(경고)
// 시각화 색은 노드 카테고리 팔레트(CAT_PALETTE, 채도 높은 색)와 겹치지 않도록 중립(회색조/웜뉴트럴) 색군으로
// 분리하고, 유형은 색+대시(실선/파선/점선/일점쇄선) 조합으로 구분한다(U3). directed=방향 엣지(화살표).
const EDGE_ORDER = ['io', 'semantic', 'server', 'category', 'cooccur', 'llm'];
const EDGE_META = {
  io: { label: 'io — 입출력 연결', short: 'io (실선·방향)', color: '#eef4fc', dash: null, directed: true, hasTh: true, thStep: '0.05', desc: '도구 A의 출력 필드가 도구 B의 입력 필드와 겹치면 A→B로 연결합니다(워크플로우 흐름·방향 있음).' },
  semantic: { label: 'semantic — 의미 유사', short: 'semantic (파선)', color: '#aeb9cd', dash: '5 4', directed: false, hasTh: true, thStep: '0.05', desc: '임베딩 벡터 코사인 유사도가 높은 도구쌍을 연결합니다(벡터 인덱스 필요).' },
  server: { label: 'server — 같은 서버', short: 'server (점선)', color: '#8894ab', dash: '1.5 4', directed: false, hasTh: false, desc: '같은 MCP 서버에 속한 도구끼리 연결합니다.' },
  category: { label: 'category — 같은 카테고리', short: 'category (긴 파선)', color: '#9ba7bf', dash: '11 6', directed: false, hasTh: false, desc: '같은 카테고리(서버 기준) 도구끼리 연결합니다(서버 연결과 중복 제외).' },
  cooccur: { label: 'cooccur — 공동 출현', short: 'cooccur (성긴 점선)', color: '#c6d0e0', dash: '2 6', directed: false, hasTh: true, thStep: '1', warn: '⚠ 벤치마크 정답 워크플로우에서 추출한 엣지입니다. 같은 벤치마크로 평가하면 정보 누출로 성능이 과대평가될 수 있습니다(기본 off 권장).', desc: '벤치마크 정답 워크플로우에서 함께 등장한 도구쌍을 연결합니다(등장 횟수).' },
  llm: { label: 'llm — LLM 의미 관계', short: 'llm (일점쇄선·방향)', color: '#dcc9a0', dash: '9 3 2 3', directed: true, hasTh: true, thStep: '1', heavy: true, desc: '⏱ LLM으로 도구 간 의미 관계를 추출해 A→B로 연결합니다(스키마가 달라도 개념이 이어지면 연결). 그래프 구축 시 도구당 1회 LLM 호출이 필요해 시간이 걸립니다 · 기본 off.' },
};

// §4 호버 툴팁용 짧은 의미 설명(EDGE_META.desc가 없거나 유형 미상일 때의 폴백).
const EDGE_DESC_FALLBACK = {
  io: '도구 A의 출력이 도구 B의 입력과 이어지는 방향 연결입니다.',
  semantic: '임베딩 유사도가 높은 도구쌍을 잇는 연결입니다.',
  server: '같은 MCP 서버에 속한 도구끼리의 연결입니다.',
  category: '같은 분야(카테고리) 도구끼리의 연결입니다.',
  cooccur: '벤치마크 정답에서 함께 등장한 도구쌍의 연결입니다.',
  llm: 'LLM이 추출한 도구 간 의미 관계(방향) 연결입니다.',
};

// v2 DB 편집기 확장 스타일 — main.css를 수정하지 않고 이 뷰에서 1회만 <style id="rbtl-dbui-ext">를 주입한다.
// (이미 존재하면 재주입하지 않음). .graph-viz-wrap을 position:relative로 만들어 .gv-tip 오버레이의 기준으로 삼는다.
function ensureDbUiExtStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('rbtl-dbui-ext')) return;
  const style = document.createElement('style');
  style.id = 'rbtl-dbui-ext';
  style.textContent = [
    '.graph-viz-wrap { position: relative; }',
    '.gv-tip {',
    '  position: absolute; z-index: 20; pointer-events: none;',
    '  max-width: 260px; padding: 7px 9px;',
    '  background: rgba(14, 20, 30, 0.92); border: 1px solid rgba(150, 170, 200, 0.28);',
    '  border-radius: 7px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.42);',
    "  font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-size: 11px;",
    '  line-height: 1.5; color: #e8eef6; backdrop-filter: blur(2px);',
    '}',
    '.gv-tip-h { font-size: 12px; font-weight: 600; color: #ffffff; margin-bottom: 1px; }',
    '.gv-tip-tool { color: #aedcff; word-break: break-all; }',
    '.gv-tip-meta { color: #9fb0c8; font-size: 10.5px; }',
    '.seg button:disabled { opacity: 0.4; cursor: not-allowed; }',
  ].join('\n');
  document.head.appendChild(style);
}

// buildGraph onProgress.phase → 한국어 진행 표시
const PHASE_LABEL = {
  io: '입출력 엣지 계산 중', semantic: '의미 유사(임베딩) 계산 중', server: '서버 엣지 계산 중',
  category: '카테고리 엣지 계산 중', cooccur: '공동출현 엣지 계산 중', llm: 'LLM 관계 추출 중',
  finalize: '마무리 중', save: '저장 중',
};

// 카테고리 → 노드 색 (SPEC §4 고정 10종에 팔레트를 1:1 배정, 미지의 값은 해시 폴백)
const CAT_ORDER = ['운행정보', '예매·발권', '안전·관제', '시설·유지보수', '물류·화물', '도시교통', '여객서비스', '기상·환경', '데이터분석', '요금·정산'];
const CAT_PALETTE = ['#31d07c', '#4da3ff', '#f4b63f', '#a78bfa', '#f06a5d', '#3ecfcf', '#e879a7', '#9db35c', '#ff9f6b', '#6ab7ff'];
function catColor(cat) {
  const i = CAT_ORDER.indexOf(cat);
  if (i >= 0) return CAT_PALETTE[i % CAT_PALETTE.length];
  let h = 0; const s = String(cat || '기타');
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// 결정적 의사난수 [0,1) — 같은 노드는 항상 같은 초기 위치(재배치 안정성)
function seededRand(n) { const x = Math.sin((n + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); }

/**
 * 경량 force-directed 레이아웃. 카테고리별 원형 클러스터로 초기화 후 반발·스프링·중심 중력 반복.
 * @returns Map<nodeIdx, {x,y}>
 */
function forceLayout(graph, nodeIdxs, edges, W, H, PAD) {
  const cats = [...new Set(nodeIdxs.map(i => graph.nodes[i]?.category || '기타'))];
  const catAngle = new Map(cats.map((c, k) => [c, 2 * Math.PI * k / Math.max(1, cats.length)]));
  const pos = new Map();
  nodeIdxs.forEach((i) => {
    const base = catAngle.get(graph.nodes[i]?.category || '기타') || 0;
    const cx = W / 2 + Math.cos(base) * W * 0.29;
    const cy = H / 2 + Math.sin(base) * H * 0.29;
    const a = 2 * Math.PI * seededRand(i);
    const rr = 18 + 54 * seededRand(i + 97);
    pos.set(i, { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, vx: 0, vy: 0 });
  });
  const ids = nodeIdxs;
  // 노드 간격·충돌 반경 확대(U2): 반발력↑·이상 간선길이↑·중심중력↓ → 겹침이 줄고 읽기 쉬운 밀도.
  const REPULSE = 2200, IDEAL = 76, SPRING = 0.012, GRAVITY = 0.02, DAMP = 0.86, MAXV = 22;
  const iters = ids.length > 70 ? 36 : 50;
  for (let it = 0; it < iters; it++) {
    for (let a = 0; a < ids.length; a++) {
      const pa = pos.get(ids[a]);
      for (let b = a + 1; b < ids.length; b++) {
        const pb = pos.get(ids[b]);
        let dx = pa.x - pb.x, dy = pa.y - pb.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = seededRand(a) - 0.5; dy = seededRand(b) - 0.5; d2 = dx * dx + dy * dy + 0.01; }
        const d = Math.sqrt(d2), f = REPULSE / d2;
        const fx = dx / d * f, fy = dy / d * f;
        pa.vx += fx; pa.vy += fy; pb.vx -= fx; pb.vy -= fy;
      }
    }
    for (const e of edges) {
      const pa = pos.get(e.a), pb = pos.get(e.b);
      if (!pa || !pb) continue;
      let dx = pb.x - pa.x, dy = pb.y - pa.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d - IDEAL) * SPRING * (0.5 + Math.min(2, e.w));
      const fx = dx / d * f, fy = dy / d * f;
      pa.vx += fx; pa.vy += fy; pb.vx -= fx; pb.vy -= fy;
    }
    for (const i of ids) {
      const p = pos.get(i);
      p.vx = (p.vx + (W / 2 - p.x) * GRAVITY) * DAMP;
      p.vy = (p.vy + (H / 2 - p.y) * GRAVITY) * DAMP;
      p.x += Math.max(-MAXV, Math.min(MAXV, p.vx));
      p.y += Math.max(-MAXV, Math.min(MAXV, p.vy));
      p.x = Math.max(PAD, Math.min(W - PAD, p.x));
      p.y = Math.max(PAD, Math.min(H - PAD, p.y));
    }
  }
  return pos;
}

/**
 * 모델 선택 위젯 — ollama.listModels로 설치된 모델 드롭다운(첫 항목 "기본값 (…)").
 * 값 선택 시 onChange(모델명|null). null이면 기본값 사용. Ollama 미연결이면 텍스트 인풋으로 폴백.
 * embedding: false=채팅 모델만 · true=임베딩 모델만 · null=전체(임베딩 모델도 노출). (U11)
 * 임베딩 모델 선택 드롭다운은 embedding:null(전체)로 호출해 bge-m3 등 임베딩 모델이 보이도록 한다.
 * @param {{value:string|null, defaultModel:string, onChange:(v:string|null)=>void, embedding?:boolean|null}} opts
 */
function modelPicker({ value, defaultModel, onChange, embedding = false }) {
  const wrap = el('div', { class: 'model-picker' },
    el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '모델 목록 불러오는 중…'));
  const buildSelect = (models) => {
    const sel = el('select', { class: 'select', style: { maxWidth: '260px' } });
    sel.appendChild(el('option', { value: '', selected: !value }, `기본값 (${defaultModel})`));
    let found = false;
    for (const m of models) {
      const cur = !!value && m.name === value;
      if (cur) found = true;
      // embedding:null(전체)일 때 임베딩 모델은 뒤에 [임베딩] 표기로 구분
      const suffix = (embedding === null && m.isEmbedding) ? ' [임베딩]' : '';
      sel.appendChild(el('option', { value: m.name, selected: cur }, m.name + suffix));
    }
    if (value && !found) sel.appendChild(el('option', { value, selected: true }, value + ' (미설치)'));
    sel.addEventListener('change', () => onChange(sel.value || null));
    wrap.replaceChildren(sel);
  };
  const buildInput = () => {
    const inp = el('input', { class: 'input', value: value || '', placeholder: defaultModel, style: { maxWidth: '260px' } });
    inp.addEventListener('input', () => onChange(inp.value.trim() || null));
    wrap.replaceChildren(inp);
  };
  listModels({ embedding })
    .then(models => buildSelect(Array.isArray(models) ? models : []))
    .catch(() => buildInput()); // Ollama 미연결 → 텍스트 인풋 폴백
  return wrap;
}

/* ---------- 헬퍼 ---------- */
// clamp 후 blur(change) 시 입력창 값도 동기화하는 숫자 입력(U2/U6) — seedK/hops/topK/maxSteps 공용.
function numStepper(val, min, max, onSet, maxWidth = '120px') {
  const clamp = (n) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  const inp = el('input', { class: 'input', type: 'number', min: String(min), max: String(max), value: String(val), style: { maxWidth } });
  inp.addEventListener('input', () => onSet(clamp(Number(inp.value))));
  inp.addEventListener('change', () => { const c = clamp(Number(inp.value)); onSet(c); inp.value = String(c); });
  return inp;
}

function insertAtCursor(ta, text) {
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}
