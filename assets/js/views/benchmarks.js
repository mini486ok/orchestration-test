// 벤치마크 랩 — 세트 목록/상세, LLM 자동 생성 마법사, 수동 항목 작성기
import { store } from '../core/store.js';
import {
  el, uuid, toast, modal, confirmDialog, badge, spinner, emptyState,
  field, jsonEditor, workflowChips, fmt, downloadJSON, pickJSONFile,
} from '../core/ui.js';
import { checkConnection, listModels, getDefaultModel } from '../services/ollama.js';
import { generateBenchmarkItems } from '../services/benchmarkGen.js';

const DIFF_LABEL = { easy: '쉬움', medium: '보통', hard: '어려움' };
const DIFF_KIND = { easy: 'green', medium: 'amber', hard: 'red' };

/* ---------- 소도구 ---------- */
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

function difficultyDist(items) {
  const d = { easy: 0, medium: 0, hard: 0 };
  for (const it of items) if (d[it.difficulty] !== undefined) d[it.difficulty]++;
  return d;
}

function fileSlug(s) {
  return String(s || 'set').trim().replace(/\s+/g, '-').replace(/[^\w가-힣-]/g, '').slice(0, 40) || 'set';
}

/* ---------- 가져오기 정규화 ---------- */
function normalizeImportedItem(it) {
  if (!it || typeof it !== 'object') return null;
  const query = String(it.query || '').trim();
  if (!query) return null;
  const expected = Array.isArray(it.expected)
    ? it.expected
        .filter(s => s && s.serverId && s.toolName)
        .map(s => ({
          serverId: String(s.serverId),
          toolName: String(s.toolName),
          params: (s.params && typeof s.params === 'object' && !Array.isArray(s.params)) ? s.params : {},
        }))
    : [];
  const difficulty = ['easy', 'medium', 'hard'].includes(it.difficulty) ? it.difficulty : 'medium';
  const out = {
    id: uuid(), query, expected,
    category: String(it.category || ''),
    difficulty,
    source: it.source === 'auto' ? 'auto' : 'manual',
    notes: String(it.notes || ''),
  };
  // 순서무관/대안 정답 플래그 보존 (evaluator.scoreItem이 소비)
  if (it.ordered === false) out.ordered = false;
  if (Array.isArray(it.alternatives)) {
    const alts = it.alternatives
      .filter(alt => Array.isArray(alt))
      .map(alt => alt
        .filter(s => s && s.serverId && s.toolName)
        .map(s => ({
          serverId: String(s.serverId),
          toolName: String(s.toolName),
          params: (s.params && typeof s.params === 'object' && !Array.isArray(s.params)) ? s.params : {},
        })))
      .filter(alt => alt.length > 0);
    if (alts.length) out.alternatives = alts;
  }
  return out;
}

function normalizeImportedSet(data) {
  if (!data || typeof data !== 'object') return null;
  const src = Array.isArray(data.items) ? data : (data.benchmarkSet || null);
  if (!src || !Array.isArray(src.items)) return null;
  const items = src.items.map(normalizeImportedItem).filter(Boolean);
  return {
    id: uuid(),
    name: String(src.name || '가져온 세트'),
    description: String(src.description || ''),
    createdAt: new Date().toISOString(),
    items,
  };
}

/* ============================================================
   메인 렌더
   ============================================================ */
