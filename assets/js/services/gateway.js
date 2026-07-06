// 중앙 게이트웨이(서버 모드) 클라이언트 — 계정·세션·쿼터·공유 데이터·LLM 중계
// 로컬 모드(settings.gatewayUrl 비어 있음)에서는 이 모듈의 대부분이 no-op이며,
// ollama.js/app.js/settings.js 가 isServerMode() 로 분기한다.
import { store } from '../core/store.js';
import { toast } from '../core/ui.js';

// 세션성 토큰 — store 경유가 아닌 localStorage 직접 사용.
// 보안: 토큰을 게이트웨이 origin별 키('rbtl:gwtoken:<origin>')에 저장한다.
// 이렇게 하면 게이트웨이 A에 로그인한 상태에서 ?gateway=<공격자URL> 링크로 주소가 바뀌어도
// A의 Bearer 토큰이 공격자 호스트로 전송되지 않는다(현재 origin에 매핑된 토큰만 반환/부착).
const TOKEN_PREFIX = 'rbtl:gwtoken:';
const LEGACY_TOKEN_KEY = 'rbtl:gwtoken'; // 구버전 단일 키(origin 미바인딩) — 정리 대상
const SHARED_KEYS = ['mcps', 'strategies', 'benchmarks'];

// 구버전 단일 토큰 키는 origin에 바인딩되지 않아 잠재적으로 위험하므로 제거한다.
// (해당 사용자는 1회 재로그인 필요 — 새 키는 origin별로 관리됨)
try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* 비브라우저/프라이빗 모드 방어 */ }

// 401 이벤트 디바운스 — 동시 요청이 각각 401이면 'rbtl:gw-unauthorized'가 중복 발행되므로
// 첫 401만 방출하고, 새 토큰이 설정될 때(로그인/초기설정 성공)까지 억제한다.
let handlingUnauthorized = false;

/* ---------- 게이트웨이 주소/모드 ---------- */
export function getGatewayUrl() {
  const s = store.get('settings') || {};
  const u = s.gatewayUrl;
  if (!u || typeof u !== 'string') return null;
  return u.replace(/\/+$/, '');
}

export function isServerMode() {
  return !!getGatewayUrl();
}

/* ---------- 토큰 (localStorage 직접, 세션성 · 게이트웨이 origin 바인딩) ---------- */
// 현재 게이트웨이의 origin. 주소가 없거나 파싱 실패면 null.
function gatewayOrigin() {
  const base = getGatewayUrl();
  if (!base) return null;
  try { return new URL(base).origin; } catch { return null; }
}

// 현재 게이트웨이 origin에 대응하는 토큰 저장 키(없으면 null → 토큰 미사용).
// origin이 바뀌면 키가 달라지므로 이전 게이트웨이 토큰이 자동으로 조회/전송되지 않는다.
function tokenKey() {
  const origin = gatewayOrigin();
  return origin ? TOKEN_PREFIX + origin : null;
}

export function getToken() {
  const key = tokenKey();
  if (!key) return null;
  try { return localStorage.getItem(key) || null; } catch { return null; }
}

export function setToken(t) {
  const key = tokenKey();
  if (!key) return;
  try {
    if (t) {
      localStorage.setItem(key, t);
      handlingUnauthorized = false; // 새 토큰 확보 → 401 디바운스 해제
    } else {
      localStorage.removeItem(key);
    }
  } catch { /* 비브라우저/프라이빗 모드 방어 */ }
}

