// 앱 엔트리 — 인증 게이트 → 셸(사이드바/톱바) → 라우터
// 로컬 모드: 이 브라우저의 localStorage 계정 + Ollama 직접 호출.
// 서버 모드(settings.gatewayUrl 설정 시): 중앙 게이트웨이가 계정·쿼터·공유 데이터·LLM 중계.
import { store } from './core/store.js';
import { router } from './core/router.js';
import { auth } from './core/auth.js';
import { el, toast, confirmDialog } from './core/ui.js';
import { checkConnection } from './services/ollama.js';
import * as gateway from './services/gateway.js';
import { SAMPLE_MCPS } from './data/sampleMcps.js';
import { SAMPLE_STRATEGIES, SAMPLE_BENCHMARKS } from './data/samples.js';

import { renderSetup, renderLogin } from './views/login.js';
import { render as renderDashboard } from './views/dashboard.js';
import { render as renderMcps } from './views/mcps.js';
import { render as renderMcpBuilder } from './views/mcpBuilder.js';
import { render as renderOrchestration } from './views/orchestration.js';
import { render as renderPlayground } from './views/playground.js';
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

// 서버 모드에서의 현재 사용자(me()/login()/setup() 결과). 로컬 모드에서는 auth.session() 사용.
let serverIdentity = null;
let bootingServer = false;

function currentIdentity() {
  return gateway.isServerMode() ? serverIdentity : auth.session();
}

/* ---------- 초기 데이터 시드 (기대 타입이 아니면 방어적으로 재시드) ---------- */
// 샘플 데이터 버전 — 이 값을 올리면 로컬(seed)과 게이트웨이(syncSamplesToGateway) 양쪽에서
// 신규 기본 샘플이 기존 사용자/서버 저장소에 병합된다.
const SAMPLE_VERSION = 3;

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

  // 샘플 버전 동기화: 앱이 업데이트되어 새 기본 샘플(MCP·전략·벤치마크)이 추가되면,
  // 기존 사용자의 localStorage에도 신규 샘플(id가 아직 없는 것)만 병합한다.
  // 사용자가 만든 항목·수정 내용은 그대로 보존하며, 버전당 한 번만 실행되어
  // 사용자가 삭제한 샘플을 매 로드마다 되살리지 않는다.
  // (v2: MCP 30→100종, 벤치마크 1→11세트, DB 전략 샘플 추가)
  // v3: 저장 성공을 검증하고 실패 시 버전을 올리지 않는다. store.set은 용량 초과 등
  //     실패 시 false를 반환하고 롤백하는데, 이전엔 이를 무시하고 버전을 기록해
  //     병합이 누락된 채 영구히 건너뛰던 고착 문제가 있었다. 버전을 올려 재병합을 유도.
  const seededVer = Number(store.get('sampleSeedVersion') || 0);
  if (seededVer < SAMPLE_VERSION) {
    const mergeSamples = (key, samples) => {
      const cur = store.get(key);
      if (!Array.isArray(cur) || !Array.isArray(samples)) return { ok: true, added: 0 };
      const ids = new Set(cur.map((x) => x && x.id));
      const additions = samples.filter((s) => s && s.id && !ids.has(s.id));
      if (!additions.length) return { ok: true, added: 0 };
      const ok = store.set(key, [...cur, ...additions]); // 저장 실패 시 false(롤백)
      return { ok, added: ok ? additions.length : 0 };
    };
    let r = {
      mcps: mergeSamples('mcps', SAMPLE_MCPS),
      strategies: mergeSamples('strategies', SAMPLE_STRATEGIES),
      benchmarks: mergeSamples('benchmarks', SAMPLE_BENCHMARKS),
    };
    // 저장 실패(용량 초과 가능) 시: 오래된 실행 이력(runs)을 최근 5개만 남기고 정리해
    // 공간을 확보한 뒤 1회 재시도한다(실행 이력은 재생성 가능한 데이터).
    if (!r.mcps.ok || !r.strategies.ok || !r.benchmarks.ok) {
      const runs = store.get('runs');
      if (Array.isArray(runs) && runs.length > 5) store.set('runs', runs.slice(-5));
      if (!r.mcps.ok) r.mcps = mergeSamples('mcps', SAMPLE_MCPS);
      if (!r.strategies.ok) r.strategies = mergeSamples('strategies', SAMPLE_STRATEGIES);
      if (!r.benchmarks.ok) r.benchmarks = mergeSamples('benchmarks', SAMPLE_BENCHMARKS);
    }
    if (r.mcps.ok && r.strategies.ok && r.benchmarks.ok) {
      store.set('sampleSeedVersion', SAMPLE_VERSION); // 전부 성공했을 때만 버전 확정
    } else {
      // 여전히 실패 → 버전을 올리지 않아 다음 로드에 재시도. 사용자에게 공간 부족 안내.
      console.error('[seed] 샘플 병합 저장 실패 — 저장 공간 부족 가능. 설정 > 데이터 초기화 후 재시도하세요.');
      try { window.dispatchEvent(new CustomEvent('rbtl:persist-failed', { detail: { key: 'sample-seed' } })); } catch { /* 무시 */ }
    }
  }
}

