// 중앙 상태 저장소 — localStorage 영속화 + pub/sub
const PREFIX = 'rbtl:';
const cache = new Map();
const subs = new Map(); // key -> Set<cb>

function deepClone(v) {
  if (v === undefined || v === null) return v;
  return JSON.parse(JSON.stringify(v));
}

// 프로토타입 오염 방지: 가져온 객체 트리에서 위험 키를 재귀 제거(깊이 8 제한)
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function sanitizeTree(v, depth = 0) {
  if (depth > 32 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = sanitizeTree(v[i], depth + 1);
    return v;
  }
  for (const k of Object.keys(v)) {
    if (DANGEROUS_KEYS.has(k)) { delete v[k]; continue; }
    v[k] = sanitizeTree(v[k], depth + 1);
  }
  return v;
}

function load(key) {
  if (cache.has(key)) return cache.get(key);
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const val = raw === null ? undefined : JSON.parse(raw);
    cache.set(key, val);
    return val;
  } catch (e) {
    console.warn('[store] 로드 실패:', key, e);
    return undefined;
  }
}

function persist(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('[store] 저장 실패(용량 초과 가능):', key, e);
    try { window.dispatchEvent(new CustomEvent('rbtl:persist-failed', { detail: { key } })); } catch { /* 비브라우저 환경 방어 */ }
    return false;
  }
}

function notify(key) {
  const set = subs.get(key);
  if (!set) return;
  const val = cache.get(key);
  for (const cb of [...set]) {
    try { cb(deepClone(val)); } catch (e) { console.error('[store] 구독자 오류:', e); }
  }
}

// 멀티탭 동기화: 다른 탭에서 PREFIX 키가 바뀌면 캐시를 무효화하고 구독자에게 재알림
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    const key = e.key.slice(PREFIX.length);
    cache.delete(key);
    load(key);   // 새 값(또는 제거 시 undefined)으로 캐시 재적재
    notify(key);
  });
}

export const store = {
  get(key) { return deepClone(load(key)); },

  set(key, value) {
    const next = deepClone(value);
    const ok = persist(key, next);
    // 저장 실패 시 캐시/구독자 상태를 바꾸지 않는다 — 메모리와 스토리지의 불일치(새로고침 시 증발) 방지
    if (!ok) return false;
    cache.set(key, next);
    notify(key);
    return true;
  },

  update(key, fn) {
    const next = fn(this.get(key));
    return this.set(key, next);
  },

  subscribe(key, cb) {
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(cb);
    return () => subs.get(key)?.delete(cb);
  },

  /** 전체 데이터 내보내기 (계정/세션 제외 옵션) */
  export({ includeAccounts = false } = {}) {
    const keys = ['settings', 'mcps', 'strategies', 'benchmarks', 'runs'];
    if (includeAccounts) keys.push('accounts');
    const out = { _app: 'rail-brain-test-lab', _version: 1, _exportedAt: new Date().toISOString() };
    for (const k of keys) out[k] = this.get(k);
    return out;
  },

  /**
   * 내보낸 데이터 가져오기 — 키별 타입 검증 후 존재하는 키만 덮어씀.
   * accounts는 includeAccounts=true일 때만, 각 항목 형태 검증에 통과할 때만 반영(하나라도 위반 시 전체 거부).
   * @returns {{applied: string[], skipped: string[], accountsIncluded: boolean}}
   */
  import(obj, { includeAccounts = false } = {}) {
    if (!obj || obj._app !== 'rail-brain-test-lab') throw new Error('올바른 백업 파일이 아닙니다.');

    // 계정 포함 시 먼저 형태를 검증 — 실패하면 아무것도 반영하지 않고 전체 거부
    let accountsToApply = null;
    if (includeAccounts && obj.accounts !== undefined) {
      const accs = sanitizeTree(deepClone(obj.accounts));
      const ok = Array.isArray(accs) && accs.every(a =>
        a && typeof a === 'object'
        && typeof a.username === 'string'
        && (a.role === 'admin' || a.role === 'user')
        && typeof a.salt === 'string'
        && typeof a.hash === 'string'
        && (a.iterations === undefined || (typeof a.iterations === 'number' && a.iterations > 0)));
      if (!ok) throw new Error('백업의 계정 데이터 형식이 올바르지 않아 가져오기를 중단했습니다.');
      accountsToApply = accs;
    }

    const applied = [];
    const skipped = [];
    const dataKeys = ['settings', 'mcps', 'strategies', 'benchmarks', 'runs'];
    const arrayKeys = new Set(['mcps', 'strategies', 'benchmarks', 'runs']);

    for (const k of dataKeys) {
      if (obj[k] === undefined) continue;
      const val = sanitizeTree(deepClone(obj[k]));
      if (k === 'settings') {
        if (val === null || typeof val !== 'object' || Array.isArray(val)) { skipped.push(k); continue; }
        // ollamaUrl은 http/https만 허용 — 악성 백업이 설정 화면의 URL 검증을 우회해 LLM 트래픽을 외부로 돌리는 것 방지
        if (val.ollamaUrl !== undefined) {
          let urlOk = false;
          try {
            const u = new URL(String(val.ollamaUrl));
            urlOk = u.protocol === 'http:' || u.protocol === 'https:';
          } catch { urlOk = false; }
          if (!urlOk) delete val.ollamaUrl;
        }
      } else if (arrayKeys.has(k) && !Array.isArray(val)) {
        skipped.push(k); continue;
      }
      this.set(k, val);
      applied.push(k);
    }

    let accountsIncluded = false;
    if (accountsToApply) {
      this.set('accounts', accountsToApply);
      accountsIncluded = true;
    } else if (obj.accounts !== undefined && !includeAccounts) {
      skipped.push('accounts');
    }

    return { applied, skipped, accountsIncluded };
  },

  /** 앱 데이터 전체 삭제 (계정 포함 여부 선택) */
  reset({ keepAccounts = true } = {}) {
    const keys = ['settings', 'mcps', 'strategies', 'benchmarks', 'runs', 'session'];
    if (!keepAccounts) keys.push('accounts');
    for (const k of keys) {
      cache.delete(k);
      localStorage.removeItem(PREFIX + k);
      notify(k);
    }
  },
};
