// UI 컴포넌트/DOM 헬퍼 — 모든 뷰에서 재사용 (XSS 안전: textContent 기반)

/** DOM 요소 생성 헬퍼. attrs: class/dataset/style/on* 이벤트/일반 속성 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required') node[k] = !!v;
    else node.setAttribute(k, v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function uuid() {
  return (crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxx-xxxx-4xxx-yxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

/* ---------- 토스트 ---------- */
export function toast(message, type = 'info', ms = 3600) {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: `toast ${type}`, role: 'status' },
    el('span', {}, type === 'success' ? '✅' : type === 'warn' ? '⚠️' : type === 'error' ? '⛔' : 'ℹ️'),
    el('div', { class: 'grow' }, message));
  root.appendChild(t);
  setTimeout(() => {
    t.classList.add('leaving');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, ms);
  return t;
}

/* ---------- 모달 ---------- */
// 열린 모달 스택 — 모달 위에 모달(예: 마법사 위 확인 다이얼로그)이 겹칠 때
// Escape/배경클릭이 최상단 모달 하나만 닫도록 한다(이중 닫힘 방지).
// 단일 모달일 때는 항상 자신이 최상단이므로 기존 동작과 완전히 동일하다.
const modalStack = [];

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const backdrop = el('div', { class: 'modal-backdrop' });
  let closed = false;
  const stackToken = {}; // 이 모달 인스턴스의 스택 식별자(고유 객체)
  const isTop = () => modalStack[modalStack.length - 1] === stackToken;
  const escHandler = (e) => { if (e.key === 'Escape' && isTop()) close(); };
  const close = () => {
    if (closed) return;           // 멱등: 중복 호출 무시
    closed = true;
    const idx = modalStack.indexOf(stackToken);           // 닫힐 때 스택에서 제거(중간 위치여도 안전)
    if (idx !== -1) modalStack.splice(idx, 1);
    document.removeEventListener('keydown', escHandler);  // 항상 리스너 제거(누수 방지)
    backdrop.remove();
    onClose?.();
  };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && isTop()) close(); });

  const foot = actions.length ? el('div', { class: 'modal-foot' },
    actions.map(a => el('button', {
      class: `btn ${a.class || ''}`,
      onclick: async (e) => {
        const r = await a.onClick?.(e);
        if (r !== false) close();
      },
    }, a.label))) : null;

  const box = el('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'modal-head' },
      el('h3', {}, title),
      el('button', { class: 'modal-x', onclick: close, 'aria-label': '닫기' }, '✕')),
    el('div', { class: 'modal-body' }, body),
    foot);
  backdrop.appendChild(box);
  root.appendChild(backdrop);

  modalStack.push(stackToken); // 등록 — 이 시점부터 최상단 모달
  document.addEventListener('keydown', escHandler);
  return { close, box };
}

