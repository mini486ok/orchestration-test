// 대시보드 — 현황 요약, 시스템 상태, 최근 평가, 빠른 시작
import { store } from '../core/store.js';
import { router } from '../core/router.js';
import { el, badge, fmt } from '../core/ui.js';
import { checkConnection, listModels, getDefaultModel } from '../services/ollama.js';
import { donutChart } from '../core/charts.js';

export async function render(container) {
  const mcps = store.get('mcps') || [];
  const strategies = store.get('strategies') || [];
  const benchmarks = store.get('benchmarks') || [];
  const runs = store.get('runs') || [];
  const totalItems = benchmarks.reduce((s, b) => s + (b.items?.length || 0), 0);
  const totalTools = mcps.reduce((s, m) => s + (m.tools?.length || 0), 0);

  const kpi = (label, value, sub, foot, onclick) =>
    el('div', { class: 'card kpi hoverable', onclick },
      el('div', { class: 'kpi-label' }, label),
      el('div', { class: 'kpi-value' }, String(value), sub ? el('small', {}, ' ' + sub) : null),
      foot ? el('div', { class: 'kpi-foot' }, foot) : null);

  // 시스템 상태 카드 (비동기 채움)
  const sysBody = el('div', { class: 'stack' },
    el('div', { class: 'row' }, el('div', { class: 'spin' }), el('span', { style: { color: 'var(--tx2)' } }, 'Ollama 상태 확인 중…')));
  const sysCard = el('div', { class: 'card' },
    el('div', { class: 'panel-title' }, '시스템 상태'),
    sysBody);

  (async () => {
    const conn = await checkConnection();
    const rows = [];
    rows.push(el('div', { class: 'row between' },
      el('span', { style: { color: 'var(--tx2)', fontSize: '12.5px' } }, 'Ollama 서버'),
      conn.ok ? badge(`연결됨 v${conn.version}`, 'green') : badge('미연결', 'red')));
    if (conn.ok) {
      try {
        const models = await listModels();
        rows.push(el('div', { class: 'row between' },
          el('span', { style: { color: 'var(--tx2)', fontSize: '12.5px' } }, '설치된 모델'),
          el('span', { class: 'mono', style: { fontSize: '12px' } }, `${models.length}개`)));
        rows.push(el('div', { class: 'row between' },
          el('span', { style: { color: 'var(--tx2)', fontSize: '12.5px' } }, '기본 모델'),
          badge(getDefaultModel(), 'blue')));
      } catch { /* 모델 목록 실패는 무시 */ }
    } else {
      rows.push(el('div', { style: { fontSize: '12px', color: 'var(--tx2)', lineHeight: 1.6 } },
        '연결 실패: ' + (conn.error || '알 수 없음') + ' — ',
        el('a', { href: '#/guide' }, 'Ollama 연결 가이드 보기')));
    }
    sysBody.replaceChildren(...rows);
  })();

  // 카테고리 분포 도넛
  const catCount = {};
  for (const m of mcps) catCount[m.category] = (catCount[m.category] || 0) + 1;
  const catItems = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([label, value]) => ({ label, value }));

  // 최근 평가 실행
  const recentRuns = runs.slice(0, 5);
  const runsBody = recentRuns.length
    ? el('div', { class: 'stack' }, recentRuns.map(r =>
        el('div', {
          class: 'list-item', onclick: () => router.navigate(`/evaluation/${r.id}`),
          style: { border: '1px solid var(--line-soft)' },
        },
          el('div', { class: 'li-name' }, '🏁 ', r.name || r.benchmarkSetName,
            el('span', { class: 'badge dim', style: { marginLeft: 'auto' } }, r.status === 'done' ? '완료' : r.status)),
          el('div', { class: 'li-sub' }, `${fmt.date(r.createdAt)} · 전략 ${r.strategyIds?.length || 0}개`))))
    : el('div', { class: 'hint', style: { color: 'var(--tx3)', fontSize: '12.5px' } }, '아직 평가 실행 기록이 없습니다.');

  container.replaceChildren(
    el('div', { class: 'dash-hero' },
      el('div', {},
        el('h2', {}, '철도·교통 MCP 오케스트레이션 테스트 랩'),
        el('p', {}, '테스트용 MCP 서버를 등록하고, 프롬프트·스킬·룰 기반 오케스트레이션 전략을 설계한 뒤, 벤치마크로 성능을 검증·비교하세요.'),
        el('div', { class: 'quick-actions' },
          el('button', { class: 'btn btn-primary', onclick: () => router.navigate('/mcps/new') }, '＋ MCP 서버 만들기'),
          el('button', { class: 'btn', onclick: () => router.navigate('/orchestration') }, '🧠 전략 설계'),
          el('button', { class: 'btn', onclick: () => router.navigate('/benchmarks') }, '📏 벤치마크 생성'),
          el('button', { class: 'btn', onclick: () => router.navigate('/evaluation') }, '🏁 평가 실행')))),

    el('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
      kpi('MCP 서버', mcps.length, `· 도구 ${totalTools}개`, '카탈로그에서 조회/관리', () => router.navigate('/mcps')),
      kpi('오케스트레이션 전략', strategies.length, null, '프롬프트 · 스킬 · 룰 기반', () => router.navigate('/orchestration')),
      kpi('벤치마크 항목', totalItems, `· ${benchmarks.length}세트`, '자동(LLM) + 수동 생성', () => router.navigate('/benchmarks')),
      kpi('평가 실행', runs.length, null, '전략 성능 비교·시각화', () => router.navigate('/evaluation'))),

    el('div', { class: 'grid cols-3' },
      sysCard,
      el('div', { class: 'card' },
        el('div', { class: 'panel-title' }, 'MCP 카테고리 분포'),
        catItems.length ? donutChart(catItems, { centerLabel: `${mcps.length}개` })
          : el('div', { class: 'hint', style: { color: 'var(--tx3)' } }, '등록된 MCP가 없습니다.')),
      el('div', { class: 'card' },
        el('div', { class: 'panel-title' }, '최근 평가 실행'),
        runsBody)));
}