/* ---------- 내비게이션 정의 ---------- */
const NAV = [
  { section: 'WORKSPACE' },
  { path: '/dashboard', icon: '🎛️', label: '대시보드' },
  { path: '/mcps', icon: '🧩', label: 'MCP 카탈로그' },
  { path: '/orchestration', icon: '🧠', label: '오케스트레이션' },
  { path: '/playground', icon: '⚡', label: '실시간 테스트' },
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
  '/playground': '실시간 테스트',
  '/benchmarks': '벤치마크 랩',
  '/evaluation': '평가 · 비교',
  '/settings': '설정',
  '/guide': '가이드',
};

/* ---------- 셸 ---------- */
let connTimer = null;
let routeChangedHandler = null; // renderShell 재호출 시 이전 리스너를 정리하기 위한 모듈 레벨 참조
let quotaUnsub = null;          // 쿼터 pill 이벤트 구독 해제 함수

function detachRouteChanged() {
  if (routeChangedHandler) {
    window.removeEventListener('route-changed', routeChangedHandler);
    routeChangedHandler = null;
  }
}

function detachQuota() {
  if (quotaUnsub) { quotaUnsub(); quotaUnsub = null; }
}

// 로그인/초기설정 화면으로 전환하기 전 셸 관련 리스너·타이머를 정리
function teardownShell() {
  router.stop();
  detachRouteChanged();
  detachQuota();
  if (connTimer) { clearInterval(connTimer); connTimer = null; }
}

