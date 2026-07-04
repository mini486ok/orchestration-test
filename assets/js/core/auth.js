// 계정/세션 관리 — PBKDF2(SHA-256) 해시. 계정 정보는 이 브라우저의 localStorage에만 저장됨.
// 주의: 정적 호스팅 특성상 클라이언트 측 접근 제어이며, 서버 수준의 보안을 제공하지 않음.
import { store } from './store.js';

const ITERATIONS = 150000;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 세션 최대 유효기간 7일

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password, saltHex, iterations = ITERATIONS) {
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return toHex(bits);
}

export const auth = {
  hasAccounts() {
    const list = store.get('accounts');
    return Array.isArray(list) && list.length > 0;
  },

  listAccounts() {
    return (store.get('accounts') || []).map(({ hash, salt, ...rest }) => rest);
  },

  async createAccount(username, password, role = 'user') {
    username = String(username || '').trim();
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) throw new Error('아이디는 2~32자의 영문/숫자/._- 만 사용할 수 있습니다.');
    if (String(password || '').length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다.');
    const accounts = store.get('accounts') || [];
    if (accounts.some(a => a.username.toLowerCase() === username.toLowerCase())) throw new Error('이미 존재하는 아이디입니다.');
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await pbkdf2(password, salt);
    accounts.push({ id: crypto.randomUUID(), username, role, salt, hash, iterations: ITERATIONS, createdAt: new Date().toISOString() });
    store.set('accounts', accounts);
    return true;
  },

  async login(username, password) {
    const accounts = store.get('accounts') || [];
    const acc = accounts.find(a => a.username.toLowerCase() === String(username).trim().toLowerCase());
    if (!acc) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
    const hash = await pbkdf2(password, acc.salt, acc.iterations || ITERATIONS);
    if (hash !== acc.hash) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
    const session = { username: acc.username, role: acc.role, loginAt: new Date().toISOString() };
    store.set('session', session);
    return session;
  },

  logout() { store.set('session', null); },

  session() {
    const s = store.get('session');
    if (!s) return null;
    // loginAt이 없거나 손상됐거나 7일 초과면 세션 무효화
    const age = s.loginAt ? Date.now() - new Date(s.loginAt).getTime() : NaN;
    if (!Number.isFinite(age) || age < 0 || age > SESSION_MAX_AGE_MS) {
      store.set('session', null);
      return null;
    }
    return s;
  },

  isAdmin() { return this.session()?.role === 'admin'; },

  async changePassword(username, currentPassword, newPassword) {
    const accounts = store.get('accounts') || [];
    const acc = accounts.find(a => a.username === username);
    if (!acc) throw new Error('계정을 찾을 수 없습니다.');
    const cur = await pbkdf2(currentPassword, acc.salt, acc.iterations || ITERATIONS);
    if (cur !== acc.hash) throw new Error('현재 비밀번호가 올바르지 않습니다.');
    if (String(newPassword || '').length < 6) throw new Error('새 비밀번호는 6자 이상이어야 합니다.');
    acc.salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    acc.hash = await pbkdf2(newPassword, acc.salt);
    acc.iterations = ITERATIONS;
    store.set('accounts', accounts);
    return true;
  },

  removeAccount(username) {
    const accounts = store.get('accounts') || [];
    const target = accounts.find(a => a.username === username);
    if (!target) throw new Error('계정을 찾을 수 없습니다.');
    const current = this.session();
    if (current && current.username === username) {
      throw new Error('본인 계정은 삭제할 수 없습니다.');
    }
    if (target.role === 'admin' && accounts.filter(a => a.role === 'admin').length <= 1) {
      throw new Error('마지막 관리자 계정은 삭제할 수 없습니다.');
    }
    store.set('accounts', accounts.filter(a => a.username !== username));
    return true;
  },
};