export async function render(container, ctx) {
  const leftWrap = el('div', { class: 'card bm-list-card' });
  const rightWrap = el('div', { class: 'bm-detail' });
  container.replaceChildren(el('div', { class: 'split' }, leftWrap, rightWrap));

  const getSets = () => store.get('benchmarks') || [];
  const getMcps = () => store.get('mcps') || [];
  const saveSets = (next) => store.set('benchmarks', next);

  function updateSet(id, fn) {
    const sets = getSets();
    const idx = sets.findIndex(s => s.id === id);
    if (idx < 0) return;
    sets[idx] = fn(sets[idx]);
    saveSets(sets);
  }

  let selectedId = ctx?.params?.id || null;
  {
    const sets = getSets();
    if (!selectedId && sets.length) selectedId = sets[0].id;
    else if (selectedId && !sets.find(s => s.id === selectedId)) selectedId = sets[0]?.id || null;
  }

  function renderAll() { renderList(); renderDetail(); }

  /* ---------- 좌측: 세트 목록 ---------- */
  function renderList() {
    const sets = getSets();
    const header = el('div', { class: 'row between', style: { marginBottom: '12px' } },
      el('div', { class: 'panel-title', style: { margin: '0' } }, '벤치마크 세트'));
    const actions = el('div', { class: 'row', style: { gap: '6px', marginBottom: '12px' } },
      el('button', { class: 'btn btn-primary btn-sm', onclick: newSetModal }, '＋ 새 세트'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: importSet }, '가져오기'));

    let listEl;
    if (!sets.length) {
      listEl = emptyState({ icon: '📏', title: '세트가 없습니다', desc: '새 세트를 만들어 벤치마크 항목을 추가하세요.' });
    } else {
      listEl = el('div', { class: 'stack', style: { gap: '6px' } },
        sets.map(s => el('div', {
          class: 'list-item bm-list-item' + (s.id === selectedId ? ' on' : ''),
          onclick: () => { selectedId = s.id; renderAll(); },
        },
          el('div', { class: 'li-name' }, s.name || '(이름 없음)'),
          el('div', { class: 'li-sub' }, `${(s.items || []).length}개 항목 · ${fmt.date(s.createdAt)}`),
          el('div', { class: 'bm-li-actions' },
            el('button', { class: 'icon-btn', title: '복제', onclick: (e) => { e.stopPropagation(); duplicateSet(s.id); } }, '⧉'),
            el('button', { class: 'icon-btn', title: '삭제', onclick: (e) => { e.stopPropagation(); deleteSet(s.id); } }, '🗑')))));
    }
    leftWrap.replaceChildren(header, actions, listEl);
  }

  function newSetModal() {
    const nameI = el('input', { class: 'input', placeholder: '예: 기본 열차 조회 벤치마크' });
    const descI = el('textarea', { class: 'input', placeholder: '세트 설명(선택)' });
    modal({
      title: '새 벤치마크 세트',
      body: el('div', {}, field({ label: '세트 이름', input: nameI, required: true }), field({ label: '설명', input: descI })),
      actions: [
        { label: '취소', class: 'btn-ghost' },
        {
          label: '만들기', class: 'btn-primary', onClick: () => {
            const name = nameI.value.trim();
            if (!name) { toast('세트 이름을 입력하세요.', 'warn'); return false; }
            const set = { id: uuid(), name, description: descI.value.trim(), createdAt: new Date().toISOString(), items: [] };
            saveSets([set, ...getSets()]);
            selectedId = set.id;
            renderAll();
            toast('세트가 생성되었습니다.', 'success');
          },
        },
      ],
    });
  }

  async function importSet() {
    try {
      const data = await pickJSONFile();
      if (!data) return;
      const set = normalizeImportedSet(data);
      if (!set) { toast('올바른 벤치마크 세트 JSON이 아닙니다.', 'error'); return; }
      saveSets([set, ...getSets()]);
      selectedId = set.id;
      renderAll();
      toast(`세트 "${set.name}"를 가져왔습니다 (${set.items.length}개 항목).`, 'success');
    } catch (e) {
      toast(e.message || '가져오기에 실패했습니다.', 'error');
    }
  }

  function duplicateSet(id) {
    const s = getSets().find(x => x.id === id);
    if (!s) return;
    const copy = {
      ...structuredClone(s),
      id: uuid(),
      name: (s.name || '세트') + ' (복제)',
      createdAt: new Date().toISOString(),
      items: (s.items || []).map(it => ({ ...structuredClone(it), id: uuid() })),
    };
    saveSets([copy, ...getSets()]);
    selectedId = copy.id;
    renderAll();
    toast('세트를 복제했습니다.', 'success');
  }

  async function deleteSet(id) {
    const s = getSets().find(x => x.id === id);
    if (!s) return;
    if (!await confirmDialog(`세트 "${s.name}"과(와) 항목 ${(s.items || []).length}개를 삭제할까요?`)) return;
    const next = getSets().filter(x => x.id !== id);
    saveSets(next);
    if (selectedId === id) selectedId = next[0]?.id || null;
    renderAll();
    toast('세트가 삭제되었습니다.', 'success');
  }

  /* ---------- 우측: 세트 상세 ---------- */
  function renderDetail() {
    const set = getSets().find(s => s.id === selectedId);
    if (!set) {
      rightWrap.replaceChildren(el('div', { class: 'card' },
        emptyState({ icon: '📏', title: '세트를 선택하세요', desc: '왼쪽에서 세트를 선택하거나 새로 만들면 항목을 편집할 수 있습니다.' })));
      return;
    }

    const items = set.items || [];
    const dist = difficultyDist(items);

    const title = editableTitle(set.name, (v) => { updateSet(set.id, s => ({ ...s, name: v })); renderAll(); });
    const desc = editableDesc(set.description, (v) => { updateSet(set.id, s => ({ ...s, description: v })); renderDetail(); });

    const distBadges = el('div', { class: 'row wrap', style: { gap: '6px', marginTop: '4px' } },
      badge(`${items.length} 항목`, 'dim'),
      dist.easy ? badge(`쉬움 ${dist.easy}`, 'green') : null,
      dist.medium ? badge(`보통 ${dist.medium}`, 'amber') : null,
      dist.hard ? badge(`어려움 ${dist.hard}`, 'red') : null);

    const headerRow = el('div', { class: 'row between wrap', style: { gap: '12px', alignItems: 'flex-start', marginBottom: '4px' } },
      el('div', { class: 'grow' }, title, desc, distBadges),
      el('div', { class: 'row', style: { gap: '6px' } },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => exportSet(set) }, '내보내기'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => deleteSet(set.id) }, '세트 삭제')));

    const actionBar = el('div', { class: 'row wrap', style: { gap: '8px', margin: '16px 0' } },
      el('button', { class: 'btn btn-primary', onclick: () => autoGenWizard(set) }, '🤖 자동 생성(LLM)'),
      el('button', { class: 'btn', onclick: () => itemEditor(set, null) }, '✍ 수동 추가'));

    // 항목 테이블 + 검색
    const searchI = el('input', { class: 'input', placeholder: '질의 검색…', style: { maxWidth: '260px' } });
    const tableWrap = el('div', {});
    const renderTable = () => tableWrap.replaceChildren(buildItemsTable(set, searchI.value.trim()));
    searchI.addEventListener('input', renderTable);
    renderTable();

    rightWrap.replaceChildren(el('div', { class: 'card' },
      headerRow,
      actionBar,
      el('div', { class: 'row between wrap', style: { gap: '10px', marginBottom: '10px' } },
        el('div', { class: 'panel-title', style: { margin: '0' } }, '벤치마크 항목'),
        searchI),
      tableWrap));
  }

  function buildItemsTable(set, filter) {
    const mcps = getMcps();
    const byId = new Map(mcps.map(m => [m.id, m]));
    let items = set.items || [];
    const hasAny = items.length > 0;
    if (filter) {
      const f = filter.toLowerCase();
      items = items.filter(it => it.query.toLowerCase().includes(f) || (it.category || '').toLowerCase().includes(f));
    }
    if (!items.length) {
      if (!hasAny) return emptyState({ icon: '🧪', title: '항목이 없습니다', desc: '자동 생성 또는 수동 추가로 시작하세요.' });
      return emptyState({ icon: '🔍', title: '검색 결과 없음', desc: `"${filter}"에 해당하는 항목이 없습니다.` });
    }

    const rows = items.map(it => {
      const missing = it.expected.filter(s => !byId.has(s.serverId));
      return el('tr', {},
        el('td', {},
          el('div', { class: 'bm-query', title: '클릭하여 상세 보기', onclick: () => viewItem(set, it) },
            missing.length ? el('span', { class: 'bm-warn', title: `등록되지 않은 서버: ${missing.map(m => m.serverId).join(', ')}` }, '⚠ ') : null,
            truncate(it.query, 70))),
        el('td', {}, workflowChips(it.expected, mcps)),
        el('td', {},
          el('div', { class: 'row wrap', style: { gap: '4px' } },
            badge(DIFF_LABEL[it.difficulty] || it.difficulty, DIFF_KIND[it.difficulty] || 'dim'),
            it.ordered === false ? badge('순서무관', 'dim') : null)),
        el('td', {}, badge(it.source === 'auto' ? '자동' : '수동', it.source === 'auto' ? 'violet' : 'dim')),
        el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
          el('button', { class: 'icon-btn', title: '편집', onclick: () => itemEditor(set, it) }, '✎'),
          el('button', { class: 'icon-btn', title: '삭제', onclick: () => deleteItem(set, it) }, '🗑')));
    });

    return el('div', { class: 'tbl-wrap' },
      el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {},
          el('th', {}, '질의'), el('th', {}, '워크플로우'), el('th', {}, '난이도'), el('th', {}, '출처'), el('th', {}, ''))),
        el('tbody', {}, rows)));
  }

  async function deleteItem(set, it) {
    if (!await confirmDialog('이 항목을 삭제할까요?')) return;
    updateSet(set.id, s => ({ ...s, items: (s.items || []).filter(x => x.id !== it.id) }));
    renderAll();
    toast('항목이 삭제되었습니다.', 'success');
  }

  function exportSet(set) {
    downloadJSON({ _app: 'rail-brain-test-lab', _type: 'benchmarkSet', ...set }, `benchmark-${fileSlug(set.name)}.json`);
    toast('세트를 내보냈습니다.', 'success');
  }

  /* ---------- 항목 상세 보기 ---------- */
  function viewItem(set, it) {
    const mcps = getMcps();
    const byId = new Map(mcps.map(m => [m.id, m]));
    const stepsDetail = el('div', { class: 'stack', style: { gap: '8px', marginTop: '10px' } },
      it.expected.map((s, i) => {
        const server = byId.get(s.serverId);
        const hasParams = s.params && Object.keys(s.params).length;
        return el('div', { class: 'card', style: { padding: '12px' } },
          el('div', { class: 'row', style: { gap: '9px' } },
            el('span', { class: 'step-no' }, String(i + 1)),
            el('div', { class: 'grow' },
              el('div', {}, server ? `${server.icon} ` : el('span', { class: 'bm-warn' }, '⚠ '), el('b', {}, server ? server.nameKo : s.serverId)),
              el('div', { class: 'hint mono' }, s.toolName))),
          hasParams ? el('pre', { class: 'bm-params-pre', style: { marginTop: '8px' } }, JSON.stringify(s.params, null, 2)) : null);
      }));

    modal({
      title: '항목 상세', wide: true,
      body: el('div', {},
        field({ label: '사용자 질의', input: el('div', { class: 'bm-view-query' }, it.query) }),
        el('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '14px' } },
          badge(DIFF_LABEL[it.difficulty] || it.difficulty, DIFF_KIND[it.difficulty] || 'dim'),
          it.category ? badge(it.category, 'dim') : null,
          badge(it.source === 'auto' ? '자동 생성' : '수동', it.source === 'auto' ? 'violet' : 'dim')),
        it.notes ? field({ label: '메모', input: el('div', { class: 'hint' }, it.notes) }) : null,
        el('div', { class: 'fld' },
          el('label', {}, '정답 워크플로우'),
          workflowChips(it.expected, mcps),
          stepsDetail)),
      actions: [
        { label: '닫기', class: 'btn-ghost' },
        { label: '편집', class: 'btn-primary', onClick: () => { itemEditor(set, it); } },
      ],
    });
  }

  /* ---------- 수동 추가/편집 (set에 저장) ---------- */
  function itemEditor(set, item) {
    openItemEditorModal({
      title: item ? '항목 편집' : '수동 항목 추가',
      item,
      onSave: (next) => {
        next.id = item?.id || uuid();
        next.source = item?.source || 'manual';
        updateSet(set.id, st => {
          const list = (st.items || []).slice();
          if (item) {
            const i = list.findIndex(x => x.id === item.id);
            if (i >= 0) list[i] = next; else list.push(next);
          } else {
            list.push(next);
          }
          return { ...st, items: list };
        });
        renderAll();
        toast(item ? '항목이 수정되었습니다.' : '항목이 추가되었습니다.', 'success');
      },
    });
  }

  /* ---------- 자동 생성 마법사 ---------- */
  async function autoGenWizard(set) {
    const mcps = getMcps();
    if (!mcps.length) { toast('먼저 MCP 서버가 등록되어 있어야 합니다.', 'warn'); return; }

    const bodyWrap = el('div', {});
    const m = modal({ title: '🤖 벤치마크 자동 생성', wide: true, body: bodyWrap, actions: [] });

    // 연결 확인
    bodyWrap.replaceChildren(el('div', { class: 'row', style: { gap: '10px', padding: '24px', justifyContent: 'center' } },
      spinner(), 'Ollama 연결 확인 중…'));
    const conn = await checkConnection();
    if (!conn.ok) {
      bodyWrap.replaceChildren(emptyState({
        icon: '🔌', title: 'Ollama에 연결할 수 없습니다',
        desc: `자동 생성은 로컬 LLM이 필요합니다. (${conn.error}) 설정에서 Ollama 연결을 확인하거나, 대신 '수동 추가'를 이용하세요.`,
      }));
      return;
    }

    renderConfig();

    /* 1) 설정 화면 */
    function renderConfig() {
      const countI = el('input', { class: 'input', type: 'number', min: '1', max: '30', value: '5', style: { maxWidth: '130px' } });

      const defModel = getDefaultModel();
      const modelSel = el('select', { class: 'select' }, el('option', { value: '' }, '모델 불러오는 중…'));
      listModels().then(models => {
        if (!models.length) { modelSel.replaceChildren(el('option', { value: defModel }, defModel + ' (기본)')); return; }
        modelSel.replaceChildren(...models.map(mm =>
          el('option', { value: mm.name, selected: mm.name === defModel }, `${mm.name} (${mm.paramSize || '?'} · ${mm.sizeGB}GB)`)));
        if (defModel && !models.find(mm => mm.name === defModel)) {
          modelSel.prepend(el('option', { value: defModel, selected: true }, defModel + ' (기본)'));
        }
      }).catch(() => {
        modelSel.replaceChildren(el('option', { value: defModel }, defModel + ' (기본)'));
      });

      const cats = [...new Set(mcps.map(m => m.category).filter(Boolean))];
      const selectedCats = new Set();
      const chipWrap = el('div', { class: 'bm-chips' }, cats.map(c => {
        const chip = el('button', { class: 'bm-chip', type: 'button' }, c);
        chip.addEventListener('click', () => {
          if (selectedCats.has(c)) { selectedCats.delete(c); chip.classList.remove('on'); }
          else { selectedCats.add(c); chip.classList.add('on'); }
        });
        return chip;
      }));

      const diffSel = el('select', { class: 'select', style: { maxWidth: '180px' } },
        el('option', { value: 'auto' }, '자동 균형'),
        el('option', { value: 'easy' }, '쉬움'),
        el('option', { value: 'medium' }, '보통'),
        el('option', { value: 'hard' }, '어려움'));

      bodyWrap.replaceChildren(
        el('p', { class: 'hint', style: { marginBottom: '14px' } },
          '등록된 MCP 도구 카탈로그를 바탕으로 LLM이 항목을 하나씩 생성합니다. 생성 후 검토 화면에서 선택·편집하여 세트에 담을 수 있습니다.'),
        field({ label: '생성 개수 (1~30)', input: countI }),
        field({ label: 'LLM 모델', input: modelSel, hint: '소형 로컬 모델은 항목당 시간이 걸릴 수 있습니다.' }),
        field({ label: '카테고리 (비우면 전체)', input: chipWrap, hint: '선택한 분류의 MCP 서버를 중심으로 생성합니다.' }),
        field({ label: '난이도', input: diffSel }),
        el('div', { class: 'row end', style: { marginTop: '8px' } },
          el('button', {
            class: 'btn btn-primary', onclick: () => {
              const count = Math.max(1, Math.min(30, parseInt(countI.value, 10) || 5));
              startGen({ count, model: modelSel.value || undefined, categories: [...selectedCats], difficulty: diffSel.value });
            },
          }, '생성 시작 →')));
    }

    /* 2) 진행 화면 + 생성 실행 */
    function startGen(opts) {
      const controller = new AbortController();
      const bar = el('i', { style: { width: '0%' } });
      const counter = el('div', { class: 'bm-gen-count' }, `0 / ${opts.count}`);
      const preview = el('div', { class: 'bm-gen-preview' }, '생성 준비 중…');
      const stopBtn = el('button', {
        class: 'btn btn-danger', onclick: () => { controller.abort(); stopBtn.disabled = true; stopBtn.textContent = '중단하는 중…'; },
      }, '중단');

      bodyWrap.replaceChildren(el('div', { class: 'bm-gen' },
        el('div', { class: 'row', style: { gap: '9px' } }, spinner(), el('div', { class: 'panel-title', style: { margin: '0' } }, '벤치마크 생성 중…')),
        el('div', { class: 'progress', style: { margin: '16px 0 10px' } }, bar),
        counter,
        el('div', { class: 'bm-gen-preview-wrap' },
          el('div', { class: 'hint' }, '방금 생성된 질의'),
          preview),
        el('div', { class: 'row end', style: { marginTop: '16px' } }, stopBtn)));

      generateBenchmarkItems({
        mcps, count: opts.count, model: opts.model, categories: opts.categories, difficulty: opts.difficulty,
        signal: controller.signal,
        onProgress: ({ done, total, lastItem }) => {
          bar.style.width = Math.round((done / total) * 100) + '%';
          counter.textContent = `${done} / ${total}`;
          if (lastItem) preview.textContent = lastItem.query;
        },
      }).then(({ items, failures, cancelled }) => {
        renderReview(items, failures, cancelled);
      }).catch(e => {
        bodyWrap.replaceChildren(
          emptyState({ icon: '⚠️', title: '생성 중 오류가 발생했습니다', desc: e.message || String(e) }),
          el('div', { class: 'row end' }, el('button', { class: 'btn', onclick: renderConfig }, '다시 설정')));
      });
    }

    /* 3) 검토 화면 */
    function renderReview(genItems, failures, cancelled) {
      if (!genItems.length) {
        bodyWrap.replaceChildren(
          emptyState({
            icon: cancelled ? '⏹' : '😕',
            title: cancelled ? '중단됨 — 생성된 항목이 없습니다' : '생성된 항목이 없습니다',
            desc: cancelled ? '생성을 중단하여 저장할 항목이 없습니다. 다시 시도하거나 개수를 조정해 보세요.'
              : `유효한 항목을 만들지 못했습니다(폐기 ${failures}건). 모델을 바꾸거나 다시 시도해 보세요.`,
          }),
          el('div', { class: 'row end', style: { marginTop: '8px' } }, el('button', { class: 'btn', onclick: renderConfig }, '다시 설정')));
        return;
      }

      const mcps2 = getMcps();
      const localItems = genItems.slice();
      const selected = new Set(localItems.map(it => it.id));
      const tableWrap = el('div', {});

      const addBtn = el('button', { class: 'btn btn-primary' }, '선택 항목 추가');
      const updateAddBtn = () => {
        addBtn.textContent = `선택 항목 세트에 추가 (${selected.size})`;
        addBtn.disabled = selected.size === 0;
      };

      const renderRows = () => {
        const rows = localItems.map(it => {
          const cb = el('input', { type: 'checkbox', checked: selected.has(it.id) });
          cb.addEventListener('change', () => { if (cb.checked) selected.add(it.id); else selected.delete(it.id); updateAddBtn(); });
          return el('tr', {},
            el('td', { style: { width: '30px' } }, cb),
            el('td', {}, el('div', { class: 'bm-query', onclick: () => cb.click() }, truncate(it.query, 58))),
            el('td', {}, workflowChips(it.expected, mcps2)),
            el('td', {}, badge(DIFF_LABEL[it.difficulty] || it.difficulty, DIFF_KIND[it.difficulty] || 'dim')),
            el('td', { style: { textAlign: 'right' } },
              el('button', { class: 'icon-btn', title: '편집', onclick: () => editGenItem(it) }, '✎')));
        });
        tableWrap.replaceChildren(el('div', { class: 'tbl-wrap' },
          el('table', { class: 'tbl' },
            el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, '질의'), el('th', {}, '워크플로우'), el('th', {}, '난이도'), el('th', {}, ''))),
            el('tbody', {}, rows))));
      };

      function editGenItem(it) {
        openItemEditorModal({
          title: '생성 항목 편집',
          item: it,
          onSave: (next) => {
            next.id = it.id;
            next.source = 'auto';
            const i = localItems.findIndex(x => x.id === it.id);
            if (i >= 0) localItems[i] = next;
            renderRows();
          },
        });
      }

      addBtn.addEventListener('click', () => {
        const toAdd = localItems.filter(it => selected.has(it.id));
        if (!toAdd.length) return;
        updateSet(set.id, st => ({ ...st, items: [...(st.items || []), ...toAdd] }));
        m.close();
        renderAll();
        toast(`${toAdd.length}개 항목을 세트에 추가했습니다.`, 'success');
      });

      renderRows();
      updateAddBtn();

      bodyWrap.replaceChildren(el('div', {},
        el('div', { class: 'bm-review-warn' },
          '⚠ LLM이 생성한 미검증 정답입니다. 각 항목의 워크플로우가 질의를 실제로 해결하는지 반드시 검토·수정 후 추가하세요. 난이도는 워크플로우 길이 기준(1단계=easy, 2~3=medium, 4+=hard)으로 보정될 수 있습니다.'),
        el('div', { class: 'row between wrap', style: { gap: '10px', marginBottom: '10px' } },
          cancelled
            ? el('div', { class: 'panel-title bm-review-cancelled', style: { margin: '0' } }, `중단됨 — 부분 결과 ${genItems.length}개`)
            : el('div', { class: 'panel-title', style: { margin: '0' } }, `생성 완료 — ${genItems.length}개`),
          failures ? badge(`폐기 ${failures}건`, 'amber') : null),
        el('p', { class: 'hint', style: { marginBottom: '12px' } }, '추가할 항목을 선택하고, 필요하면 편집한 뒤 세트에 담으세요.'),
        tableWrap,
        el('div', { class: 'row between wrap', style: { gap: '10px', marginTop: '16px' } },
          el('button', { class: 'btn btn-ghost', onclick: renderConfig }, '＋ 더 생성'),
          addBtn)));
    }
  }

  /* ---------- 공용: 항목 편집 모달 (수동 추가·편집·생성항목편집 재사용) ---------- */
  function openItemEditorModal({ title, item, onSave }) {
    const mcps = getMcps();

    const queryI = el('textarea', { class: 'input', placeholder: '예: 내일 아침 서울에서 부산 가는 KTX 알려줘', style: { minHeight: '64px' } });
    queryI.value = item?.query || '';

    const diffVal = item?.difficulty || 'medium';
    const diffSel = el('select', { class: 'select' },
      el('option', { value: 'easy', selected: diffVal === 'easy' }, '쉬움'),
      el('option', { value: 'medium', selected: diffVal === 'medium' }, '보통'),
      el('option', { value: 'hard', selected: diffVal === 'hard' }, '어려움'));

    const catI = el('input', { class: 'input', value: item?.category || '', placeholder: '예: 운행정보 (선택)' });
    const notesI = el('textarea', { class: 'input', placeholder: '메모(선택)' });
    notesI.value = item?.notes || '';

    // 순서 무관 채점: 체크 시 item.ordered=false 저장. 기본(미체크)은 순서 있는 채점(ordered=true)
    const orderCb = el('input', { type: 'checkbox', checked: item?.ordered === false });

    const wf = buildWorkflowEditor(
      (item?.expected || []).map(s => ({ serverId: s.serverId, toolName: s.toolName, params: { ...(s.params || {}) } })),
      mcps);

    const body = el('div', {},
      field({ label: '사용자 질의', input: queryI, required: true }),
      el('div', { class: 'grid cols-2' },
        field({ label: '난이도', input: diffSel }),
        field({ label: '카테고리', input: catI })),
      field({ label: '메모', input: notesI }),
      field({
        label: '채점 옵션',
        input: el('label', { class: 'chk-row' }, orderCb, el('span', {}, '순서 무관 채점 (도구 호출 순서를 채점에서 제외)')),
        hint: '체크하면 도구 집합만 일치해도 정답으로 채점합니다.',
      }),
      el('div', { class: 'fld' },
        el('label', {}, '정답 워크플로우', el('span', { class: 'req' }, ' *')),
        el('div', { class: 'hint', style: { marginBottom: '8px' } }, '질의를 해결하는 도구 호출 순서를 정의합니다(최소 1단계).'),
        wf.root));

    modal({
      title, wide: true, body,
      actions: [
        { label: '취소', class: 'btn-ghost' },
        {
          label: '저장', class: 'btn-primary', onClick: () => {
            const query = queryI.value.trim();
            if (query.length < 5) { toast('질의를 5자 이상 입력하세요.', 'warn'); return false; }

            const steps = wf.getSteps().filter(s => s.serverId && s.toolName);
            if (!steps.length) { toast('최소 1개의 유효한 워크플로우 단계가 필요합니다.', 'warn'); return false; }

            const byId = new Map(mcps.map(m => [m.id, m]));
            for (const s of steps) {
              const server = byId.get(s.serverId);
              if (!server || !(server.tools || []).some(t => t.name === s.toolName)) {
                toast('존재하지 않는 서버/도구가 포함되어 있습니다.', 'error'); return false;
              }
            }

            const expected = steps.map(s => ({
              serverId: s.serverId,
              toolName: s.toolName,
              params: cleanParams(s.params, byId.get(s.serverId), s.toolName),
            }));

            onSave({
              query,
              expected,
              category: catI.value.trim(),
              difficulty: diffSel.value,
              notes: notesI.value.trim(),
              ordered: !orderCb.checked,
            });
          },
        },
      ],
    });
  }

  /* ---------- 워크플로우 빌더 ---------- */
  function buildWorkflowEditor(initialSteps, mcps) {
    const steps = initialSteps.length
      ? initialSteps.map(s => ({ ...s, params: s.params || {} }))
      : [{ serverId: '', toolName: '', params: {} }];

    const listEl = el('div', {});

    function stepRow(step, idx) {
      const serverSel = el('select', { class: 'select' },
        el('option', { value: '' }, '서버 선택…'),
        mcps.map(m => el('option', { value: m.id, selected: m.id === step.serverId }, `${m.icon} ${m.nameKo}`)));
      serverSel.addEventListener('change', () => { step.serverId = serverSel.value; step.toolName = ''; step.params = {}; render(); });

      const server = mcps.find(m => m.id === step.serverId);
      const toolSel = el('select', { class: 'select', disabled: !server },
        el('option', { value: '' }, '도구 선택…'),
        (server?.tools || []).map(t => el('option', { value: t.name, selected: t.name === step.toolName }, t.name)));
      toolSel.addEventListener('change', () => { step.toolName = toolSel.value; step.params = {}; render(); });

      const tool = (server?.tools || []).find(t => t.name === step.toolName);
      const toolDesc = tool ? el('div', { class: 'hint', style: { marginTop: '6px' } }, tool.description || '') : null;

      const paramsWrap = el('div', { class: 'bm-params' });
      if (tool) buildParamsForm(paramsWrap, tool, step);

      const ctrls = el('div', { class: 'bm-step-ctrls' },
        el('button', { class: 'icon-btn', title: '위로', disabled: idx === 0, onclick: () => { [steps[idx - 1], steps[idx]] = [steps[idx], steps[idx - 1]]; render(); } }, '↑'),
        el('button', { class: 'icon-btn', title: '아래로', disabled: idx === steps.length - 1, onclick: () => { [steps[idx + 1], steps[idx]] = [steps[idx], steps[idx + 1]]; render(); } }, '↓'),
        el('button', { class: 'icon-btn', title: '단계 삭제', disabled: steps.length <= 1, onclick: () => { steps.splice(idx, 1); render(); } }, '🗑'));

      return el('div', { class: 'step-row' },
        el('div', { class: 'step-no' }, String(idx + 1)),
        el('div', { class: 'grow', style: { minWidth: '0' } },
          el('div', { class: 'row wrap', style: { gap: '8px' } },
            el('div', { class: 'grow', style: { minWidth: '140px' } }, serverSel),
            el('div', { class: 'grow', style: { minWidth: '140px' } }, toolSel)),
          toolDesc,
          paramsWrap),
        ctrls);
    }

    function render() {
      listEl.replaceChildren(...steps.map((s, i) => stepRow(s, i)));
    }
    render();

    const addBtn = el('button', { class: 'btn btn-ghost btn-sm', style: { marginTop: '4px' }, onclick: () => { steps.push({ serverId: '', toolName: '', params: {} }); render(); } }, '＋ 단계 추가');
    return { root: el('div', {}, listEl, addBtn), getSteps: () => steps };
  }

  function buildParamsForm(wrap, tool, step) {
    const props = tool.inputSchema?.properties || {};
    const keys = Object.keys(props);
    const required = new Set(tool.inputSchema?.required || []);
    if (!step._paramMode) step._paramMode = 'form';

    const rebuild = () => buildParamsForm(wrap, tool, step);

    const toggleBtn = keys.length
      ? el('button', {
          class: 'icon-btn', type: 'button', title: '입력 방식 전환',
          onclick: () => { step._paramMode = step._paramMode === 'form' ? 'json' : 'form'; rebuild(); },
        }, step._paramMode === 'form' ? '{ } JSON로' : '폼으로')
      : null;

    const header = el('div', { class: 'row between', style: { margin: '10px 0 4px' } },
      el('div', { class: 'hint' }, keys.length ? '파라미터 (선택 입력)' : '이 도구는 파라미터가 없습니다.'),
      toggleBtn);

    if (!keys.length) { wrap.replaceChildren(header); return; }

    let body;
    if (step._paramMode === 'json') {
      const ed = jsonEditor({
        value: step.params || {}, height: 110,
        onChange: (v) => { if (v && typeof v === 'object' && !Array.isArray(v)) step.params = v; },
      });
      body = ed.root;
    } else {
      body = el('div', {}, keys.map(k => {
        const p = props[k] || {};
        const input = buildFieldInput(p, step.params?.[k], (val) => {
          if (val === undefined) delete step.params[k];
          else step.params[k] = val;
        });
        return field({ label: k, hint: p.description, input, required: required.has(k) });
      }));
    }
    wrap.replaceChildren(header, body);
  }

  function buildFieldInput(p, cur, onChange) {
    if (Array.isArray(p.enum) && p.enum.length) {
      const sel = el('select', { class: 'select' },
        el('option', { value: '' }, '(미지정)'),
        p.enum.map(v => el('option', { value: String(v), selected: String(v) === String(cur) }, String(v))));
      sel.addEventListener('change', () => onChange(sel.value === '' ? undefined : sel.value));
      return sel;
    }
    if (p.type === 'boolean') {
      const sel = el('select', { class: 'select' },
        el('option', { value: '' }, '(미지정)'),
        el('option', { value: 'true', selected: cur === true }, 'true'),
        el('option', { value: 'false', selected: cur === false }, 'false'));
      sel.addEventListener('change', () => onChange(sel.value === '' ? undefined : sel.value === 'true'));
      return sel;
    }
    if (p.type === 'number' || p.type === 'integer') {
      const inp = el('input', { class: 'input', type: 'number', value: cur ?? '', placeholder: p.examples?.[0] ?? '' });
      inp.addEventListener('input', () => onChange(inp.value === '' ? undefined : Number(inp.value)));
      return inp;
    }
    const inp = el('input', { class: 'input', value: cur ?? '', placeholder: p.examples?.[0] ?? (p.description || '') });
    inp.addEventListener('input', () => onChange(inp.value.trim() === '' ? undefined : inp.value));
    return inp;
  }

  function cleanParams(params, server, toolName) {
    const tool = (server?.tools || []).find(t => t.name === toolName);
    const props = tool?.inputSchema?.properties || {};
    const out = {};
    for (const [k, v] of Object.entries(params || {})) {
      if (Object.prototype.hasOwnProperty.call(props, k) && v !== undefined && v !== '') out[k] = v;
    }
    return out;
  }

  /* ---------- 인라인 편집 헤더 ---------- */
  function editableTitle(value, onSave) {
    const view = el('h2', { class: 'bm-editable-title', title: '클릭하여 이름 수정' }, value || '(제목 없음)');
    view.addEventListener('click', () => {
      const inp = el('input', { class: 'input bm-title-input', value: value || '' });
      view.replaceWith(inp); inp.focus(); inp.select();
      let committed = false;
      const done = (save) => {
        if (committed) return; committed = true;
        if (save) onSave(inp.value.trim() || value || ''); else renderDetail();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); done(true); }
        else if (e.key === 'Escape') { done(false); }
      });
      inp.addEventListener('blur', () => done(true));
    });
    return view;
  }

  function editableDesc(value, onSave) {
    const view = el('div', { class: 'bm-editable-desc' + (value ? '' : ' empty'), title: '클릭하여 설명 수정' }, value || '설명 추가…');
    view.addEventListener('click', () => {
      const ta = el('textarea', { class: 'input', value: value || '', style: { minHeight: '54px' } });
      view.replaceWith(ta); ta.focus();
      let committed = false;
      const done = (save) => {
        if (committed) return; committed = true;
        if (save) onSave(ta.value.trim()); else renderDetail();
      };
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { done(false); }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { done(true); }
      });
      ta.addEventListener('blur', () => done(true));
    });
    return view;
  }

  renderAll();
}
