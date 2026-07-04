// MCP 빌더 — 직접 정의(수동) + AI 자동 생성. ctx.params.id 있으면 수정 모드.
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import { auth } from '../core/auth.js';
import { el, badge, toast, field, jsonEditor, schemaTable, spinner, emptyState } from '../core/ui.js';
import { listModels, getDefaultModel, chatJSON, checkConnection } from '../services/ollama.js';
import { CATEGORIES, slugify, normalizeServer, validateSchema } from '../services/mcpUtils.js';

const EMOJIS = ['🚆', '🚄', '🚉', '🚇', '🛤️', '🚦', '🎫', '📡', '📊', '🧭', '🌦️', '🚨'];

const AI_SYSTEM = `당신은 철도·교통 도메인 MCP(Model Context Protocol) 서버 설계 전문가입니다.
사용자 요구사항을 읽고 McpServer 객체 1개를 JSON으로만 출력하세요. 설명·코드블록·주석은 절대 넣지 마세요.

McpServer 구조:
{
  "id": "kebab-case 영문소문자",
  "name": "영문 서버명",
  "nameKo": "한글 서버명",
  "icon": "이모지 1개",
  "category": "아래 10개 중 정확히 하나",
  "description": "서버 설명(한국어)",
  "version": "1.0.0",
  "tags": ["태그1","태그2"],
  "tools": [ Tool, ... ]
}
category 후보(반드시 이 중 하나): 운행정보, 예매·발권, 안전·관제, 시설·유지보수, 물류·화물, 도시교통, 여객서비스, 기상·환경, 데이터분석, 요금·정산

Tool 구조 (도구는 2~4개 권장):
{
  "name": "snake_case 도구명",
  "description": "도구 설명(한국어)",
  "inputSchema": { "type":"object", "properties": { ... }, "required": [ ... ] },
  "outputSchema": { "type":"object", "properties": { ... } }
}
스키마는 JSON Schema의 다음 부분집합만 사용: type(object/array/string/number/integer/boolean), properties, required, items, enum, default, description, examples, format(date/date-time/time). required 항목은 반드시 properties 안에 존재해야 합니다. 모든 description은 한국어로 작성하세요.

예시(형식 참고용):
{"id":"kr-subway-congestion","name":"Subway Congestion","nameKo":"지하철 혼잡도","icon":"🚇","category":"도시교통","description":"실시간 지하철 혼잡도와 혼잡 구간 우회 경로를 제공한다","version":"1.0.0","tags":["지하철","혼잡도"],"tools":[{"name":"get_congestion","description":"특정 역·시간대의 혼잡도를 조회한다","inputSchema":{"type":"object","properties":{"station":{"type":"string","description":"역 이름"},"time":{"type":"string","format":"time","description":"조회 시각"}},"required":["station"]},"outputSchema":{"type":"object","properties":{"level":{"type":"string","enum":["여유","보통","혼잡","매우혼잡"]},"congestionRate":{"type":"number","description":"혼잡률(%)"}}}}]}`;

/* ---------- 빌더 전용 헬퍼 (정규화/스키마 검증은 services/mcpUtils.js) ---------- */
function newTool(i = 1) {
  return {
    name: `tool_${i}`,
    description: '',
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', properties: {} },
  };
}
function parseTags(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean).slice(0, 8);
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
}

