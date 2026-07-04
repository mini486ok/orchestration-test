// 오케스트레이션 스튜디오 — 전략 목록 + 3타입 편집기 + 테스트 콘솔
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import {
  el, uuid, toast, modal, confirmDialog, badge, field, segmented,
  jsonEditor, emptyState, downloadJSON, pickJSONFile, fmt, workflowChips,
} from '../core/ui.js';
import { listModels, checkConnection } from '../services/ollama.js';
import { executeStrategy, buildToolCatalog, DEFAULT_PLANNER_PROMPT, DEFAULT_SKILL_SELECTOR_PROMPT } from '../services/orchestrator.js';

const TYPE_META = {
  prompt: { label: '프롬프트', kind: 'green', icon: '💬', desc: 'LLM이 도구 카탈로그를 보고 계획(Plan) 또는 ReAct 방식으로 실행합니다.' },
  skill: { label: '스킬', kind: 'blue', icon: '🧰', desc: 'LLM이 미리 정의한 스킬(작업 절차) 중 하나를 골라 단계를 실행합니다.' },
  rule: { label: '룰', kind: 'amber', icon: '📐', desc: '키워드·정규식 규칙으로 LLM 없이 결정적으로 워크플로우를 매칭합니다.' },
};

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
  let selectedId = ctx?.params?.id || null;
  let abortCtrl = null; // 실행 중 AbortController (한 번에 하나)

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
      body: el('div', { class: 'grid cols-3' }, card('prompt'), card('skill'), card('rule')),
    });
  }

  function defaultConfig(type) {
    if (type === 'prompt') return { systemPrompt: DEFAULT_PLANNER_PROMPT, planningMode: 'plan', temperature: 0.2, maxSteps: 6 };
    if (type === 'skill') return { skills: [newSkill()], selectorPrompt: DEFAULT_SKILL_SELECTOR_PROMPT, paramFill: 'template' };
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

    const stepsInput = el('input', { class: 'input', type: 'number', min: '1', max: '20', value: String(cfg.maxSteps ?? 6), style: { maxWidth: '120px' } });
    stepsInput.addEventListener('input', () => { cfg.maxSteps = Number(stepsInput.value) || 6; });

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
      }));
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

  function buildTypeEditor(draft) {
    if (draft.type === 'prompt') return promptEditor(draft);
    if (draft.type === 'skill') return skillEditor(draft);
    if (draft.type === 'rule') return ruleEditor(draft);
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
    if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
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

  // cleanup: 라우트 이탈 시 실행 중단
  return () => { if (abortCtrl) abortCtrl.abort(); };
}

/* ---------- 헬퍼 ---------- */
function insertAtCursor(ta, text) {
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}