function renderShell() {
  const session = currentIdentity() || { username: '사용자', role: 'user' };
  const serverMode = gateway.isServerMode();

  // 사이드바
  const navItems = NAV.map(n => n.section
    ? el('div', { class: 'nav-section' }, n.section)
    : el('a', {
        class: 'nav-item', href: '#' + n.path, dataset: { path: n.path },
      }, el('span', { class: 'nav-ico' }, n.icon), n.label));

  const connDot = el('span', { class: 'conn-dot' });
  const connText = el('span', {}, 'OLLAMA 확인 중…');
  const connPill = el('div', { class: 'conn-pill', title: 'Ollama 연결 상태' }, connDot, connText);

  // 서버 모드: 쿼터 pill + 서버 모드 뱃지
  detachQuota();
  let quotaPill = null, serverBadge = null;
  if (serverMode) {
    quotaPill = el('div', { class: 'quota-pill', title: '남은 LLM 호출 / 일일 한도 (서버 쿼터)' });
    const renderQuota = (q) => {
      if (!q) {
        quotaPill.replaceChildren(el('span', { class: 'q-ico' }, '🎫'), el('span', {}, 'LLM'), el('span', { class: 'q-num' }, '—'));
        quotaPill.classList.remove('empty');
        return;
      }
      quotaPill.replaceChildren(
        el('span', { class: 'q-ico' }, '🎫'),
        el('span', {}, 'LLM'),
        el('span', { class: 'q-num' }, `${q.remaining}/${q.dailyLimit}`));
      quotaPill.classList.toggle('empty', Number(q.remaining) <= 0);
    };
    renderQuota(gateway.quotaState());
    const handler = (e) => renderQuota(e.detail || gateway.quotaState());
    window.addEventListener('rbtl:gw-quota', handler);
    quotaUnsub = () => window.removeEventListener('rbtl:gw-quota', handler);
    serverBadge = el('div', { class: 'gw-mode-badge', title: '중앙 게이트웨이 서버 모드' }, el('span', { class: 'gw-mode-dot' }), '서버 모드');
  }

  const sidebar = el('aside', { class: 'sidebar' },
    el('div', { class: 'brand' },
      el('div', { class: 'brand-signal' }),
      el('div', { class: 'brand-name' }, 'RAIL-BRAIN', el('small', {}, 'MCP TEST LAB'))),
    el('nav', { class: 'nav' }, navItems),
    el('div', { class: 'sidebar-foot' },
      connPill,
      serverMode ? quotaPill : null,
      serverMode ? serverBadge : null,
      el('div', { class: 'user-pill' },
        el('span', {}, '👤 ', el('b', {}, session.username), session.role === 'admin' ? ' (관리자)' : ''),
        el('button', {
          class: 'btn btn-sm btn-ghost', title: '로그아웃',
          onclick: async () => {
            if (gateway.isServerMode()) { try { await gateway.logout(); } catch { /* 무시 */ } serverIdentity = null; }
            else auth.logout();
            boot();
          },
        }, '로그아웃'))));

  // 톱바
  const title = el('div', { class: 'topbar-title' }, '대시보드');
  const menuBtn = el('button', { class: 'menu-btn', 'aria-label': '메뉴', onclick: () => toggleSidebar(true) }, '☰');
  const topbar = el('header', { class: 'topbar' },
    el('div', { class: 'row' }, menuBtn, title),
    el('div', { class: 'topbar-right' },
      serverMode ? el('span', { class: 'badge green', title: '중앙 게이트웨이 서버 모드' }, '서버 모드') : null,
      el('span', { class: 'badge dim mono', title: '빌드 2026-07-05 · MCP 100종·DB전략·실시간테스트·분야별 벤치마크 (샘플 병합 v3, 게이트웨이 자동 병합)', style: { fontFamily: 'var(--font-mono)' } }, 'v2.2')));

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

  // Ollama 연결 상태 폴링 (서버 모드에서는 게이트웨이 경유로 LLM 가용성 표시)
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
      if (gateway.isServerMode()) {
        if (!gateway.getToken() || !serverIdentity) { boot(); return false; }
        return true;
      }
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
router.register('/playground', renderPlayground);
router.register('/benchmarks', renderBenchmarks);
router.register('/benchmarks/:id', renderBenchmarks);
router.register('/evaluation', renderEvaluation);
router.register('/evaluation/:runId', renderEvaluation);
router.register('/settings', renderSettings);
router.register('/guide', renderGuide);

/* ---------- URL 파라미터로 서버 주소 자동 설정 ----------
   ?ollama=<url> : 로컬 모드에서 다른 PC의 Ollama 터널 주소 자동 설정 (기존)
   ?gateway=<url>: 서버 모드 게이트웨이 주소 자동 설정 (신규, 동일 검증·정리 방식)
   서버/게이트웨이 운영자가 주소가 포함된 링크 하나를 공유하면 각 클라이언트 설정이 자동 구성된다. */
let urlOllamaApplied = null;
function applyOllamaParam() {
  const p = new URLSearchParams(location.search);
  const o = p.get('ollama');
  if (!o) return;
  try {
    const u = new URL(o);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
    const url = (u.origin + u.pathname).replace(/\/+$/, '');
    store.update('settings', s => ({ ...(s && typeof s === 'object' ? s : {}), ollamaUrl: url }));
    urlOllamaApplied = url;
    history.replaceState(null, '', location.pathname + location.hash);
  } catch {
    toast('링크의 ollama 주소가 올바르지 않아 무시했습니다.', 'warn');
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

let gatewayParamApplied = null;
async function applyGatewayParam() {
  const p = new URLSearchParams(location.search);
  const g = p.get('gateway');
  if (!g) return;
  const clearParam = () => history.replaceState(null, '', location.pathname + location.hash);

  let url;
  try {
    const u = new URL(g);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
    url = (u.origin + u.pathname).replace(/\/+$/, '');
  } catch {
    toast('링크의 gateway 주소가 올바르지 않아 무시했습니다.', 'warn');
    clearParam();
    return;
  }

  // 이미 어떤 게이트웨이에 로그인된 상태(토큰 존재)에서 '다른' 주소로 바꾸려는 링크는
  // 사용자 확인을 받는다(피싱 방어 — 기존 서버 토큰이 낯선 호스트로 향하지 않도록).
  const currentUrl = gateway.getGatewayUrl();
  const hasSession = !!gateway.getToken();
  const changing = currentUrl !== url;
  if (hasSession && changing) {
    let host = url;
    try { host = new URL(url).host; } catch { /* 표시용 폴백 */ }
    const ok = await confirmDialog(
      `외부에서 받은 링크가 LLM 게이트웨이 서버를 '${host}'(으)로 변경하려 합니다. 신뢰하는 서버만 허용하세요. 변경할까요?`,
      { title: '게이트웨이 변경 확인', danger: true, okLabel: '변경' },
    );
    clearParam(); // 확인/취소와 무관하게 파라미터는 제거(재프롬프트/부트 루프 방지)
    if (!ok) { toast('게이트웨이 변경을 취소했습니다. 기존 설정을 유지합니다.', 'warn'); return; }
    store.update('settings', s => ({ ...(s && typeof s === 'object' ? s : {}), gatewayUrl: url }));
    gatewayParamApplied = url;
    return;
  }

  // 신규(토큰 없음) 또는 동일 주소 → 조용히 적용
  store.update('settings', s => ({ ...(s && typeof s === 'object' ? s : {}), gatewayUrl: url }));
  gatewayParamApplied = url;
  clearParam();
}

/* ---------- 게이트웨이 접근 불가 오류 화면 ---------- */
function renderGatewayError(err) {
  teardownShell();
  const msg = err?.message || '게이트웨이에 연결할 수 없습니다.';
  const card = el('div', { class: 'auth-wrap' },
    el('div', { class: 'auth-card gw-error-card' },
      el('div', { class: 'auth-head' },
        el('div', { class: 'gw-error-ico' }, '🚫'),
        el('div', { class: 'auth-title' }, '게이트웨이 연결 불가'),
        el('div', { class: 'auth-sub' }, `중앙 서버(${gateway.getGatewayUrl() || '-'})에 연결할 수 없습니다.`)),
      el('p', { class: 'gw-error-detail' }, msg),
      el('div', { class: 'row', style: { gap: '10px', marginTop: '4px' } },
        el('button', { class: 'btn btn-primary', style: { flex: '1' }, onclick: () => boot() }, '🔄 다시 시도'),
        el('button', {
          class: 'btn btn-ghost', style: { flex: '1' },
          onclick: () => {
            store.update('settings', s => {
              const n = { ...(s && typeof s === 'object' && !Array.isArray(s) ? s : {}) };
              delete n.gatewayUrl;
              return n;
            });
            location.reload();
          },
        }, '로컬 모드로 전환')),
      el('div', { class: 'auth-note' }, '로컬 모드로 전환하면 이 브라우저의 로컬 계정·데이터·Ollama 직접 연결로 동작합니다.')));
  app.replaceChildren(card);
}

/* ---------- 서버 모드 부트 ---------- */
async function bootServer() {
  bootingServer = true;
  try {
    teardownShell();
    let h;
    try {
      h = await gateway.health();
    } catch (e) {
      renderGatewayError(e);
      return;
    }
    if (!h || !h.ok) { renderGatewayError(new Error('게이트웨이가 정상 상태가 아닙니다.')); return; }

    // (b) 계정 미초기화 → 서버 초기설정 (setupTokenRequired면 토큰 필드 표시)
    if (!h.accountsInitialized) {
      renderSetup(app, () => boot(), {
        mode: 'server',
        setupTokenRequired: !!h.setupTokenRequired,
        onSubmit: async (u, p, token) => {
          const r = await gateway.setup(u, p, token);
          serverIdentity = { username: r.username, role: r.role };
        },
      });
      return;
    }

    // (c) 토큰이 있으면 유효성 확인
    if (gateway.getToken()) {
      try {
        const m = await gateway.me();
        serverIdentity = { username: m.username, role: m.role };
        await enterServerShell();
        return;
      } catch { /* 토큰 무효 — 아래 로그인 화면으로 (gwFetch가 401 시 토큰 폐기) */ }
    }

    // (c) 토큰 없음/무효 → 서버 로그인
    renderLogin(app, () => boot(), {
      mode: 'server',
      onSubmit: async (u, p) => {
        const r = await gateway.login(u, p);
        serverIdentity = { username: r.username, role: r.role };
      },
    });
  } finally {
    bootingServer = false;
  }
}

// 게이트웨이(서버) 모드 샘플 자동 병합:
// 앱이 업데이트되어 새 기본 샘플(MCP·전략·벤치마크)이 추가되면, 게이트웨이 공유 저장소에도
// 신규 샘플(id 미존재)을 병합해 서버로 push 한다. 게이트웨이별(gwSeed:<url>) SAMPLE_VERSION
// 기준으로 1회만 수행 → 매 접속마다 삭제된 샘플을 되살리거나 불필요하게 push 하지 않는다.
// 병합은 "추가"만 하므로 서버에 있던 사용자 데이터를 지우지 않는다(비파괴적). pullShared 직후
// (startSharedSync 구독 활성 상태)에 호출되어야 store.set → 서버 push 가 동작한다.
async function syncSamplesToGateway() {
  if (!gateway.isServerMode()) return;
  const url = gateway.getGatewayUrl() || '';
  const gateKey = 'gwSeed:' + url;
  if (Number(store.get(gateKey) || 0) >= SAMPLE_VERSION) return; // 이 게이트웨이엔 이미 반영됨
  const specs = [['mcps', SAMPLE_MCPS], ['strategies', SAMPLE_STRATEGIES], ['benchmarks', SAMPLE_BENCHMARKS]];
  let added = 0;
  for (const [key, samples] of specs) {
    const cur = store.get(key);
    const base = Array.isArray(cur) ? cur : [];
    const ids = new Set(base.map((x) => x && x.id));
    const additions = samples.filter((s) => s && s.id && !ids.has(s.id));
    added += additions.length;
    // 항상 store.set → 구독자(startSharedSync)가 서버로 push. 서버가 해당 키(예: mcps)를
    // 아직 갖고 있지 않아도 확실히 반영된다. 추가만 하므로 비파괴적.
    store.set(key, additions.length ? [...base, ...additions] : base);
  }
  store.set(gateKey, SAMPLE_VERSION);
  if (added > 0) toast(`새 기본 샘플 ${added}개를 서버에 반영했습니다. 다른 기기는 새로고침하면 보입니다.`, 'success', 6000);
}

// (d) 로그인 성공 → 공유 데이터 pull 후 셸 렌더
async function enterServerShell() {
  try { await gateway.pullShared(); }
  catch { /* 초기 동기화 실패는 치명적이지 않음 — 로컬 시드로 진행 */ }
  try { await syncSamplesToGateway(); }
  catch { /* 샘플 자동 병합 실패는 치명적이지 않음 */ }
  renderShell();
  if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
}

/* ---------- 부트 ---------- */
async function boot() {
  seed();

  // URL 파라미터(로컬/서버) 1회 적용
  if (urlOllamaApplied === null && location.search.includes('ollama=')) {
    applyOllamaParam();
    if (urlOllamaApplied) toast(`링크의 LLM 서버 주소로 설정되었습니다: ${urlOllamaApplied}`, 'success', 6000);
  }
  if (gatewayParamApplied === null && location.search.includes('gateway=')) {
    await applyGatewayParam(); // 이미 로그인 상태에서 다른 게이트웨이면 confirmDialog로 확인
    if (gatewayParamApplied) toast(`링크의 게이트웨이 서버로 설정되었습니다: ${gatewayParamApplied}`, 'success', 6000);
  }

  gateway.startSharedSync(); // 공유 키 변경 → 서버 push 구독 (서버 모드에서만 실제 전송, 1회 설정)

  // 서버 모드 분기
  if (gateway.isServerMode()) { bootServer(); return; }

  // 로컬 모드 (기존 동작)
  if (!auth.hasAccounts()) {
    teardownShell();
    renderSetup(app, () => boot(), { mode: 'local' });
  } else if (!auth.session()) {
    teardownShell();
    renderLogin(app, () => boot(), { mode: 'local' });
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

/* ---------- 서버 인증 만료(401) → 로그인 화면 복귀 ---------- */
window.addEventListener('rbtl:gw-unauthorized', () => {
  if (!gateway.isServerMode()) return;
  if (bootingServer) return; // 부트 중 토큰 검증 실패는 조용히 로그인 화면으로 처리
  serverIdentity = null;
  toast('세션이 만료되었거나 인증이 필요합니다. 다시 로그인해 주세요.', 'warn');
  teardownShell();
  boot();
});

window.addEventListener('error', (e) => {
  console.error('전역 오류:', e.error || e.message);
});

boot();