export async function render(container, ctx) {
  const editId = ctx?.params?.id || null;
  const isEdit = !!editId;
  const existing = isEdit ? (store.get('mcps') || []).find(m => m.id === editId) : null;

  if (isEdit && !existing) {
    container.replaceChildren(emptyState({
      icon: '🚧', title: '서버를 찾을 수 없습니다',
      desc: `id '${editId}' 에 해당하는 MCP 서버가 없습니다.`,
      action: { label: '카탈로그로 돌아가기', onClick: () => router.navigate('/mcps') },
    }));
    return;
  }

  // 작업 모델 (수동 편집기의 상태)
  const model = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: '', name: '', nameKo: '', icon: '🚆', category: CATEGORIES[0], description: '', version: '1.0.0', tags: [], tools: [] };
  if (!Array.isArray(model.tools)) model.tools = [];
  if (!model.tools.length && !isEdit) model.tools = [newTool(1)];

  /* ================= 기본 정보 폼 ================= */
  let idTouched = isEdit;
  let nameTouched = isEdit || !!existing?.name;

  const nameKoInput = el('input', { class: 'input', value: model.nameKo, placeholder: '예: 열차 운행정보 조회' });
  const nameInput = el('input', { class: 'input', value: model.name, placeholder: '예: KR Train Schedule' });
  const idInput = el('input', { class: 'input mono-input', value: model.id, placeholder: 'kr-train-schedule', disabled: isEdit });
  const categorySelect = el('select', { class: 'select' }, CATEGORIES.map(c => el('option', { value: c, selected: c === model.category }, c)));
  const versionInput = el('input', { class: 'input mono-input', value: model.version || '1.0.0', style: { width: '120px' } });
  const tagsInput = el('input', { class: 'input', value: (model.tags || []).join(', '), placeholder: 'KTX, 실시간, 시간표' });
  const descInput = el('textarea', { class: 'input', value: model.description || '', placeholder: '서버가 제공하는 기능을 한국어로 설명하세요.' });

  const iconPreview = el('div', { class: 'icon-preview' }, model.icon || '🚆');
  const iconPreviewWrap = el('div', { class: 'icon-preview-wrap' },
    iconPreview, el('div', { class: 'icon-caption' }, '미리보기'));
  const iconInput = el('input', {
    class: 'input', value: model.icon || '🚆', maxlength: '4', placeholder: '이모지 입력',
    style: { width: '90px', textAlign: 'center', fontSize: '18px' },
  });
  const palette = el('div', { class: 'emoji-palette' }, EMOJIS.map(em =>
    el('button', { type: 'button', onclick: () => { model.icon = em; iconInput.value = em; iconPreview.textContent = em; } }, em)));

  function suggest() {
    if (idTouched || isEdit) return;
    const s = slugify(model.name || model.nameKo);
    idInput.value = s; model.id = s;
  }
  nameKoInput.addEventListener('input', () => {
    model.nameKo = nameKoInput.value;
    if (!nameTouched) { nameInput.value = model.nameKo; model.name = model.nameKo; }
    suggest();
  });
  nameInput.addEventListener('input', () => { nameTouched = true; model.name = nameInput.value; suggest(); });
  idInput.addEventListener('input', () => { idTouched = true; model.id = idInput.value.trim(); });
  categorySelect.addEventListener('change', () => { model.category = categorySelect.value; });
  versionInput.addEventListener('input', () => { model.version = versionInput.value; });
  tagsInput.addEventListener('input', () => { model.tags = parseTags(tagsInput.value); });
  descInput.addEventListener('input', () => { model.description = descInput.value; });
  iconInput.addEventListener('input', () => { model.icon = iconInput.value; iconPreview.textContent = iconInput.value || '🚆'; });

  const infoCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, '기본 정보'),
    el('div', { class: 'grid cols-2' },
      field({ label: '한글 이름 (nameKo)', required: true, input: nameKoInput, hint: '카탈로그에 표시되는 이름' }),
      field({ label: '영문 이름 (name)', required: true, input: nameInput })),
    el('div', { class: 'grid cols-2' },
      field({ label: 'ID', required: true, input: idInput, hint: isEdit ? '수정 모드에서는 ID를 변경할 수 없습니다.' : '영문 소문자·하이픈 권장 (자동 제안, 수정 가능)' }),
      field({ label: '카테고리', required: true, input: categorySelect })),
    field({ label: '아이콘', input: el('div', { class: 'icon-row' }, iconPreviewWrap, iconInput), hint: '이모지 1개 — 아래에서 선택하거나 직접 입력' }),
    palette,
    field({ label: '설명', input: descInput, hint: '서버 기능을 한국어로 설명' }),
    el('div', { class: 'grid cols-2' },
      field({ label: '태그', input: tagsInput, hint: '쉼표(,)로 구분' }),
      field({ label: '버전', input: versionInput })));

  /* ================= 도구 편집기 ================= */
  const editorsRef = new Map(); // tool 객체 -> { inEd, outEd }
  const toolsWrap = el('div', {});

  function toolCard(tool, idx) {
    const nameInp = el('input', { class: 'input mono-input', value: tool.name, placeholder: 'snake_case 도구명' });
    nameInp.addEventListener('input', () => { tool.name = nameInp.value; });
    const descInp = el('input', { class: 'input', value: tool.description, placeholder: '이 도구가 하는 일 (한국어)' });
    descInp.addEventListener('input', () => { tool.description = descInp.value; });

    const inEd = jsonEditor({ value: tool.inputSchema, height: 150, onChange: (v) => { if (v && typeof v === 'object') tool.inputSchema = v; } });
    const outEd = jsonEditor({ value: tool.outputSchema, height: 150, onChange: (v) => { if (v && typeof v === 'object') tool.outputSchema = v; } });
    editorsRef.set(tool, { inEd, outEd });

    const move = (d) => {
      const j = idx + d;
      if (j < 0 || j >= model.tools.length) return;
      [model.tools[idx], model.tools[j]] = [model.tools[j], model.tools[idx]];
      renderTools();
    };

    return el('div', { class: 'tool-edit' },
      el('div', { class: 'tool-edit-head' },
        el('span', { class: 'step-no' }, String(idx + 1)),
        el('div', { class: 'grow' }, nameInp),
        el('div', { class: 'tool-edit-actions' },
          el('button', { class: 'btn btn-sm btn-icon', title: '위로', onclick: () => move(-1), disabled: idx === 0 }, '↑'),
          el('button', { class: 'btn btn-sm btn-icon', title: '아래로', onclick: () => move(1), disabled: idx === model.tools.length - 1 }, '↓'),
          el('button', {
            class: 'btn btn-sm btn-icon', title: '복제', onclick: () => {
              const copy = JSON.parse(JSON.stringify(tool)); copy.name = tool.name + '_copy';
              model.tools.splice(idx + 1, 0, copy); renderTools();
            },
          }, '⧉'),
          el('button', { class: 'btn btn-sm btn-icon btn-danger', title: '삭제', onclick: () => { model.tools.splice(idx, 1); renderTools(); } }, '✕'))),
      field({ label: '설명', input: descInp }),
      el('div', { class: 'schema-cols' },
        el('div', {}, el('div', { class: 'acc-sub' }, '입력 스키마 (inputSchema)'), inEd.root),
        el('div', {}, el('div', { class: 'acc-sub' }, '출력 스키마 (outputSchema)'), outEd.root)),
      el('div', { class: 'row', style: { marginTop: '9px' } },
        el('button', {
          class: 'btn btn-sm btn-ghost', onclick: () => {
            const r1 = validateSchema(inEd.get(), '입력');
            const r2 = validateSchema(outEd.get(), '출력');
            if (r1.ok && r2.ok) toast('스키마 검증 통과', 'success');
            else toast([r1.ok ? null : r1.msg, r2.ok ? null : r2.msg].filter(Boolean).join(' / '), 'error');
          },
        }, '✓ 스키마 검증')));
  }

  function renderTools() {
    editorsRef.clear();
    if (!model.tools.length) {
      toolsWrap.replaceChildren(el('div', { class: 'empty', style: { padding: '26px' } },
        el('div', { class: 'empty-title' }, '도구가 없습니다'),
        el('div', { class: 'empty-desc' }, '최소 1개의 도구가 필요합니다. "＋ 도구 추가"를 누르세요.')));
      return;
    }
    toolsWrap.replaceChildren(...model.tools.map((t, i) => toolCard(t, i)));
  }
  renderTools();

  const toolsCard = el('div', { class: 'card', style: { marginTop: '16px' } },
    el('div', { class: 'row between', style: { marginBottom: '12px' } },
      el('div', { class: 'panel-title', style: { margin: '0' } }, '도구 정의'),
      el('button', { class: 'btn btn-sm', onclick: () => { model.tools.push(newTool(model.tools.length + 1)); renderTools(); } }, '＋ 도구 추가')),
    toolsWrap);

  /* ---------- 저장 (수동) ---------- */
  function saveManual() {
    const errs = [];
    const id = String(model.id || '').trim();
    if (!id) errs.push('ID를 입력하세요.');
    else if (!/^[a-z0-9가-힣][a-z0-9가-힣-]*$/i.test(id)) errs.push('ID는 공백 없이 영문/숫자/하이픈으로 입력하세요.');
    if (!String(model.nameKo || '').trim()) errs.push('한글 이름(nameKo)을 입력하세요.');
    if (!String(model.name || '').trim()) errs.push('영문 이름(name)을 입력하세요.');
    if (!CATEGORIES.includes(model.category)) errs.push('카테고리를 선택하세요.');
    if (!model.tools.length) errs.push('도구를 최소 1개 추가하세요.');

    const others = (store.get('mcps') || []).filter(m => m.id !== (existing?.id));
    if (id && others.some(m => m.id === id)) errs.push(`ID '${id}'가 이미 존재합니다.`);

    const seen = new Set();
    model.tools.forEach((t, i) => {
      const nm = String(t.name || '').trim();
      if (!nm) errs.push(`${i + 1}번 도구의 이름이 비어 있습니다.`);
      else if (seen.has(nm)) errs.push(`도구 이름 '${nm}'이 중복됩니다.`);
      else seen.add(nm);
      const eds = editorsRef.get(t);
      if (eds) {
        if (!eds.inEd.isValid()) errs.push(`${i + 1}번 도구 inputSchema JSON 구문 오류`);
        else { const v = validateSchema(eds.inEd.get(), '입력'); if (!v.ok) errs.push(`${i + 1}번 도구: ${v.msg}`); }
        if (!eds.outEd.isValid()) errs.push(`${i + 1}번 도구 outputSchema JSON 구문 오류`);
        else { const v = validateSchema(eds.outEd.get(), '출력'); if (!v.ok) errs.push(`${i + 1}번 도구: ${v.msg}`); }
      }
    });

    if (errs.length) { toast(errs[0], 'error'); return; }

    const user = auth.session()?.username || 'user';
    const server = {
      id,
      name: String(model.name).trim(),
      nameKo: String(model.nameKo).trim(),
      icon: (model.icon || '').trim() || '🚆',
      category: model.category,
      description: String(model.description || '').trim(),
      version: String(model.version || '').trim() || '1.0.0',
      tags: parseTags(model.tags),
      author: (existing && existing.author && existing.author !== 'sample') ? existing.author : user,
      isSample: false,
      createdAt: existing?.createdAt || new Date().toISOString(),
      tools: model.tools.map(t => ({
        name: String(t.name).trim(),
        description: t.description || '',
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        ...(t.mock ? { mock: t.mock } : {}),
      })),
    };

    store.update('mcps', (list = []) => {
      const idx = list.findIndex(m => m.id === existing?.id);
      if (idx >= 0) { const copy = [...list]; copy[idx] = server; return copy; }
      return [...list, server];
    });
    toast(isEdit ? '서버가 수정되었습니다.' : '서버가 등록되었습니다.', 'success');
    router.navigate('/mcps');
  }

  const saveBar = el('div', { class: 'row end', style: { marginTop: '18px', gap: '9px' } },
    el('button', { class: 'btn btn-ghost', onclick: () => router.navigate('/mcps') }, '취소'),
    el('button', { class: 'btn btn-primary', onclick: saveManual }, isEdit ? '💾 변경 저장' : '💾 서버 등록'));

  const manualPane = el('div', {}, infoCard, toolsCard, saveBar);

  /* ================= AI 생성 탭 ================= */
  const aiDesc = el('textarea', {
    class: 'input', style: { minHeight: '120px' },
    placeholder: '만들고 싶은 MCP 서버를 자유롭게 설명하세요…\n예: 지하철 혼잡도를 조회하고 혼잡 구간 우회 경로를 추천하는 서버',
  });
  const aiModel = el('select', { class: 'select' }, el('option', { value: getDefaultModel() }, getDefaultModel() + ' (기본)'));
  (async () => {
    try {
      const models = await listModels();
      if (models.length) {
        aiModel.replaceChildren(...models.map(m => el('option', { value: m.name, selected: m.name === getDefaultModel() }, m.name)));
      }
    } catch { /* Ollama 미연결: 기본 옵션 유지 */ }
  })();

  const aiStatus = el('div', {});
  const aiPreview = el('div', {});
  const genBtn = el('button', { class: 'btn btn-primary' }, '✦ 생성');

  function renderPreview(server) {
    return el('div', { class: 'ai-preview' },
      el('div', { class: 'row', style: { gap: '12px', alignItems: 'flex-start' } },
        el('div', { class: 'icon-preview' }, server.icon),
        el('div', { class: 'grow' },
          el('div', { style: { fontSize: '16px', color: 'var(--tx0)', fontWeight: '600' } }, server.nameKo),
          el('div', { class: 'mcp-id', style: { marginTop: '2px' } }, server.id + ' · ' + server.name),
          el('div', { class: 'row wrap', style: { gap: '6px', marginTop: '7px' } },
            badge(server.category), badge(`도구 ${server.tools.length}개`, 'blue'), badge('v' + server.version, 'dim')),
          el('p', { style: { fontSize: '12.5px', color: 'var(--tx1)', marginTop: '8px', lineHeight: '1.6' } }, server.description))),
      el('div', {}, server.tools.map(t =>
        el('div', { class: 'ai-tool-box' },
          el('h5', {}, t.name),
          el('div', { style: { fontSize: '11.5px', color: 'var(--tx2)', marginBottom: '8px' } }, t.description),
          el('div', { class: 'acc-sub', style: { marginTop: '4px' } }, '입력'), schemaTable(t.inputSchema),
          el('div', { class: 'acc-sub' }, '출력'), schemaTable(t.outputSchema)))),
      server.tags?.length ? el('div', { class: 'mcp-tags', style: { marginTop: '12px' } }, server.tags.map(t => el('span', { class: 'tag-mini' }, '#' + t))) : null,
      el('div', { class: 'row wrap', style: { gap: '9px', marginTop: '14px' } },
        el('button', { class: 'btn btn-primary', onclick: () => registerGenerated(server) }, '✓ 바로 등록'),
        el('button', { class: 'btn', onclick: () => importToManual(server) }, '✎ 수동 편집기로 가져오기'),
        el('button', { class: 'btn btn-ghost', onclick: generate }, '↻ 다시 생성')));
  }

  async function generate() {
    const desc = aiDesc.value.trim();
    if (!desc) { toast('만들고 싶은 서버를 설명하세요.', 'warn'); return; }
    genBtn.disabled = true;
    aiPreview.replaceChildren();
    // 생성 전 Ollama 연결을 먼저 확인 — 실패 시 즉시 안내(가이드 링크)
    aiStatus.replaceChildren(el('div', { class: 'gen-status' }, spinner(), el('span', {}, 'Ollama 연결 확인 중…')));
    const conn = await checkConnection();
    if (!conn.ok) {
      aiStatus.replaceChildren();
      genBtn.disabled = false;
      toast(el('span', {}, `Ollama에 연결할 수 없습니다 (${conn.error}). `,
        el('a', { href: '#/guide', style: { color: 'var(--sig-green)', textDecoration: 'underline' } }, '연결 설정 가이드'),
        ' 를 확인하세요.'), 'error');
      return;
    }
    aiStatus.replaceChildren(el('div', { class: 'gen-status' }, spinner(), el('span', {}, 'LLM이 서버를 설계하는 중…')));
    try {
      const { data } = await chatJSON({
        model: aiModel.value,
        messages: [
          { role: 'system', content: AI_SYSTEM },
          { role: 'user', content: `다음 요구사항에 맞는 MCP 서버 하나를 설계해 JSON으로만 출력하세요.\n\n요구사항: ${desc}` },
        ],
        temperature: 0.3,
      });
      const existingIds = new Set((store.get('mcps') || []).map(m => m.id));
      const server = normalizeServer(data, existingIds);
      aiStatus.replaceChildren();
      aiPreview.replaceChildren(renderPreview(server));
    } catch (e) {
      aiStatus.replaceChildren();
      toast('생성 실패: ' + (e.message || e), 'error');
    } finally {
      genBtn.disabled = false;
    }
  }
  genBtn.addEventListener('click', generate);

  function registerGenerated(server) {
    const user = auth.session()?.username || 'user';
    const existingIds = new Set((store.get('mcps') || []).map(m => m.id));
    const s = existingIds.has(server.id) ? normalizeServer(server, existingIds) : server;
    const rec = { ...s, author: user, isSample: false, createdAt: new Date().toISOString() };
    store.update('mcps', (list = []) => [...list, rec]);
    toast(`'${rec.nameKo}' 서버가 등록되었습니다.`, 'success');
    router.navigate('/mcps');
  }

  function importToManual(server) {
    if (!isEdit) { model.id = server.id; idTouched = true; idInput.value = server.id; }
    model.name = server.name; model.nameKo = server.nameKo; model.icon = server.icon;
    model.category = server.category; model.description = server.description; model.version = server.version;
    model.tags = server.tags.slice();
    model.tools = JSON.parse(JSON.stringify(server.tools));
    nameTouched = true;

    nameKoInput.value = model.nameKo;
    nameInput.value = model.name;
    iconInput.value = model.icon; iconPreview.textContent = model.icon;
    categorySelect.value = model.category;
    descInput.value = model.description;
    tagsInput.value = model.tags.join(', ');
    versionInput.value = model.version;
    renderTools();
    switchTab('manual');
    toast('수동 편집기로 불러왔습니다. 확인 후 저장하세요.', 'success');
  }

  const aiPane = el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'panel-title' }, 'AI로 MCP 서버 생성'),
      el('p', { class: 'hint', style: { marginBottom: '12px' } },
        'LLM이 요구사항을 읽고 도구·스키마를 갖춘 MCP 서버 JSON을 설계합니다. 이 기능은 Ollama 연결이 필요합니다.'),
      field({ label: '요구사항 설명', input: aiDesc, required: true }),
      el('div', { class: 'grid cols-2' },
        field({ label: '생성 모델', input: aiModel, hint: '기본값은 설정의 기본 모델입니다.' }),
        el('div', { class: 'fld', style: { justifyContent: 'flex-end' } }, genBtn)),
      aiStatus,
      aiPreview));

  /* ================= 탭 ================= */
  const tabManual = el('button', {}, '✎ 직접 정의');
  const tabAi = el('button', {}, '✦ AI로 생성');
  function switchTab(t) {
    tabManual.classList.toggle('on', t === 'manual');
    tabAi.classList.toggle('on', t === 'ai');
    manualPane.style.display = t === 'manual' ? '' : 'none';
    aiPane.style.display = t === 'ai' ? '' : 'none';
  }
  tabManual.addEventListener('click', () => switchTab('manual'));
  tabAi.addEventListener('click', () => switchTab('ai'));

  container.replaceChildren(
    el('div', { class: 'row between', style: { marginBottom: '10px' } },
      el('div', { class: 'hint' }, isEdit ? `수정 중: ${existing.nameKo || existing.id}` : '새 MCP 서버를 정의합니다.'),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: () => router.navigate('/mcps') }, '← 카탈로그')),
    el('div', { class: 'tabs' }, tabManual, tabAi),
    manualPane,
    aiPane);

  switchTab('manual');
}
