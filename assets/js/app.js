// 앱 엔트리 — 인증 게이트 → 셸(사이드바/톱바) → 라우터
import { store } from './core/store.js';
import { router } from './core/router.js';
import { auth } from './core/auth.js';
import { el, toast } from './core/ui.js';
import { checkConnection } from './services/ollama.js';
import { SAMPLE_MCPS } from './data/sampleMcps.js';
import { SAMPLE_STRATEGIES, SAMPLE_BENCHMARKS } from './data/samples.js';

import { renderSetup, renderLogin } from './views/login.js';
import { render as renderDashboard } from './views/dashboard.js';
import { render as renderMcps } from './views/mcps.js';
import { render as renderMcpBuilder } from './views/mcpBuilder.js';
import { render as renderOrchestration } from './views/orchestration.js';
import { render as renderBenchmarks } from './views/benchmarks.js';
import { render as renderEvaluation } from './views/evaluation.js';
import { render as renderSettings } from './views/settings.js';
import { render as renderGuide } from './views/guide.js';

const app = document.getElementById('app');

const DEFAULT_SETTINGS = {
  ollamaUrl: 'http://localhost:11434',
  defaultModel: 'exaone3.5:7.8b',
  temperature: 0.2,
  maxSteps: 6,
  numCtx: 16384,
};

/* ---------- 초기 데이터 시드 (기대 타입이 아니면 방어적으로 재시드) ---------- */
function seed() {
  const settings = store.get('settings');
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    store.set('settings', { ...DEFAULT_SETTINGS });
  }
  const ensureArray = (key, sample) => {
    const cur = store.get(key);
    if (!Array.isArray(cur)) store.set(key, sample);
  };
  ensureArray('mcps', SAMPLE_MCPS);
  ensureArray('strategies', SAMPLE_STRATEGIES);
  ensureArray('benchmarks', SAMPLE_BENCHMARKS);
  ensureArray('runs', []);
}

/* ---------- 내비게이션 정의 ---------- */
const NAV = [
  { section: 'WORKSPACE' },
  { path: '/dashboard', icon: '🎛️', label: '대시보드' },
  { path: '/mcps', icon: '🧩', label: 'MCP 카탈로그' },
  { path: '/orchestration', icon: '🧠', label: '오케스트레이션' },
  { path: '/benchmarks', icon: '📏', label: '벤치마크' },
  { path: '/evaluation', icon: '🏁', label: '평가·비교' },
  { section: 'SYSTEM' },
  { path: '/settings', icon: '⚙️', label: '설정' },
  { path: '/guide', icon: '📖', label: '가이드' },
];

const TITLES = {
  '/dashboard': '대시보드',
  '/mcps': 'MCP 카탈로그',
  '/mcps/new': 'MCP 빌더',
  '/orchestration': '오케스트레이션 스튜디오',
  '/benchmarks': '벤치마크 랩',
  '/evaluation': '평가 · 비교',
  '/settings': '설정',
  '/guide': '가이드',
};

/* ---------- 셸 ---------- */
let connTimer = null;
let routeChangedHandler = null; // renderShell 재호출 시 이전 리스너를 정리하기 위한 모듈 레벨 참조

function detachRouteChanged() {
  if (routeChangedHandler) {
    window.removeEventListener('route-changed', routeChangedHandler);
    routeChangedHandler = null;
  }
}

// 로그인/초기설정 화면으로 전환하기 전 셸 관련 리스너·타이머를 정리
function teardownShell() {
  router.stop();
  detachRouteChanged();
  if (connTimer) { clearInterval(connTimer); connTimer = null; }
}

