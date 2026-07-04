// 초기 설정(최초 1회 관리자 계정 생성) + 로그인 화면
// mode: 'local'(기본, 이 브라우저 localStorage 계정) | 'server'(중앙 게이트웨이 계정)
// onSubmit(username, password): 지정 시 인증 처리를 위임(서버 모드). 미지정 시 로컬 auth 사용.
import { el, toast, field } from '../core/ui.js';
import { auth } from '../core/auth.js';

function authFrame(title, sub, formBody) {
  return el('div', { class: 'auth-wrap' },
    el('div', { class: 'auth-card' },
      el('div', { class: 'auth-head' },
        el('div', { class: 'auth-sig' }, el('span', { class: 'g' }), el('span', { class: 'a' }), el('span', { class: 'r' })),
        el('div', { class: 'auth-title' }, 'RAIL-BRAIN LAB'),
        el('div', { class: 'auth-sub' }, sub)),
      formBody));
}

/** 최초 실행: 관리자 계정 생성 */
export function renderSetup(container, onDone, { mode = 'local', onSubmit, setupTokenRequired = false } = {}) {
  const server = mode === 'server';
  const idInput = el('input', { class: 'input', placeholder: '예: admin', autocomplete: 'username' });
  const pw1 = el('input', { class: 'input', type: 'password', placeholder: '6자 이상', autocomplete: 'new-password' });
  const pw2 = el('input', { class: 'input', type: 'password', placeholder: '비밀번호 재입력', autocomplete: 'new-password' });
  // 서버가 초기 설정 토큰을 요구하는 경우(터널 등 원격 접속)에만 토큰 입력 필드를 표시
  const tokenInput = (server && setupTokenRequired)
    ? el('input', { class: 'input mono-input', placeholder: '게이트웨이 실행 창에 표시된 토큰', autocomplete: 'off' })
    : null;
  const btn = el('button', { class: 'btn btn-primary btn-lg', type: 'submit', style: { width: '100%' } },
    server ? '서버 관리자 계정 생성' : '관리자 계정 생성');

  const note = server
    ? el('div', { class: 'auth-note' },
        '중앙 게이트웨이 서버의 관리자 계정을 생성합니다.',
        el('br'), '이 계정으로 서버의 사용자·LLM 호출 한도를 관리합니다.')
    : el('div', { class: 'auth-note' },
        '계정 정보는 이 브라우저(localStorage)에만 저장되며 저장소(repo)에는 포함되지 않습니다.',
        el('br'), '로그인 후 설정에서 사용자 계정을 추가할 수 있습니다.');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (pw1.value !== pw2.value) return toast('비밀번호가 일치하지 않습니다.', 'error');
      if (tokenInput && !tokenInput.value.trim()) return toast('초기 설정 토큰을 입력하세요. (게이트웨이 실행 창에 표시됩니다)', 'error');
      btn.disabled = true;
      try {
        if (onSubmit) {
          await onSubmit(idInput.value.trim(), pw1.value, tokenInput ? tokenInput.value.trim() : undefined);
        } else {
          await auth.createAccount(idInput.value, pw1.value, 'admin');
          await auth.login(idInput.value, pw1.value);
        }
        toast(server ? '서버 관리자 계정이 생성되었습니다. 환영합니다!' : '관리자 계정이 생성되었습니다. 환영합니다!', 'success');
        onDone();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    },
  },
    field({ label: '관리자 아이디', input: idInput, required: true }),
    field({ label: '비밀번호', input: pw1, required: true }),
    field({ label: '비밀번호 확인', input: pw2, required: true }),
    tokenInput ? field({ label: '초기 설정 토큰', input: tokenInput, required: true, hint: '게이트웨이(start-gateway.bat) 실행 창에 표시된 토큰을 입력하세요. 터널로 접속했을 때 최초 관리자 선점을 막기 위한 것입니다.' }) : null,
    btn,
    note);

  container.replaceChildren(authFrame(
    server ? '서버 초기 설정' : '초기 설정',
    server ? '서버 최초 실행 — 관리자 계정을 만들어 주세요' : '최초 실행입니다 — 관리자 계정을 만들어 주세요',
    form));
  idInput.focus();
}

/** 로그인 */
export function renderLogin(container, onDone, { mode = 'local', onSubmit } = {}) {
  const server = mode === 'server';
  const idInput = el('input', { class: 'input', placeholder: '아이디', autocomplete: 'username' });
  const pwInput = el('input', { class: 'input', type: 'password', placeholder: '비밀번호', autocomplete: 'current-password' });
  const btn = el('button', { class: 'btn btn-primary btn-lg', type: 'submit', style: { width: '100%' } }, '로그인');

  const note = server
    ? el('div', { class: 'auth-note' },
        '중앙 게이트웨이 서버 계정으로 로그인합니다.',
        el('br'), '계정·호출 한도는 서버 관리자에게 문의하세요.')
    : el('div', { class: 'auth-note' },
        '철도·교통 MCP 오케스트레이션 개발·테스트 플랫폼', el('br'), '인가된 사용자만 접근할 수 있습니다.');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        if (onSubmit) await onSubmit(idInput.value.trim(), pwInput.value);
        else await auth.login(idInput.value, pwInput.value);
        toast(`${idInput.value.trim()}님, 환영합니다.`, 'success');
        onDone();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        pwInput.value = '';
        pwInput.focus();
      }
    },
  },
    field({ label: '아이디', input: idInput }),
    field({ label: '비밀번호', input: pwInput }),
    btn,
    note);

  container.replaceChildren(authFrame(
    server ? '서버 로그인' : '로그인',
    server ? '중앙 서버 계정으로 로그인' : 'MCP 오케스트레이션 테스트 랩에 로그인하세요',
    form));
  idInput.focus();
}
