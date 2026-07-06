// 설정 — Ollama 연결/모델, 중앙 게이트웨이(서버 모드), 계정 관리, 데이터 백업·복원·초기화
import { store } from '../core/store.js';
import { auth } from '../core/auth.js';
import { el, toast, field, badge, confirmDialog, modal, downloadJSON, pickJSONFile, fmt, spinner } from '../core/ui.js';
import { checkConnection, listModels } from '../services/ollama.js';
import {
  isServerMode, getGatewayUrl, health as gwHealth, pullShared, quotaState,
  me as gwMe, changePassword as gwChangePassword,
  adminListAccounts, adminCreateAccount, adminDeleteAccount, adminSetQuota,
} from '../services/gateway.js';
import { SAMPLE_MCPS } from '../data/sampleMcps.js';

const DEFAULT_SETTINGS = {
  ollamaUrl: 'http://localhost:11434',
  defaultModel: 'exaone3.5:7.8b',
  temperature: 0.2,
  maxSteps: 6,
  numCtx: 16384, // app.js·ollama.js 기본값과 통일
  llmTimeoutSec: 300, // LLM 호출당 타임아웃(초). 0=무제한
};

export async function render(container) {
  // settings가 손상되었거나 객체가 아니면 기본값으로 재시드 후 진행
  let settings = store.get('settings');
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    settings = { ...DEFAULT_SETTINGS };
    store.set('settings', settings);
  }

  const serverMode = isServerMode();
  // settings 객체를 안전하게 병합 저장하는 헬퍼
  const patchSettings = (patch) =>
    store.update('settings', s => ({ ...((s && typeof s === 'object' && !Array.isArray(s)) ? s : {}), ...patch }));
  const removeGateway = () =>
    store.update('settings', s => {
      const n = { ...((s && typeof s === 'object' && !Array.isArray(s)) ? s : {}) };
      delete n.gatewayUrl;
      return n;
    });

  // 서버 모드면 내 계정 정보(역할·쿼터)를 미리 조회
  let serverMe = null;
  if (serverMode) {
    try { serverMe = await gwMe(); } catch { /* 네트워크 실패 시 아래에서 degrade */ }
  }
  const isServerAdmin = serverMode && serverMe?.role === 'admin';

  /* ---------- Ollama 연결 ---------- */
  const urlInput = el('input', {
    class: 'input mono-input', value: settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl,
    disabled: serverMode,
  });
  const connState = el('span', {}, badge('미확인', 'dim'));
  const modelSelect = el('select', { class: 'select' });
  const modelState = el('div', { class: 'hint' }, '연결 확인 후 모델 목록을 불러옵니다.');

  async function refreshModels() {
    const s = store.get('settings') || {};
    const defModel = s.defaultModel || DEFAULT_SETTINGS.defaultModel;
    modelSelect.replaceChildren(el('option', { value: defModel }, defModel + ' (현재 설정)'));
    try {
      const models = await listModels();
      if (!models.length) { modelState.textContent = '설치된 모델이 없습니다. `ollama pull exaone3.5:7.8b` 로 설치하세요.'; return; }
      modelSelect.replaceChildren(...models.map(m =>
        el('option', { value: m.name, selected: m.name === defModel },
          `${m.name}  (${m.paramSize || '?'} · ${m.sizeGB}GB)`)));
      modelState.textContent = `${models.length}개 모델 사용 가능 — 기본 모델은 모든 LLM 기능(전략 실행·AI 생성·벤치마크 생성)의 기본값이 됩니다.`;
    } catch (e) {
      modelState.textContent = '모델 목록을 불러오지 못했습니다: ' + e.message;
    }
  }

  async function testConn() {
    connState.replaceChildren(spinner());
    const r = await checkConnection();
    connState.replaceChildren(r.ok ? badge(`연결 성공 · v${r.version}`, 'green') : badge(`연결 실패: ${r.error}`, 'red'));
    if (r.ok) refreshModels();
  }

  // 고급: 컨텍스트 길이(num_ctx) — 기본 16384(구버전 settings에 numCtx가 없어도 16384로 표시)
  const CTX_VALUES = [4096, 8192, 16384, 32768];
  const curCtx = Number(settings.numCtx) > 0 ? Number(settings.numCtx) : 16384;
  const ctxSelect = el('select', {
    class: 'select',
    onchange: () => {
      const v = Number(ctxSelect.value) > 0 ? Number(ctxSelect.value) : 16384;
      patchSettings({ numCtx: v });
      toast(`컨텍스트 길이가 ${v.toLocaleString()} 토큰으로 설정되었습니다.`, 'success');
    },
  }, CTX_VALUES.map(v => el('option', { value: String(v), selected: v === curCtx }, `${v.toLocaleString()} 토큰`)));

  // 고급: LLM 응답 타임아웃(초) — LLM 호출 1회당 적용. 0=무제한, 기본 300초
  const curTimeoutSec = (() => {
    const v = Number(settings.llmTimeoutSec);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 300;
  })();
  const timeoutInput = el('input', {
    class: 'input mono-input', type: 'number', min: '0', step: '10', value: String(curTimeoutSec),
    onchange: () => {
      let v = Math.floor(Number(timeoutInput.value));
      if (!Number.isFinite(v) || v < 0) v = 300;
      timeoutInput.value = String(v);
      patchSettings({ llmTimeoutSec: v });
      toast(v === 0 ? 'LLM 타임아웃이 해제되었습니다(무제한).' : `LLM 타임아웃이 ${v}초로 설정되었습니다.`, 'success');
    },
  });

  const connCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, 'Ollama LLM 연결'),
    field({
      label: 'Ollama 서버 주소', input: urlInput,
      hint: serverMode
        ? '서버 모드에서는 게이트웨이가 LLM을 중계합니다. 이 주소 대신 게이트웨이의 내부 Ollama가 사용됩니다.'
        : '기본값 http://localhost:11434 (이 컴퓨터의 Ollama). 다른 PC의 Ollama를 쓰려면 그 서버의 터널 주소(예: https://xxx.trycloudflare.com) 또는 LAN 주소(예: http://192.168.0.10:11434)를 입력하세요 — 가이드의 "다른 PC에서 사용하기" 참조.',
    }),
    el('div', { class: 'row wrap', style: { marginBottom: '14px' } },
      el('button', {
        class: 'btn', disabled: serverMode, onclick: () => {
          const raw = urlInput.value.trim();
          let parsed;
          try { parsed = new URL(raw); } catch { parsed = null; }
          if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
            toast('올바른 URL이 아닙니다. http:// 또는 https:// 로 시작하는 주소를 입력하세요.', 'error');
            return;
          }
          const clean = raw.replace(/\/+$/, '');
          patchSettings({ ollamaUrl: clean });
          urlInput.value = clean;
          toast('서버 주소가 저장되었습니다.', 'success');
          testConn();
        },
      }, '저장 후 연결 테스트'),
      el('button', {
        class: 'btn btn-ghost', disabled: serverMode, title: '현재 서버 주소가 자동 설정되는 접속 링크를 복사합니다 — 다른 PC 사용자에게 이 링크만 공유하면 됩니다.',
        onclick: async () => {
          const cur = (store.get('settings') || {}).ollamaUrl || urlInput.value.trim();
          const link = location.origin + location.pathname + '?ollama=' + encodeURIComponent(cur);
          try {
            await navigator.clipboard.writeText(link);
            toast('공유 링크가 복사되었습니다. 다른 PC에서 이 링크로 접속하면 LLM 서버 주소가 자동 설정됩니다.', 'success', 6000);
          } catch {
            toast('클립보드 복사에 실패했습니다: ' + link, 'warn', 8000);
          }
        },
      }, '🔗 공유 링크 복사'),
      connState),
    field({ label: '기본 LLM 모델', input: modelSelect, hint: modelState.textContent }),
    modelState,
    el('div', { class: 'row', style: { marginTop: '10px' } },
      el('button', {
        class: 'btn btn-primary', onclick: () => {
          patchSettings({ defaultModel: modelSelect.value });
          toast(`기본 모델이 ${modelSelect.value} 로 설정되었습니다.`, 'success');
        },
      }, '기본 모델로 저장'),
      el('button', { class: 'btn btn-ghost', onclick: refreshModels }, '목록 새로고침')),
    field({
      label: '컨텍스트 길이 (고급)', input: ctxSelect,
      hint: 'LLM이 한 번에 처리하는 토큰 수(num_ctx). 값이 클수록 더 긴 문맥을 다루지만 메모리를 더 사용합니다. 기본 16384.',
    }),
    field({
      label: 'LLM 응답 타임아웃 (초, 고급)', input: timeoutInput,
      hint: 'LLM 호출 1회가 이 시간을 넘으면 오류로 중단합니다 — 문항이 멈추는 것을 방지. 0=무제한. 기본 300초.',
    }));

  /* ---------- 중앙 게이트웨이 (서버 모드) ---------- */
  const gwUrlInput = el('input', {
    class: 'input mono-input', value: getGatewayUrl() || '',
    placeholder: 'https://xxx.trycloudflare.com 또는 http://localhost:8799',
  });
  const gwState = el('span', {}, badge(serverMode ? '확인 중…' : '미설정', serverMode ? 'amber' : 'dim'));

  async function testGwHealth() {
    if (!isServerMode()) { gwState.replaceChildren(badge('미설정', 'dim')); return; }
    gwState.replaceChildren(spinner());
    try {
      const h = await gwHealth();
      if (h && h.ok) {
        gwState.replaceChildren(badge(`연결됨 · v${h.version || '?'} · LLM ${h.ollama ? '✓' : '✗'}`, h.ollama ? 'green' : 'amber'));
      } else {
        gwState.replaceChildren(badge('비정상 응답', 'red'));
      }
    } catch {
      gwState.replaceChildren(badge('연결 실패', 'red'));
    }
  }

  // 내 쿼터 (서버 모드)
  const quotaWrap = el('div', { class: 'gw-quota-box' });
  function renderMyQuota() {
    const q = serverMe?.quota || quotaState();
    if (!q) { quotaWrap.replaceChildren(el('div', { class: 'hint' }, '쿼터 정보를 불러오지 못했습니다.')); return; }
    const limit = Number(q.dailyLimit);
    const used = Number(q.usedToday);
    const remaining = q.remaining != null ? Number(q.remaining)
      : (Number.isFinite(limit) && Number.isFinite(used) ? Math.max(0, limit - used) : NaN);
    const kpi = (val, label, color) => el('div', { class: 'kpi gw-quota-kpi' },
      el('div', { class: 'kpi-value', style: color ? { color } : {} }, Number.isFinite(Number(val)) ? String(val) : '-'),
      el('div', { class: 'kpi-label' }, label));
    quotaWrap.replaceChildren(
      el('div', { class: 'gw-quota-row' },
        kpi(used, '오늘 사용'),
        kpi(limit, '일일 한도'),
        kpi(remaining, '남은 호출', Number(remaining) <= 0 ? 'var(--sig-red)' : 'var(--sig-green)')));
  }

  function changePwModal() {
    const cur = el('input', { class: 'input', type: 'password', placeholder: '현재 비밀번호' });
    const nw = el('input', { class: 'input', type: 'password', placeholder: '새 비밀번호 (6자 이상)' });
    modal({
      title: serverMode ? '비밀번호 변경 (서버)' : '비밀번호 변경',
      body: el('div', {}, field({ label: '현재 비밀번호', input: cur }), field({ label: '새 비밀번호', input: nw })),
      actions: [
        { label: '취소', class: 'btn-ghost' },
        {
          label: '변경', class: 'btn-primary', onClick: async () => {
            try {
              if (serverMode) await gwChangePassword(cur.value, nw.value);
              else await auth.changePassword(auth.session().username, cur.value, nw.value);
              toast('비밀번호가 변경되었습니다.', 'success');
            } catch (e) { toast(e.message, 'error'); return false; }
          },
        },
      ],
    });
  }

  const gatewayBody = [
    el('div', { class: 'panel-title' }, '중앙 게이트웨이 (서버 모드)'),
    el('p', { class: 'hint', style: { marginBottom: '12px' } },
      '게이트웨이 서버를 설정하면 중앙에서 계정·LLM 호출 한도·공유 데이터(MCP/전략/벤치마크)를 관리합니다. 동시 편집은 마지막 저장이 반영됩니다(last-write-wins).'),
    field({
      label: '게이트웨이 주소', input: gwUrlInput,
      hint: '게이트웨이(포트 8799)의 공개 주소. cloudflared 터널 주소 또는 LAN/localhost 주소를 입력하세요.',
    }),
    el('div', { class: 'row wrap', style: { marginBottom: '10px' } },
      el('button', {
        class: 'btn', onclick: async () => {
          const raw = gwUrlInput.value.trim();
          if (!raw) { toast('게이트웨이 주소를 입력하세요.', 'error'); return; }
          let parsed; try { parsed = new URL(raw); } catch { parsed = null; }
          if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
            toast('올바른 URL이 아닙니다. http:// 또는 https:// 로 시작하는 주소를 입력하세요.', 'error');
            return;
          }
          const clean = raw.replace(/\/+$/, '');
          patchSettings({ gatewayUrl: clean });
          toast('게이트웨이 주소를 저장했습니다. 서버 모드로 전환합니다.', 'success');
          setTimeout(() => location.reload(), 900);
        },
      }, serverMode ? '주소 변경 후 재접속' : '저장 후 서버 모드 전환'),
      serverMode ? el('button', {
        class: 'btn btn-ghost', onclick: async () => {
          if (!await confirmDialog('서버 모드를 해제하고 로컬 모드로 전환할까요? 이 브라우저의 로컬 계정·데이터·Ollama 직접 연결로 돌아갑니다.', { danger: false, okLabel: '로컬 모드로' })) return;
          removeGateway();
          toast('로컬 모드로 전환합니다.', 'success');
          setTimeout(() => location.reload(), 800);
        },
      }, '해제 (로컬 모드)') : null,
      gwState),
    el('div', { class: 'row wrap' },
      el('button', {
        class: 'btn btn-ghost', title: '이 링크로 접속하면 게이트웨이 주소가 자동 설정되어 서버 모드로 동작합니다.',
        onclick: async () => {
          const cur = getGatewayUrl() || gwUrlInput.value.trim();
          if (!cur) { toast('먼저 게이트웨이 주소를 저장하세요.', 'warn'); return; }
          const link = location.origin + location.pathname + '?gateway=' + encodeURIComponent(cur);
          try {
            await navigator.clipboard.writeText(link);
            toast('서버 모드 공유 링크가 복사되었습니다. 다른 사용자가 이 링크로 접속하면 서버 모드로 자동 설정됩니다.', 'success', 6000);
          } catch {
            toast('클립보드 복사에 실패했습니다: ' + link, 'warn', 8000);
          }
        },
      }, '🔗 서버 모드 링크 복사'),
      el('button', {
        class: 'btn', disabled: !serverMode, onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try {
            const updated = await pullShared();
            toast(updated.length ? `동기화 완료 — 갱신됨: ${updated.join(', ')}` : '이미 최신 상태입니다.', 'success');
          } catch (err) {
            toast('동기화 실패: ' + err.message, 'error');
          } finally { b.disabled = false; }
        },
      }, '⟳ 지금 동기화')),
  ];

  if (serverMode) {
    gatewayBody.push(
      el('div', { class: 'gw-divider' }),
      el('div', { class: 'row between wrap', style: { marginBottom: '8px' } },
        el('div', { class: 'panel-subtitle' }, `내 계정 · ${serverMe?.username || '사용자'} ${isServerAdmin ? '(관리자)' : ''}`),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: changePwModal }, '비밀번호 변경')),
      quotaWrap);
    renderMyQuota();
  } else {
    gatewayBody.push(el('p', { class: 'hint', style: { color: 'var(--tx2)' } }, '현재 로컬 모드입니다. 게이트웨이 주소를 저장하면 서버 모드로 전환됩니다.'));
  }

  const gatewayCard = el('div', { class: 'card' }, ...gatewayBody);

  /* ---------- 로컬 계정 관리 (로컬 모드에서만) ---------- */
  const isAdminLocal = auth.isAdmin();
  const accListWrap = el('div', {});

  function renderAccounts() {
    const accounts = auth.listAccounts();
    accListWrap.replaceChildren(
      el('div', { class: 'tbl-wrap' },
        el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, '아이디'), el('th', {}, '역할'), el('th', {}, '생성일'), isAdminLocal ? el('th', {}, '') : null)),
          el('tbody', {}, accounts.map(a => el('tr', {},
            el('td', {}, a.username),
            el('td', {}, badge(a.role === 'admin' ? '관리자' : '사용자', a.role === 'admin' ? 'green' : 'dim')),
            el('td', {}, fmt.date(a.createdAt)),
            isAdminLocal ? el('td', { style: { textAlign: 'right' } },
              el('button', {
                class: 'btn btn-sm btn-danger', onclick: async () => {
                  if (!await confirmDialog(`계정 '${a.username}' 을(를) 삭제할까요?`)) return;
                  try { auth.removeAccount(a.username); toast('계정이 삭제되었습니다.', 'success'); renderAccounts(); }
                  catch (e) { toast(e.message, 'error'); }
                },
              }, '삭제')) : null))))));
  }

  function addAccountModal() {
    const id = el('input', { class: 'input', placeholder: '아이디 (2~32자 영문/숫자)' });
    const pw = el('input', { class: 'input', type: 'password', placeholder: '비밀번호 (6자 이상)' });
    const roleSel = el('select', { class: 'select' },
      el('option', { value: 'user' }, '사용자'),
      el('option', { value: 'admin' }, '관리자'));
    modal({
      title: '계정 추가',
      body: el('div', {},
        field({ label: '아이디', input: id, required: true }),
        field({ label: '비밀번호', input: pw, required: true }),
        field({ label: '역할', input: roleSel }),
        el('div', { class: 'hint' }, '⚠ 계정은 이 브라우저에만 저장됩니다. 다른 PC/브라우저에서 쓰려면 데이터 내보내기(계정 포함)로 옮기세요.')),
      actions: [
        { label: '취소', class: 'btn-ghost' },
        {
          label: '추가', class: 'btn-primary', onClick: async () => {
            try { await auth.createAccount(id.value, pw.value, roleSel.value); toast('계정이 추가되었습니다.', 'success'); renderAccounts(); }
            catch (e) { toast(e.message, 'error'); return false; }
          },
        },
      ],
    });
  }

  const accountCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, '계정 관리'),
    accListWrap,
    el('div', { class: 'row', style: { marginTop: '12px' } },
      isAdminLocal ? el('button', { class: 'btn', onclick: addAccountModal }, '＋ 계정 추가') : null,
      el('button', { class: 'btn btn-ghost', onclick: changePwModal }, '내 비밀번호 변경')));

  if (!serverMode) renderAccounts();

  /* ---------- 서버 계정·쿼터 관리 (서버 모드 + admin) ---------- */
  const adminWrap = el('div', {});

  function addServerAccountModal() {
    const id = el('input', { class: 'input', placeholder: '아이디 (2~32자 영문/숫자._-)' });
    const pw = el('input', { class: 'input', type: 'password', placeholder: '비밀번호 (6자 이상)' });
    const roleSel = el('select', { class: 'select' },
      el('option', { value: 'user' }, '사용자'),
      el('option', { value: 'admin' }, '관리자'));
    const limit = el('input', { class: 'input', type: 'number', min: '0', placeholder: '일일 한도 (미입력 시 기본 200)' });
    modal({
      title: '서버 계정 추가',
      body: el('div', {},
        field({ label: '아이디', input: id, required: true }),
        field({ label: '비밀번호', input: pw, required: true }),
        field({ label: '역할', input: roleSel }),
        field({ label: '일일 LLM 호출 한도', input: limit })),
      actions: [
        { label: '취소', class: 'btn-ghost' },
        {
          label: '추가', class: 'btn-primary', onClick: async () => {
            try {
              await adminCreateAccount(id.value.trim(), pw.value, roleSel.value, limit.value.trim());
              toast('서버 계정이 추가되었습니다.', 'success');
              renderServerAccounts();
            } catch (e) { toast(e.message, 'error'); return false; }
          },
        },
      ],
    });
  }

  async function renderServerAccounts() {
    adminWrap.replaceChildren(spinner());
    let accounts;
    try {
      accounts = await adminListAccounts();
    } catch (e) {
      adminWrap.replaceChildren(el('div', { class: 'hint', style: { color: 'var(--sig-red)' } }, '계정 목록을 불러오지 못했습니다: ' + e.message));
      return;
    }
    const rows = accounts.map(a => {
      const q = a.quota || {};
      const limit = Number(q.dailyLimit) || 0;
      const used = Number(q.usedToday) || 0;
      const remaining = Math.max(0, limit - used);
      const limitInput = el('input', {
        class: 'input mono-input', type: 'number', min: '0', value: String(limit),
        style: { width: '92px', padding: '5px 8px' },
      });
      return el('tr', {},
        el('td', {}, a.username),
        el('td', {}, badge(a.role === 'admin' ? '관리자' : '사용자', a.role === 'admin' ? 'green' : 'dim')),
        el('td', { class: 'mono' }, `${used} / ${limit}`),
        el('td', { class: 'mono', style: { color: remaining <= 0 ? 'var(--sig-red)' : 'var(--tx1)' } }, String(remaining)),
        el('td', {},
          el('div', { class: 'row', style: { gap: '6px', justifyContent: 'flex-end' } },
            limitInput,
            el('button', {
              class: 'btn btn-sm', title: '일일 한도 저장', onclick: async () => {
                try {
                  await adminSetQuota(a.username, Number(limitInput.value));
                  toast(`${a.username} 한도를 ${Number(limitInput.value)}(으)로 변경했습니다.`, 'success');
                  renderServerAccounts();
                } catch (e) { toast(e.message, 'error'); }
              },
            }, '저장'),
            el('button', {
              class: 'btn btn-sm btn-danger', onclick: async () => {
                if (!await confirmDialog(`서버 계정 '${a.username}' 을(를) 삭제할까요? 해당 사용자의 세션이 모두 폐기됩니다.`)) return;
                try { await adminDeleteAccount(a.username); toast('계정이 삭제되었습니다.', 'success'); renderServerAccounts(); }
                catch (e) { toast(e.message, 'error'); }
              },
            }, '삭제'))));
    });
    adminWrap.replaceChildren(
      el('div', { class: 'tbl-wrap' },
        el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {},
            el('th', {}, '아이디'), el('th', {}, '역할'), el('th', {}, '사용 / 한도'), el('th', {}, '남음'), el('th', { style: { textAlign: 'right' } }, '관리'))),
          el('tbody', {}, rows))));
  }

  const adminCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, '서버 계정 · 쿼터 관리', el('span', { class: 'sub' }, '관리자')),
    adminWrap,
    el('div', { class: 'row', style: { marginTop: '12px' } },
      el('button', { class: 'btn', onclick: addServerAccountModal }, '＋ 서버 계정 추가'),
      el('button', { class: 'btn btn-ghost', onclick: renderServerAccounts }, '목록 새로고침')));

  if (isServerAdmin) renderServerAccounts();

  /* ---------- 데이터 관리 ---------- */
  const dataCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, '데이터 백업 · 복원'),
    el('p', { class: 'hint', style: { marginBottom: '12px' } },
      serverMode
        ? '공유 데이터(MCP/전략/벤치마크)는 게이트웨이 서버에 저장되어 사용자 간 공유됩니다. 평가 이력(runs)은 이 브라우저에만 남습니다. 아래 백업/복원은 이 브라우저의 로컬 사본을 다룹니다.'
        : '모든 데이터(MCP, 전략, 벤치마크, 평가 이력)는 이 브라우저의 localStorage에 저장됩니다. JSON 파일로 백업/복원할 수 있습니다.'),
    el('div', { class: 'row wrap' },
      el('button', {
        class: 'btn', onclick: () => {
          downloadJSON(store.export(), `rail-brain-backup-${new Date().toISOString().slice(0, 10)}.json`);
          toast('백업 파일이 다운로드되었습니다.', 'success');
        },
      }, '⬇ 데이터 내보내기'),
      el('button', {
        class: 'btn', onclick: () => {
          downloadJSON(store.export({ includeAccounts: true }), `rail-brain-backup-full-${new Date().toISOString().slice(0, 10)}.json`);
          toast('계정 포함 백업이 다운로드되었습니다. 파일을 안전하게 보관하세요.', 'warn');
        },
      }, '⬇ 내보내기 (계정 포함)'),
      el('button', {
        class: 'btn', onclick: async () => {
          try {
            const data = await pickJSONFile();
            if (!data) return;
            const accCount = Array.isArray(data.accounts) ? data.accounts.length : 0;
            let includeAccounts = false;
            if (accCount > 0) {
              const existing = auth.listAccounts().length;
              includeAccounts = await confirmDialog(
                `백업에 계정 ${accCount}개가 포함되어 있습니다. 기존 계정 ${existing}개를 이 계정들로 교체할까요? (취소하면 계정은 제외하고 나머지 데이터만 가져옵니다)`,
                { title: '계정 포함 여부', danger: true, okLabel: '계정 교체' });
            }
            if (!await confirmDialog('가져온 데이터로 현재 데이터를 덮어씁니다. 계속할까요?')) return;
            const result = store.import(data, { includeAccounts });
            const parts = [];
            if (result.applied.length) parts.push(`복원 ${result.applied.length}개(${result.applied.join(', ')})`);
            if (result.accountsIncluded) parts.push('계정 포함');
            if (result.skipped.length) parts.push(`건너뜀 ${result.skipped.length}개(${result.skipped.join(', ')})`);
            const summary = parts.length ? parts.join(' · ') : '반영된 항목이 없습니다';
            toast(`${summary}. 새로고침합니다.`, result.skipped.length ? 'warn' : 'success');
            setTimeout(() => location.reload(), 900);
          } catch (e) { toast(e.message, 'error'); }
        },
      }, '⬆ 데이터 가져오기'),
      el('button', {
        class: 'btn btn-amber', onclick: async () => {
          if (!await confirmDialog('샘플 MCP 100개를 다시 시드합니다. 사용자가 만든 MCP는 유지됩니다. 계속할까요?', { danger: false })) return;
          store.update('mcps', (mcps = []) => {
            const userMade = mcps.filter(m => !m.isSample);
            return [...SAMPLE_MCPS, ...userMade];
          });
          toast('샘플 MCP가 복원되었습니다.', 'success');
        },
      }, '♻ 샘플 MCP 복원'),
      el('button', {
        class: 'btn btn-danger', onclick: async () => {
          if (!await confirmDialog('모든 데이터(MCP/전략/벤치마크/평가 이력)를 초기화합니다. 계정은 유지됩니다. 계속할까요?')) return;
          store.reset({ keepAccounts: true });
          toast('초기화되었습니다. 새로고침합니다.', 'success');
          setTimeout(() => location.reload(), 800);
        },
      }, '⚠ 전체 초기화')),
    el('p', { class: 'hint', style: { marginTop: '12px', color: 'var(--sig-amber, #e0a326)' } },
      '⚠ "내보내기 (계정 포함)"은 비밀번호 해시가 담긴 계정 정보를 파일에 포함합니다. 파일이 유출되면 오프라인 대입 공격에 노출될 수 있으니 안전한 곳에만 보관하세요.'));

  /* ---------- 레이아웃 ---------- */
  const rows = [el('div', { class: 'grid cols-2' }, connCard, gatewayCard)];
  if (!serverMode) rows.push(el('div', { style: { marginTop: '16px' } }, accountCard));
  if (isServerAdmin) rows.push(el('div', { style: { marginTop: '16px' } }, adminCard));
  rows.push(el('div', { style: { marginTop: '16px' } }, dataCard));
  container.replaceChildren(...rows);

  testConn();
  if (serverMode) testGwHealth();
}
