// 설정 — Ollama 연결/모델, 계정 관리, 데이터 백업·복원·초기화
import { store } from '../core/store.js';
import { auth } from '../core/auth.js';
import { el, toast, field, badge, confirmDialog, modal, downloadJSON, pickJSONFile, fmt, spinner } from '../core/ui.js';
import { checkConnection, listModels } from '../services/ollama.js';
import { SAMPLE_MCPS } from '../data/sampleMcps.js';

const DEFAULT_SETTINGS = {
  ollamaUrl: 'http://localhost:11434',
  defaultModel: 'exaone3.5:7.8b',
  temperature: 0.2,
  maxSteps: 6,
  numCtx: 8192,
};

export async function render(container) {
  // settings가 손상되었거나 객체가 아니면 기본값으로 재시드 후 진행
  let settings = store.get('settings');
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    settings = { ...DEFAULT_SETTINGS };
    store.set('settings', settings);
  }

  /* ---------- Ollama 연결 ---------- */
  const urlInput = el('input', { class: 'input mono-input', value: settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl });
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

  // settings 객체를 안전하게 병합 저장하는 헬퍼
  const patchSettings = (patch) =>
    store.update('settings', s => ({ ...((s && typeof s === 'object' && !Array.isArray(s)) ? s : {}), ...patch }));

  // 고급: 컨텍스트 길이(num_ctx)
  const CTX_VALUES = [4096, 8192, 16384, 32768];
  const curCtx = Number(settings.numCtx) > 0 ? Number(settings.numCtx) : 8192;
  const ctxSelect = el('select', {
    class: 'select',
    onchange: () => {
      const v = Number(ctxSelect.value) > 0 ? Number(ctxSelect.value) : 8192;
      patchSettings({ numCtx: v });
      toast(`컨텍스트 길이가 ${v.toLocaleString()} 토큰으로 설정되었습니다.`, 'success');
    },
  }, CTX_VALUES.map(v => el('option', { value: String(v), selected: v === curCtx }, `${v.toLocaleString()} 토큰`)));

  const connCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, 'Ollama LLM 연결'),
    field({
      label: 'Ollama 서버 주소', input: urlInput,
      hint: '기본값 http://localhost:11434 — 이 컴퓨터에 설치된 Ollama를 사용합니다. GitHub Pages에서 접속하는 경우 OLLAMA_ORIGINS 설정이 필요합니다(가이드 참조).',
    }),
    el('div', { class: 'row', style: { marginBottom: '14px' } },
      el('button', {
        class: 'btn', onclick: () => {
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
      hint: 'LLM이 한 번에 처리하는 토큰 수(num_ctx). 값이 클수록 더 긴 문맥을 다루지만 메모리를 더 사용합니다. 기본 8192.',
    }));

  /* ---------- 계정 관리 ---------- */
  const isAdmin = auth.isAdmin();
  const accListWrap = el('div', {});

  function renderAccounts() {
    const accounts = auth.listAccounts();
    accListWrap.replaceChildren(
      el('div', { class: 'tbl-wrap' },
        el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, '아이디'), el('th', {}, '역할'), el('th', {}, '생성일'), isAdmin ? el('th', {}, '') : null)),
          el('tbody', {}, accounts.map(a => el('tr', {},
            el('td', {}, a.username),
            el('td', {}, badge(a.role === 'admin' ? '관리자' : '사용자', a.role === 'admin' ? 'green' : 'dim')),
            el('td', {}, fmt.date(a.createdAt)),
            isAdmin ? el('td', { style: { textAlign: 'right' } },
              el('button', {
                class: 'btn btn-sm btn-danger', onclick: async () => {
                  if (!await confirmDialog(`계정 '${a.username}' 을(를) 삭제할까요?`)) return;
                  try { auth.removeAccount(a.username); toast('계정이 삭제되었습니다.', 'success'); renderAccounts(); }
                  catch (e) { toast(e.message, 'error'); }
                },
              }, '삭제')) : null))))));
  }
  renderAccounts();

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

  function changePwModal() {
    const cur = el('input', { class: 'input', type: 'password', placeholder: '현재 비밀번호' });
    const nw = el('input', { class: 'input', type: 'password', placeholder: '새 비밀번호 (6자 이상)' });
    modal({
      title: '비밀번호 변경',
      body: el('div', {}, field({ label: '현재 비밀번호', input: cur }), field({ label: '새 비밀번호', input: nw })),
      actions: [
        { label: '취소', class: 'btn-ghost' },
        {
          label: '변경', class: 'btn-primary', onClick: async () => {
            try { await auth.changePassword(auth.session().username, cur.value, nw.value); toast('비밀번호가 변경되었습니다.', 'success'); }
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
      isAdmin ? el('button', { class: 'btn', onclick: addAccountModal }, '＋ 계정 추가') : null,
      el('button', { class: 'btn btn-ghost', onclick: changePwModal }, '내 비밀번호 변경')));

  /* ---------- 데이터 관리 ---------- */
  const dataCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, '데이터 백업 · 복원'),
    el('p', { class: 'hint', style: { marginBottom: '12px' } },
      '모든 데이터(MCP, 전략, 벤치마크, 평가 이력)는 이 브라우저의 localStorage에 저장됩니다. JSON 파일로 백업/복원할 수 있습니다.'),
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
          if (!await confirmDialog('샘플 MCP 30개를 다시 시드합니다. 사용자가 만든 MCP는 유지됩니다. 계속할까요?', { danger: false })) return;
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

  container.replaceChildren(
    el('div', { class: 'grid cols-2' }, connCard, accountCard),
    el('div', { style: { marginTop: '16px' } }, dataCard));

  testConn();
}
