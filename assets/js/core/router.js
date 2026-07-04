// 해시 기반 SPA 라우터 — '/mcps/edit/:id' 형태의 파라미터 지원
const routes = []; // { pattern: string[], render, meta }
let container = null;
let cleanup = null;
let beforeHook = null;

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/dashboard';
  return h.split('?')[0].split('/').filter(Boolean);
}

function match(segments) {
  for (const r of routes) {
    if (r.pattern.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.pattern.length; i++) {
      const p = r.pattern[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segments[i]);
      else if (p !== segments[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

async function dispatch() {
  if (!container) return;
  const segments = parseHash();
  const m = match(segments) || match(['dashboard']);
  if (!m) return;
  if (beforeHook && beforeHook(m) === false) return;

  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
  cleanup = null;

  container.replaceChildren();
  container.classList.remove('content');
  void container.offsetWidth; // 리플로우로 페이지 전환 애니메이션 재시작
  container.classList.add('content');

  try {
    const result = await m.route.render(container, { params: m.params, path: '/' + segments.join('/') });
    if (typeof result === 'function') cleanup = result;
  } catch (e) {
    console.error('[router] 뷰 렌더 오류:', e);
    container.replaceChildren();
    const err = document.createElement('div');
    err.className = 'empty';
    err.innerHTML = '<div class="empty-ico">🚧</div><div class="empty-title">화면을 불러오지 못했습니다</div>';
    const desc = document.createElement('div');
    desc.className = 'empty-desc';
    desc.textContent = String(e?.message || e);
    err.appendChild(desc);
    container.appendChild(err);
  }
  window.dispatchEvent(new CustomEvent('route-changed', { detail: { path: '/' + segments.join('/') } }));
}

export const router = {
  register(path, render, meta = {}) {
    routes.push({ pattern: path.split('/').filter(Boolean), render, meta });
  },
  start(el, { before } = {}) {
    container = el;
    beforeHook = before || null;
    // 멱등화: 중복 등록 방지를 위해 기존 리스너 제거 후 재등록
    window.removeEventListener('hashchange', dispatch);
    window.addEventListener('hashchange', dispatch);
    dispatch();
  },
  stop() {
    window.removeEventListener('hashchange', dispatch);
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
    cleanup = null;
    beforeHook = null;
    container = null;
  },
  navigate(path) {
    const target = '#' + (path.startsWith('/') ? path : '/' + path);
    if (location.hash === target) dispatch();
    else location.hash = target;
  },
  refresh() { dispatch(); },
  current() { return '/' + parseHash().join('/'); },
};