export function confirmDialog(message, { title = '확인', danger = true, okLabel = '확인' } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      body: el('p', { style: { fontSize: '13.5px', lineHeight: '1.7' } }, message),
      actions: [
        { label: '취소', class: 'btn-ghost', onClick: () => resolve(false) },
        { label: okLabel, class: danger ? 'btn-danger' : 'btn-primary', onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

/* ---------- 뱃지/칩/기타 ---------- */
// 카테고리 → 뱃지 색 키 매핑. 유효 키는 main.css의 .badge.* 클래스(green/amber/red/blue/violet/dim)뿐.
// '복합'(여러 카테고리에 걸친 복합 시나리오)은 유일 사용 색이던 red(안전·관제 전용)를 피하고,
// 스펙 예시대로 violet 톤을 사용한다(팔레트가 5색뿐이라 일부 카테고리 간 재사용은 불가피).
export const CATEGORY_COLORS = {
  '운행정보': 'green', '예매·발권': 'blue', '안전·관제': 'red', '시설·유지보수': 'amber',
  '물류·화물': 'violet', '도시교통': 'blue', '여객서비스': 'green', '기상·환경': 'amber',
  '데이터분석': 'violet', '요금·정산': 'blue', '복합': 'violet',
};
export function badge(text, kind) {
  const k = kind || CATEGORY_COLORS[text] || 'dim';
  return el('span', { class: `badge ${k}` }, text);
}

export function spinner(large = false) {
  return el('div', { class: `spin ${large ? 'lg' : ''}`, role: 'progressbar', 'aria-label': '로딩 중' });
}

export function emptyState({ icon = '📭', title, desc, action }) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-ico' }, icon),
    el('div', { class: 'empty-title' }, title),
    desc ? el('div', { class: 'empty-desc' }, desc) : null,
    action ? el('button', { class: 'btn btn-primary', onclick: action.onClick }, action.label) : null);
}

export function field({ label, hint, input, required = false }) {
  return el('div', { class: 'fld' },
    label ? el('label', {}, label, required ? el('span', { class: 'req' }, '*') : null) : null,
    input,
    hint ? el('div', { class: 'hint' }, hint) : null);
}

export function segmented(options, value, onChange, { green = false } = {}) {
  const wrap = el('div', { class: 'seg', role: 'tablist' });
  const render = (cur) => {
    wrap.replaceChildren(...options.map(o =>
      el('button', {
        class: (o.value === cur ? `on ${green ? 'seg-green' : ''}` : ''),
        role: 'tab', type: 'button',
        onclick: () => { if (o.value !== cur) { render(o.value); onChange(o.value); } },
      }, o.label)));
  };
  render(value);
  return wrap;
}

/* ---------- JSON 에디터 ---------- */
export function jsonEditor({ value = {}, onChange, height = 180, placeholder = '{ }' } = {}) {
  const state = el('span', { class: 'json-state ok' }, 'JSON ✓');
  const ta = el('textarea', {
    spellcheck: 'false', placeholder,
    style: { height: height + 'px' },
  });
  ta.value = JSON.stringify(value, null, 2);
  const root = el('div', { class: 'json-ed' }, ta, state);
  let valid = true;

  const check = () => {
    try {
      const v = ta.value.trim() === '' ? null : JSON.parse(ta.value);
      valid = true;
      root.classList.remove('invalid');
      state.className = 'json-state ok'; state.textContent = 'JSON ✓';
      onChange?.(v);
      return v;
    } catch {
      valid = false;
      root.classList.add('invalid');
      state.className = 'json-state bad'; state.textContent = '구문 오류';
      return undefined;
    }
  };
  ta.addEventListener('input', check);

  return {
    root,
    isValid: () => valid,
    get: () => { try { return ta.value.trim() === '' ? null : JSON.parse(ta.value); } catch { return undefined; } },
    set: (v) => { ta.value = JSON.stringify(v, null, 2); check(); },
    format: () => { const v = check(); if (v !== undefined) ta.value = JSON.stringify(v, null, 2); },
  };
}

/* ---------- JSON Schema → 읽기 좋은 테이블 ---------- */
export function schemaTable(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties || !Object.keys(schema.properties).length) {
    return el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '(정의된 필드 없음)');
  }
  const req = new Set(schema.required || []);
  const rows = Object.entries(schema.properties).map(([name, p]) => {
    let typeStr = p.type || 'any';
    if (p.type === 'array') typeStr = `array<${p.items?.type || 'any'}>`;
    if (p.enum) typeStr = p.enum.map(String).join(' | ');
    if (p.format) typeStr += ` (${p.format})`;
    return el('tr', {},
      el('td', { class: 'sk-name' }, name, req.has(name) ? el('span', { class: 'sk-req' }, ' *') : null),
      el('td', { class: 'sk-type' }, typeStr),
      el('td', {}, p.description || ''));
  });
  return el('table', { class: 'schema-tbl' },
    el('thead', {}, el('tr', {}, el('th', {}, '필드'), el('th', {}, '타입'), el('th', {}, '설명'))),
    el('tbody', {}, rows));
}

/* ---------- 워크플로우 칩 (노선도 스타일) ---------- */
export function workflowChips(steps, mcps = [], { marks } = {}) {
  if (!steps?.length) return el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '(단계 없음)');
  const byId = new Map(mcps.map(m => [m.id, m]));
  const wrap = el('div', { class: 'wf-line' });
  steps.forEach((s, i) => {
    if (i > 0) wrap.appendChild(el('span', { class: 'wf-link' }));
    const server = byId.get(s.serverId);
    const mark = marks?.[i] || '';
    wrap.appendChild(el('span', { class: `wf-stop ${mark}`, title: `${s.serverId} / ${s.toolName}` },
      el('span', { class: 'wf-dot' }),
      el('span', {}, server ? `${server.icon} ${server.nameKo}` : s.serverId),
      el('small', {}, s.toolName)));
  });
  return wrap;
}

/* ---------- 포맷터 ---------- */
export const fmt = {
  date: (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-',
  ms: (v) => v == null ? '-' : v >= 1000 ? (v / 1000).toFixed(1) + 's' : Math.round(v) + 'ms',
  pct: (v) => v == null ? '-' : (v * 100).toFixed(1) + '%',
  num: (v, d = 2) => v == null ? '-' : Number(v).toFixed(d),
};

/* ---------- 파일 다운로드/업로드 ---------- */
export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

export function pickJSONFile() {
  return new Promise((resolve, reject) => {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(reader.result)); }
        catch { reject(new Error('JSON 파싱에 실패했습니다.')); }
      };
      reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      reader.readAsText(f);
    });
    input.click();
  });
}