function renderShell() {
  const session = auth.session();

  // 사이드바
  const navItems = NAV.map(n => n.section
    ? el('div', { class: 'nav-section' }, n.section)
    : el('a', {
        class: 'nav-item', href: '#' + n.path, dataset: { path: n.path },
      }, el('span', { class: 'nav-ico' }, n.icon), n.label));

  const connDot = el('span', { class: 'conn-dot' });
  const connText = el('span', {}, 'OLLAMA 확인 중…');
  const connPill = el('div', { class: 'conn-pill', title: 'Ollama 연결 상태' }, connDot, connText);

  const sidebar = el('aside', { class: 'sidebar' },
    el('div', { class: 'brand' },
      el('div', { class: 'brand-signal' }),
      el('div', { class: 'brand-name' }, 'RAIL-BRAIN', el('small', {}, 'MCP TEST LAB'))),
    el('nav', { class: 'nav' }, navItems),
    el('div', { class: 'sidebar-foot' },
      connPill,
      el('div', { class: 'user-pill' },
        el('span', {}, '👤 ', el('b', {}, session.username), session.role === 'admin' ? ' (관리자)' : ''),
        el('button', {
          class: 'btn btn-sm btn-ghost', title: '로그아웃',
          onclick: () => { auth.logout(); boot(); },
        }, '로그아웃'))));

  // 톱바
  const title = el('div', { class: 'topbar-title' }, '대시보드');
  const menuBtn = el('button', { class: 'menu-btn', 'aria-label': '메뉴', onclick: () => toggleSidebar(true) }, '☰');
  const topbar = el('header', { class: 'topbar' },
    el('div', { class: 'row' }, menuBtn, title),
    el('div', { class: 'topbar-right' },
      el('span', { class: 'badge dim mono', style: { fontFamily: 'var(--font-mono)' } }, 'v1.0')));

  const content = el('div', { class: 'content' });
  const main = el('main', { class: 'main' }, topbar, content);
  const shell = el('div', { class: 'shell' }, sidebar, main);
  app.replaceChildren(shell);

  // 모바일 사이드바 토글
  let scrim = null;
  function toggleSidebar(open) {
    sidebar.classList.toggle('open', open);
    if (open) {
      scrim = el('div', { class: 'sidebar-scrim', onclick: () => toggleSidebar(false) });
      shell.appendChild(scrim);
    } else { scrim?.remove(); scrim = null; }
  }

  // 라우트 변경 시 활성 표시 + 타이틀 (이전 셸의 리스너는 제거 후 재등록해 누적 방지)
  detachRouteChanged();
  routeChangedHandler = (e) => {
    const path = e.detail.path;
    sidebar.querySelectorAll('.nav-item').forEach(a => {
      const p = a.dataset.path;
      a.classList.toggle('active', p && (path === p || (p !== '/dashboard' && path.startsWith(p + '/')) || (p === '/mcps' && path.startsWith('/mcps'))));
    });
    title.textContent = TITLES[path] || TITLES['/' + path.split('/')[1]] || 'Rail-Brain Test Lab';
    toggleSidebar(false);
    main.scrollTop = 0; window.scrollTo(0, 0);
  };
  window.addEventListener('route-changed', routeChangedHandler);

  // Ollama 연결 상태 폴링
  async function pollConn() {
    const r = await checkConnection();
    connDot.className = 'conn-dot ' + (r.ok ? 'ok' : 'bad');
    connText.textContent = r.ok ? `OLLAMA 연결됨` : 'OLLAMA 미연결';
    connPill.title = r.ok ? `Ollama v${r.version} 연결됨` : `연결 실패: ${r.error} — 가이드 참조`;
  }
  pollConn();
  if (connTimer) clearInterval(connTimer);
  connTimer = setInterval(pollConn, 30000);

  // 세션이 없으면(만료/타 탭 로그아웃) 라우트 dispatch를 막고 로그인 화면으로 복귀
  router.start(content, {
    before: () => {
      if (!auth.session()) { boot(); return false; }
      return true;
    },
  });
}

/* ---------- 라우트 등록 ---------- */
router.register('/dashboard', renderDashboard);
router.register('/mcps', renderMcps);
router.register('/mcps/new', renderMcpBuilder);
router.register('/mcps/edit/:id', renderMcpBuilder);
router.register('/orchestration', renderOrchestration);
router.register('/orchestration/:id', renderOrchestration);
router.register('/benchmarks', renderBenchmarks);
router.register('/benchmarks/:id', renderBenchmarks);
router.register('/evaluation', renderEvaluation);
router.register('/evaluation/:runId', renderEvaluation);
router.register('/settings', renderSettings);
router.register('/guide', renderGuide);

/* ---------- 부트 ---------- */
function boot() {
  seed();
  if (!auth.hasAccounts()) {
    teardownShell();
    renderSetup(app, () => boot());
  } else if (!auth.session()) {
    teardownShell();
    renderLogin(app, () => boot());
  } else {
    renderShell();
    if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
  }
}

/* ---------- 저장 실패 알림 (같은 key는 5초 스로틀) ---------- */
const persistFailNotifiedAt = new Map();
window.addEventListener('rbtl:persist-failed', (e) => {
  const key = e?.detail?.key || '';
  const now = Date.now();
  const last = persistFailNotifiedAt.get(key) || 0;
  if (now - last < 5000) return;
  persistFailNotifiedAt.set(key, now);
  toast('저장 공간이 부족하여 일부 데이터가 저장되지 않았습니다. 불필요한 실행 이력을 정리하거나 데이터를 내보낸 뒤 초기화하세요.', 'error', 6000);
});

window.addEventListener('error', (e) => {
  console.error('전역 오류:', e.error || e.message);
});

boot();
