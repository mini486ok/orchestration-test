// MCP 카탈로그 — 검색·카테고리 필터·카드 그리드·상세 드로어·도구 직접 실행·가져오기/내보내기
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import { auth } from '../core/auth.js';
import {
  el, badge, toast, confirmDialog, emptyState, spinner, schemaTable,
  downloadJSON, pickJSONFile, fmt,
} from '../core/ui.js';
import { validateParams, executeTool } from '../services/mockEngine.js';
import { CATEGORIES, normalizeImportedServer } from '../services/mcpUtils.js';
import { SAMPLE_MCPS } from '../data/sampleMcps.js';

/** 오류 문자열에서 필드명 추출 (validateParams 메시지 매핑용) */
function fieldOf(errStr) {
  let m = String(errStr).match(/^필수 파라미터 누락:\s*(.+)$/);
  if (m) return m[1].trim();
  m = String(errStr).match(/^([^:]+):/);
  return m ? m[1].trim() : null;
}

export async function render(container) {
  let search = '';
  const activeCats = new Set();
  let sortBy = 'name';
  let closeDrawerFn = null;

  /* ---------- 필터/정렬 ---------- */
  function matchesSearch(m) {
    if (!search) return true;
    const hay = [
      m.name, m.nameKo, m.id, m.description,
      ...(m.tags || []),
      ...(m.tools || []).map(t => t.name),
      ...(m.tools || []).map(t => t.description),
    ].join(' ').toLowerCase();
    return hay.includes(search);
  }
  function getFiltered() {
    const list = (store.get('mcps') || []).filter(m =>
      matchesSearch(m) && (activeCats.size === 0 || activeCats.has(m.category)));
    if (sortBy === 'name') list.sort((a, b) => (a.nameKo || a.name || '').localeCompare(b.nameKo || b.name || '', 'ko'));
    else list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return list;
  }

  /* ---------- 카드 ---------- */
  function card(m) {
    return el('div', { class: 'card hoverable mcp-card', onclick: () => openDrawer(m.id) },
      el('div', { class: 'mcp-top' },
        el('div', { class: 'mcp-ico' }, m.icon || '🧩'),
        el('div', { class: 'grow' },
          el('h4', {}, m.nameKo || m.name || m.id),
          el('div', { class: 'mcp-id' }, m.id))),
      el('div', { class: 'row wrap', style: { gap: '6px' } },
        badge(m.category),
        m.isSample ? badge('샘플', 'dim') : badge('사용자', 'blue')),
      el('div', { class: 'mcp-desc' }, m.description || ''),
      m.tags?.length
        ? el('div', { class: 'mcp-tags' }, [
            ...m.tags.slice(0, 2).map(t => el('span', { class: 'tag-mini' }, '#' + t)),
            m.tags.length > 2 ? el('span', { class: 'tag-mini tag-more' }, `+${m.tags.length - 2}`) : null,
          ])
        : null,
      el('div', { class: 'mcp-foot' },
        el('span', { style: { fontSize: '11.5px', color: 'var(--tx2)' } }, `🔧 도구 ${(m.tools || []).length}개`),
        el('span', { style: { fontSize: '11px', color: 'var(--tx3)' } }, fmt.date(m.createdAt))));
  }

  /* ---------- 그리드 ---------- */
  const gridWrap = el('div', {});
  const countEl = el('span', { class: 'hint', style: { fontFamily: 'var(--font-mono)' } }, '');

  function renderGrid() {
    const all = store.get('mcps') || [];
    const list = getFiltered();
    countEl.textContent = `${list.length} / ${all.length}개`;
    if (!all.length) {
      gridWrap.replaceChildren(emptyState({
        icon: '🧩', title: '등록된 MCP 서버가 없습니다',
        desc: '첫 MCP 서버를 만들거나, 설정 > 데이터 관리에서 샘플 MCP를 복원하세요.',
        action: { label: '＋ MCP 만들기', onClick: () => router.navigate('/mcps/new') },
      }));
      return;
    }
    if (!list.length) {
      gridWrap.replaceChildren(emptyState({
        icon: '🔍', title: '검색 결과가 없습니다',
        desc: '다른 검색어 또는 카테고리를 시도해 보세요.',
      }));
      return;
    }
    gridWrap.replaceChildren(el('div', { class: 'mcp-grid' }, list.map(card)));
  }

  /* ---------- 카테고리 칩 ---------- */
  const chipsWrap = el('div', { class: 'row wrap', style: { gap: '7px' } });
  function renderChips() {
    const chip = (label, on, onClick) => el('span', { class: 'chip toggle' + (on ? ' on' : ''), onclick: onClick }, label);
    chipsWrap.replaceChildren(
      chip('전체', activeCats.size === 0, () => { activeCats.clear(); renderChips(); renderGrid(); }),
      ...CATEGORIES.map(c => chip(c, activeCats.has(c), () => {
        activeCats.has(c) ? activeCats.delete(c) : activeCats.add(c);
        renderChips(); renderGrid();
      })));
  }

  /* ---------- 상세 드로어 ---------- */
  function closeDrawer() { closeDrawerFn?.(); }

  function openDrawer(id) {
    const m = (store.get('mcps') || []).find(x => x.id === id);
    if (!m) { toast('서버를 찾을 수 없습니다.', 'error'); return; }
    closeDrawer();

    const backdrop = el('div', { class: 'drawer-backdrop', onclick: closeDrawer });
    const panel = el('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true' },
      el('button', { class: 'drawer-close', onclick: closeDrawer, 'aria-label': '닫기' }, '✕'),
      el('div', { class: 'drawer-head' },
        el('div', { class: 'mcp-ico' }, m.icon || '🧩'),
        el('div', { class: 'grow' },
          el('h3', {}, m.nameKo || m.name),
          el('div', { style: { fontSize: '12px', color: 'var(--tx2)', marginTop: '2px' } }, m.name || ''),
          el('div', { class: 'mcp-id', style: { marginTop: '4px' } }, m.id))),
      el('div', { class: 'row wrap', style: { gap: '6px', marginTop: '10px' } },
        badge(m.category),
        m.isSample ? badge('샘플', 'dim') : badge('사용자', 'blue'),
        badge('v' + (m.version || '1.0.0'), 'dim'),
        m.author ? badge('작성자 ' + m.author, 'dim') : null),
      el('p', { style: { fontSize: '13px', color: 'var(--tx1)', lineHeight: '1.7', marginTop: '12px' } }, m.description || ''),
      m.tags?.length
        ? el('div', { class: 'mcp-tags', style: { marginTop: '10px' } }, m.tags.map(t => el('span', { class: 'tag-mini' }, '#' + t)))
        : null,
      el('div', { class: 'row wrap', style: { gap: '8px', marginTop: '16px' } },
        el('button', { class: 'btn btn-sm', onclick: () => { closeDrawer(); router.navigate('/mcps/edit/' + m.id); } }, '✏ 수정'),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => downloadJSON(m, `mcp-${m.id}.json`) }, '⬇ JSON 내보내기'),
        el('button', { class: 'btn btn-sm btn-danger', onclick: () => deleteServer(m) }, '🗑 삭제')),
      el('div', { class: 'drawer-sec' },
        el('div', { class: 'panel-title' }, `도구 정의 · ${(m.tools || []).length}개`),
        (m.tools || []).length
          ? el('div', {}, m.tools.map((t, i) => toolAccordion(m, t, i === 0)))
          : el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '정의된 도구가 없습니다.')));

    document.body.append(backdrop, panel);
    const esc = (e) => { if (e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', esc);
    closeDrawerFn = () => {
      backdrop.remove(); panel.remove();
      document.removeEventListener('keydown', esc);
      closeDrawerFn = null;
    };
  }

  async function deleteServer(m) {
    const { stepRefs, itemRefs } = countReferences(m.id);
    const extra = m.isSample ? ' 샘플은 설정 > 데이터 관리에서 복원할 수 있습니다.' : '';
    let msg = `'${m.nameKo || m.id}' 서버를 삭제할까요?${extra}`;
    if (stepRefs || itemRefs) {
      msg += ` 이 서버를 참조하는 전략 단계 ${stepRefs}개·벤치마크 항목 ${itemRefs}개가 있습니다. 삭제 시 해당 실행/채점은 오류 처리됩니다.`;
    }
    if (!await confirmDialog(msg)) return;
    store.update('mcps', (list = []) => list.filter(x => x.id !== m.id));
    toast('삭제되었습니다.', 'success');
    closeDrawer();
  }

  /** serverId 를 참조하는 전략 단계 수(skill/rule steps)와 벤치마크 항목 수를 센다 */
  function countReferences(serverId) {
    let stepRefs = 0;
    for (const st of store.get('strategies') || []) {
      const cfg = st.config || {};
      const steps = [
        ...(cfg.skills || []).flatMap(sk => sk.steps || []),
        ...(cfg.rules || []).flatMap(r => r.steps || []),
      ];
      for (const step of steps) if (step && step.serverId === serverId) stepRefs++;
    }
    let itemRefs = 0;
    for (const set of store.get('benchmarks') || []) {
      for (const it of set.items || []) {
        if ((it.expected || []).some(e => e && e.serverId === serverId)) itemRefs++;
      }
    }
    return { stepRefs, itemRefs };
  }

  /* ---------- 도구 아코디언 + 실행 패널 ---------- */
  function toolAccordion(server, tool, open) {
    const bodyEl = el('div', { class: 'acc-body' });
    const acc = el('div', { class: 'acc' + (open ? ' open' : '') },
      el('div', { class: 'acc-head', onclick: () => acc.classList.toggle('open') },
        el('span', { class: 'acc-name' }, tool.name),
        el('span', { class: 'acc-desc' }, tool.description || ''),
        el('span', { class: 'acc-arrow' }, '▶')),
      bodyEl);
    bodyEl.append(
      el('div', { class: 'acc-sub' }, '입력 스키마'),
      schemaTable(tool.inputSchema),
      el('div', { class: 'acc-sub' }, '출력 스키마'),
      schemaTable(tool.outputSchema),
      el('div', { class: 'acc-sub' }, '도구 직접 실행'),
      buildRunPanel(server, tool));
    return acc;
  }

  function buildRunPanel(server, tool) {
    const props = tool.inputSchema?.properties || {};
    const required = new Set(tool.inputSchema?.required || []);
    const controls = new Map();
    const errBoxes = new Map();
    const fldNodes = new Map();

    const paramGrid = el('div', { class: 'param-grid' });
    for (const [key, p] of Object.entries(props)) {
      let control, inputNode;
      if (p.type === 'boolean') {
        control = el('input', { type: 'checkbox', checked: !!p.default });
        inputNode = el('label', { class: 'chk-row' }, control, el('span', {}, '사용'));
      } else if (p.enum?.length) {
        control = el('select', { class: 'select' });
        if (!required.has(key)) control.append(el('option', { value: '' }, '(선택 안 함)'));
        for (const opt of p.enum) control.append(el('option', { value: String(opt), selected: p.default === opt }, String(opt)));
        inputNode = control;
      } else if (p.type === 'number' || p.type === 'integer') {
        control = el('input', { class: 'input', type: 'number' });
        if (p.minimum !== undefined) control.min = p.minimum;
        if (p.maximum !== undefined) control.max = p.maximum;
        if (p.default !== undefined) control.value = p.default;
        inputNode = control;
      } else {
        control = el('input', { class: 'input', type: 'text', placeholder: (p.examples?.[0] ?? p.description ?? '') });
        if (p.default !== undefined) control.value = p.default;
        inputNode = control;
      }
      controls.set(key, control);

      const errBox = el('div', { class: 'err-msg', style: { display: 'none' } });
      errBoxes.set(key, errBox);
      const fld = el('div', { class: 'fld' },
        el('label', {}, key, p.format ? el('span', { style: { color: 'var(--tx3)', fontWeight: '400' } }, ` (${p.format})`) : null,
          required.has(key) ? el('span', { class: 'req' }, '*') : null),
        inputNode,
        p.description ? el('div', { class: 'hint' }, p.description) : null,
        errBox);
      fldNodes.set(key, fld);
      paramGrid.append(fld);
    }

    function collect() {
      const params = {};
      for (const [key, ctl] of controls) {
        const p = props[key];
        if (p.type === 'boolean') { params[key] = ctl.checked; continue; }
        const raw = (ctl.value ?? '').toString();
        if (raw === '') { if (p.default !== undefined) params[key] = p.default; continue; }
        if (p.type === 'number' || p.type === 'integer') {
          const n = Number(raw); params[key] = Number.isNaN(n) ? raw : n;
        } else if (p.type === 'array' || p.type === 'object') {
          try { params[key] = JSON.parse(raw); } catch { params[key] = raw; }
        } else params[key] = raw;
      }
      return params;
    }
    function clearErrors() {
      for (const [k, box] of errBoxes) { box.style.display = 'none'; box.textContent = ''; fldNodes.get(k).classList.remove('err'); }
    }
    function showErrors(errors) {
      clearErrors();
      for (const err of errors) {
        const key = fieldOf(err);
        const box = errBoxes.get(key);
        if (box) { box.textContent = err; box.style.display = 'block'; fldNodes.get(key).classList.add('err'); }
        else toast(err, 'error');
      }
    }

    const outWrap = el('div', { class: 'run-out' });
    const runBtn = el('button', { class: 'btn btn-primary btn-sm' }, '▶ 실행');
    runBtn.addEventListener('click', async () => {
      const params = collect();
      const { ok, errors } = validateParams(tool, params);
      if (!ok) { showErrors(errors); return; }
      clearErrors();
      runBtn.disabled = true;
      outWrap.replaceChildren(el('div', { class: 'gen-status' }, spinner(), el('span', {}, '도구 실행 중…')));
      try {
        const { output, latencyMs } = await executeTool(server, tool.name, params);
        outWrap.replaceChildren(
          el('div', { class: 'row between', style: { marginBottom: '6px' } },
            el('span', { style: { fontSize: '11.5px', color: 'var(--tx2)' } }, '실행 결과'),
            badge('지연 ' + fmt.ms(latencyMs), 'blue')),
          el('pre', {}, JSON.stringify(output, null, 2)));
      } catch (e) {
        outWrap.replaceChildren(el('div', { class: 'err-msg', style: { display: 'block' } }, '실행 실패: ' + (e.message || e)));
      } finally { runBtn.disabled = false; }
    });

    return el('div', { class: 'run-panel' },
      Object.keys(props).length ? paramGrid : el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '입력 파라미터가 없습니다.'),
      el('div', { class: 'row', style: { marginTop: '11px' } }, runBtn),
      outWrap);
  }

  /* ---------- 가져오기 ---------- */
  async function doImport() {
    try {
      const data = await pickJSONFile();
      if (!data) return;
      const arr = Array.isArray(data) ? data : [data];
      const existing = store.get('mcps') || [];
      const ids = new Set(existing.map(m => m.id));
      const user = auth.session()?.username || 'user';
      const toAdd = [];
      const failReasons = [];
      for (const raw of arr) {
        // 정규화+검증(프로토타입 오염 차단 포함) — 통과분만 등록
        const res = normalizeImportedServer(raw, ids);
        if (!res.ok) { failReasons.push(res.reason); continue; }
        const s = res.server;
        s.author = user;
        s.isSample = false;
        ids.add(s.id);
        toAdd.push(s);
      }
      if (toAdd.length) {
        store.set('mcps', [...existing, ...toAdd]);
        toast(`${toAdd.length}개 서버를 가져왔습니다.`, 'success');
      }
      if (failReasons.length) {
        const counts = failReasons.reduce((acc, r) => (acc[r] = (acc[r] || 0) + 1, acc), {});
        const summary = Object.entries(counts).map(([r, n]) => `${r} ${n}건`).join(', ');
        toast(`${failReasons.length}개 항목을 건너뜀 — ${summary}`, 'warn');
      }
      if (!toAdd.length && !failReasons.length) {
        toast('가져올 유효한 MCP 서버가 없습니다. (tools 배열 필요)', 'warn');
      }
    } catch (e) {
      toast('가져오기 실패: ' + (e.message || e), 'error');
    }
  }

  /* ---------- 샘플 복원 ---------- */
  async function restoreSamples() {
    if (!await confirmDialog('샘플 MCP 30개를 다시 시드합니다. 사용자가 만든 MCP는 유지됩니다. 계속할까요?', { danger: false })) return;
    store.update('mcps', (mcps = []) => {
      const userMade = mcps.filter(m => !m.isSample);
      return [...SAMPLE_MCPS, ...userMade];
    });
    toast('샘플 MCP가 복원되었습니다.', 'success');
  }

  /* ---------- 툴바 ---------- */
  const searchInput = el('input', {
    class: 'input', type: 'search', placeholder: '이름·설명·태그·도구명 검색…',
    oninput: (e) => { search = e.target.value.trim().toLowerCase(); renderGrid(); },
  });
  const sortSelect = el('select', {
    class: 'select', style: { width: 'auto' },
    onchange: (e) => { sortBy = e.target.value; renderGrid(); },
  }, el('option', { value: 'name' }, '이름순'), el('option', { value: 'recent' }, '최신순'));

  container.replaceChildren(
    el('div', { class: 'card', style: { marginBottom: '14px' } },
      el('div', { class: 'row wrap mcp-toolbar', style: { marginBottom: '12px' } },
        el('div', { class: 'grow' }, searchInput),
        sortSelect,
        el('button', { class: 'btn', onclick: restoreSamples }, '♻ 샘플 복원'),
        el('button', { class: 'btn', onclick: doImport }, '⬆ 가져오기'),
        el('button', { class: 'btn btn-primary', onclick: () => router.navigate('/mcps/new') }, '＋ MCP 만들기')),
      chipsWrap),
    el('div', { class: 'row between', style: { margin: '4px 2px 12px' } },
      el('div', { class: 'hint' }, '삭제한 샘플 MCP는 설정 > 데이터 관리 > "샘플 MCP 복원"에서 되살릴 수 있습니다.'),
      countEl),
    gridWrap);

  renderChips();
  renderGrid();

  const unsub = store.subscribe('mcps', () => renderGrid());
  return () => { unsub(); closeDrawer(); };
}