/* ---------- 로컬/사설망 대응 fetch (ollama.js fetchLNA 와 동일 전략) ---------- */
async function lnaFetch(url, init = {}) {
  const attempts = [init];
  try {
    if (location.protocol === 'https:' && !/^(localhost|127\.)/.test(location.hostname)) {
      const h = new URL(url, location.href).hostname;
      let spaces = [];
      if (/^(localhost|127\.|\[::1\])/.test(h)) spaces = ['loopback', 'local'];
      else if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) spaces = ['local', 'private'];
      for (const s of spaces) attempts.push({ ...init, targetAddressSpace: s });
    }
  } catch { /* URL 파싱 실패 시 기본 시도만 */ }

  let lastErr;
  for (const opt of attempts) {
    try { return await fetch(url, opt); }
    catch (e) {
      if (e?.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * 게이트웨이 fetch — Authorization 자동 부착.
 * 인증이 걸린 요청(토큰 존재)이 401 이면 토큰 폐기 + 'rbtl:gw-unauthorized' 방출.
 * (토큰 없이 보낸 login/setup 의 401 은 자격 증명 실패이므로 이벤트를 쏘지 않는다)
 */
export async function gwFetch(path, init = {}) {
  const base = getGatewayUrl();
  if (!base) throw new Error('게이트웨이 주소가 설정되지 않았습니다.');
  const token = getToken();
  const headers = { ...(init.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await lnaFetch(base + path, { ...init, headers });
  if (res.status === 401 && token) {
    setToken(null);
    // 동시 요청이 모두 401이어도 이벤트는 한 번만(첫 401) 방출 — 새 토큰 설정 시 setToken이 리셋
    if (!handlingUnauthorized) {
      handlingUnauthorized = true;
      try { window.dispatchEvent(new CustomEvent('rbtl:gw-unauthorized')); } catch { /* 방어 */ }
    }
  }
  return res;
}

// 공통 오류 메시지 추출
async function errMessage(res, fallback) {
  try {
    const data = await res.json();
    if (data && data.error) return data.error;
  } catch { /* 본문 없음/JSON 아님 */ }
  return `${fallback} (HTTP ${res.status})`;
}

/* ---------- 인증 ---------- */
export async function health() {
  const res = await gwFetch('/health', {});
  if (!res.ok) throw new Error('게이트웨이 상태 확인 실패 (HTTP ' + res.status + ')');
  return res.json(); // { ok, app, version, accountsInitialized, ollama }
}

export async function setup(username, password, setupToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (setupToken) headers['X-Setup-Token'] = setupToken;
  const res = await gwFetch('/auth/setup', {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await errMessage(res, '초기 설정 실패'));
  const data = await res.json();
  setToken(data.token);
  updateQuota(data.quota);
  return data; // { token, username, role, quota }
}

export async function login(username, password) {
  const res = await gwFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    // 자격 증명 실패는 계정/비번 구분 없는 메시지
    if (res.status === 401) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
    throw new Error(await errMessage(res, '로그인 실패'));
  }
  const data = await res.json();
  setToken(data.token);
  updateQuota(data.quota);
  return data; // { token, username, role, quota }
}

export async function logout() {
  try { await gwFetch('/auth/logout', { method: 'POST' }); }
  catch { /* 서버 폐기 실패해도 로컬 토큰은 제거 */ }
  setToken(null);
}

export async function me() {
  const res = await gwFetch('/auth/me', {});
  if (!res.ok) throw new Error(await errMessage(res, '세션 확인 실패'));
  const data = await res.json();
  updateQuota(data.quota);
  return data; // { username, role, quota }
}

export async function changePassword(currentPassword, newPassword) {
  const res = await gwFetch('/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) throw new Error(await errMessage(res, '비밀번호 변경 실패'));
  return true; // 204
}

/* ---------- 관리자 ---------- */
export async function adminListAccounts() {
  const res = await gwFetch('/admin/accounts', {});
  if (!res.ok) throw new Error(await errMessage(res, '계정 목록 조회 실패'));
  const data = await res.json();
  // 서버는 { accounts: [...] } 형태로 반환 — 배열 직반환 형태도 방어적으로 수용
  return Array.isArray(data) ? data : (data?.accounts || []);
}

export async function adminCreateAccount(username, password, role = 'user', dailyLimit) {
  const body = { username, password, role };
  if (dailyLimit !== undefined && dailyLimit !== null && dailyLimit !== '' && !Number.isNaN(Number(dailyLimit))) {
    body.dailyLimit = Number(dailyLimit);
  }
  const res = await gwFetch('/admin/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errMessage(res, '계정 생성 실패'));
  return res.json();
}

export async function adminDeleteAccount(username) {
  const res = await gwFetch('/admin/accounts/' + encodeURIComponent(username), { method: 'DELETE' });
  if (!res.ok) throw new Error(await errMessage(res, '계정 삭제 실패'));
  return true; // 204
}

export async function adminSetQuota(username, dailyLimit) {
  const res = await gwFetch('/admin/accounts/' + encodeURIComponent(username) + '/quota', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dailyLimit: Number(dailyLimit) }),
  });
  if (!res.ok) throw new Error(await errMessage(res, '한도 변경 실패'));
  const data = await res.json();
  return data.quota;
}

/* ---------- 쿼터 캐시/방송 ---------- */
let quotaCache = null;

export function quotaState() {
  return quotaCache ? { ...quotaCache } : null;
}

function broadcastQuota() {
  try { window.dispatchEvent(new CustomEvent('rbtl:gw-quota', { detail: quotaCache ? { ...quotaCache } : null })); }
  catch { /* 방어 */ }
}

// 서버가 준 quota 객체({dailyLimit, usedToday, remaining?})로 캐시 갱신 + 방송
export function updateQuota(q) {
  if (!q || typeof q !== 'object') return;
  const dailyLimit = Number(q.dailyLimit);
  const usedToday = Number(q.usedToday);
  let remaining = Number(q.remaining);
  if (!Number.isFinite(remaining)) {
    remaining = (Number.isFinite(dailyLimit) && Number.isFinite(usedToday)) ? Math.max(0, dailyLimit - usedToday) : NaN;
  }
  quotaCache = {
    dailyLimit: Number.isFinite(dailyLimit) ? dailyLimit : (quotaCache?.dailyLimit ?? 0),
    usedToday: Number.isFinite(usedToday) ? usedToday : (quotaCache?.usedToday ?? 0),
    remaining: Number.isFinite(remaining) ? Math.max(0, remaining) : (quotaCache?.remaining ?? 0),
  };
  broadcastQuota();
}

// LLM 응답 헤더 X-Quota-Remaining 만으로 쿼터 갱신(남은 호출 기준으로 usedToday 역산)
export function setQuotaRemaining(remaining) {
  const r = Number(remaining);
  if (!Number.isFinite(r)) return;
  const prev = quotaCache || { dailyLimit: 0, usedToday: 0, remaining: 0 };
  const dailyLimit = Number(prev.dailyLimit) || 0;
  quotaCache = {
    dailyLimit,
    usedToday: dailyLimit ? Math.max(0, dailyLimit - r) : prev.usedToday,
    remaining: Math.max(0, r),
  };
  broadcastQuota();
}

/* ---------- 공유 데이터 동기화 ---------- */
let suppressPush = false;      // pullShared 로 store.set 하는 동안 subscribe→push 루프 억제
let lastVersions = {};         // key -> 마지막으로 pull 한 updatedAt
const pushTimers = {};         // key -> setTimeout 핸들
const pushWarned = {};         // key -> 실패 경고 토스트 1회 표시 여부
let sharedSyncStarted = false;

function keyLabel(key) {
  return key === 'mcps' ? 'MCP' : key === 'strategies' ? '전략' : key === 'benchmarks' ? '벤치마크' : key;
}

/**
 * 서버의 공유 데이터를 로컬 store 로 당겨온다.
 * versions 를 비교해 변경된 키만 GET → store.set. store.set 직전 push 억제 플래그를 세워
 * subscribe→schedulePush 루프를 방지한다. 반환: 실제로 갱신된 키 목록.
 */
export async function pullShared() {
  if (!isServerMode()) return [];
  let versions = null;
  try {
    const vres = await gwFetch('/data/versions', {});
    if (vres.ok) versions = await vres.json(); // { mcps, strategies, benchmarks: updatedAt|null }
  } catch { /* 버전 조회 실패 시 개별 키를 무조건 시도 */ }

  const updated = [];
  for (const key of SHARED_KEYS) {
    const serverV = versions ? versions[key] : undefined;
    if (versions) {
      if (serverV == null) continue;              // 서버에 공유본 없음 → 로컬 유지
      if (serverV === lastVersions[key]) continue; // 변경 없음
    }
    try {
      const res = await gwFetch('/data/' + key, {});
      if (!res.ok) continue;
      const data = await res.json(); // { updatedAt, updatedBy, items }
      if (data && Array.isArray(data.items)) {
        suppressPush = true;
        try { store.set(key, data.items); }
        finally { suppressPush = false; }
        lastVersions[key] = data.updatedAt || serverV || new Date().toISOString();
        updated.push(key);
      }
    } catch { /* 개별 키 실패는 무시하고 다음 키 진행 */ }
  }
  return updated;
}

/**
 * 단일 공유 키를 서버로 PUT — doPush(디바운스 경로)와 pushSharedNow(즉시 경로)가 공용.
 * 성공 시 lastVersions 갱신 + 경고 상태 리셋. 성공 여부(boolean)만 반환하고
 * 실패 알림(토스트)은 호출자 몫으로 남긴다(경로별 알림 정책이 다르므로).
 */
async function putShared(key) {
  if (!isServerMode()) return false;
  const items = store.get(key);
  if (!Array.isArray(items)) return false;
  try {
    const res = await gwFetch('/data/' + key, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json().catch(() => ({}));
    if (data && data.updatedAt) lastVersions[key] = data.updatedAt;
    pushWarned[key] = false; // 성공 시 경고 상태 리셋
    return true;
  } catch {
    return false;
  }
}

async function doPush(key) {
  if (!isServerMode()) return;
  if (!Array.isArray(store.get(key))) return; // 기존 동작 유지: 배열이 아니면 조용히 건너뜀
  const ok = await putShared(key);
  if (!ok && !pushWarned[key]) {
    pushWarned[key] = true;
    toast(`공유 데이터(${keyLabel(key)}) 서버 동기화에 실패했습니다. 변경 시 자동으로 다시 시도합니다.`, 'warn', 5000);
  }
}

/**
 * 공유 키들을 디바운스 없이 즉시 서버로 PUT(순차 await).
 * - 각 키의 예약된 디바운스 push는 취소한다(같은 데이터의 중복 PUT 방지).
 * - 성공한 키는 putShared 내부에서 lastVersions가 갱신된다.
 * - 반환: { ok: 전부 성공 여부, failed: 실패한 키 목록 }
 * - 서버 모드가 아니면 아무것도 전송하지 않고 { ok:false, failed:[요청 키 전부] } 반환
 *   (호출자는 서버 모드에서만 호출하는 것이 계약이지만 방어적으로 처리).
 */
export async function pushSharedNow(keys = SHARED_KEYS) {
  const targets = (Array.isArray(keys) ? keys : []).filter((k) => SHARED_KEYS.includes(k));
  if (!isServerMode()) return { ok: false, failed: targets.slice() };
  const failed = [];
  for (const key of targets) {
    clearTimeout(pushTimers[key]); // 지금 즉시 push하므로 예약분은 취소
    const ok = await putShared(key);
    if (!ok) failed.push(key);
  }
  return { ok: failed.length === 0, failed };
}

/** 공유 키 변경을 2초 debounce 후 서버로 PUT (서버 모드에서만). */
export function schedulePush(key) {
  if (!isServerMode()) return;
  if (!SHARED_KEYS.includes(key)) return;
  if (suppressPush) return; // pullShared 로 인한 변경은 되돌려 보내지 않음
  clearTimeout(pushTimers[key]);
  pushTimers[key] = setTimeout(() => doPush(key), 2000);
}

/** 앱 부트 시 1회 호출 — 공유 키 store.subscribe → schedulePush 구독 설정. */
export function startSharedSync() {
  if (sharedSyncStarted) return;
  sharedSyncStarted = true;
  for (const key of SHARED_KEYS) {
    store.subscribe(key, () => schedulePush(key));
  }
}
