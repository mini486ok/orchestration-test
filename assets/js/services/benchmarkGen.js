// LLM 자동 벤치마크 생성 — 항목을 한 번에 하나씩 생성·검증·정규화
// (소형 로컬 모델 신뢰성을 위해 배치 생성 대신 1개씩 루프 + 폐기/재시도)
import { chatJSON } from './ollama.js';
import { uuid } from '../core/ui.js';

const DIFFICULTIES = ['easy', 'medium', 'hard'];

const DIFFICULTY_GUIDE = {
  easy: '도구 1개(1단계)로 끝나는 단순 조회',
  medium: '서로 다른 도구 2~3단계를 순서대로 조합',
  hard: '3~4단계의 복합 워크플로우(여러 정보를 종합하거나 조건부 처리)',
};

function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** count개에 걸쳐 난이도 균형 배치. 특정 난이도 지정 시 전부 그 난이도 */
function buildDifficultyPlan(count, difficulty) {
  if (DIFFICULTIES.includes(difficulty)) return Array(count).fill(difficulty);
  const plan = [];
  for (let i = 0; i < count; i++) plan.push(DIFFICULTIES[i % 3]);
  return shuffle(plan);
}

/** 중심 서버들의 도구 카탈로그 텍스트(토큰 절약형) */
function buildCatalog(servers) {
  return servers.map(s => {
    const tools = (s.tools || []).map(t => {
      const props = t.inputSchema?.properties || {};
      const required = new Set(t.inputSchema?.required || []);
      const keys = Object.keys(props);
      const paramStr = keys.length
        ? keys.map(k => {
            const p = props[k] || {};
            const typ = Array.isArray(p.enum) && p.enum.length
              ? p.enum.map(String).join('|')
              : (p.type || 'any');
            return `${k}${required.has(k) ? '*' : ''}:${typ}`;
          }).join(', ')
        : '없음';
      return `    · ${t.name} — ${t.description || ''} [params: ${paramStr}]`;
    }).join('\n');
    return `■ server="${s.id}"  (${s.nameKo || s.name} · ${s.category || '기타'})\n${tools}`;
  }).join('\n\n');
}

function systemPrompt() {
  return [
    '당신은 철도·교통 분야 MCP 오케스트레이션 성능을 평가하기 위한 벤치마크 항목을 설계하는 전문가입니다.',
    '주어진 MCP 서버·도구 카탈로그만 사용하여, 현실적인 한국어 사용자 질의 1개와 그 질의를 해결하는 정답 도구 호출 시퀀스를 만듭니다.',
    '',
    '반드시 지킬 규칙:',
    '1) query 는 실제 사용자가 물을 법한 자연스러운 한국어 문장(최소 10자 이상).',
    '2) workflow 는 1~4단계. 각 단계의 server 와 tool 은 카탈로그에 실재하는 값만 사용하고 절대 지어내지 마세요.',
    '3) 각 단계 params 의 키는 해당 도구의 파라미터 이름과 정확히 일치해야 하며, 값은 query 내용과 자연스럽게 연결되어야 합니다.',
    '4) 여러 단계일 때는 앞 단계 결과를 이어받아 다음 단계로 진행하는 논리적 순서로 구성합니다.',
    '5) 출력은 아래 JSON 하나만. 코드블록·설명·주석 없이 JSON만 출력합니다.',
    '',
    'JSON 형식:',
    '{"query": string, "workflow": [{"server": string, "tool": string, "params": object}], "difficulty": "easy"|"medium"|"hard", "category": string}',
  ].join('\n');
}

function userPrompt({ catalog, diff, focusServers, categories, recentQueries }) {
  const lines = [
    '# 사용 가능한 MCP 도구 카탈로그',
    catalog,
    '',
    '# 이번 항목 생성 조건',
    `- 난이도: ${diff} (${DIFFICULTY_GUIDE[diff]})`,
    `- 이번 항목은 다음 서버들을 중심으로 구성하세요: ${focusServers.map(s => `"${s.id}"`).join(', ')}`,
  ];
  if (categories?.length) lines.push(`- category 값은 가능하면 다음 중에서 선택: ${categories.join(', ')}`);
  if (recentQueries.length) {
    lines.push('- 아래는 이미 생성된 질의입니다. 주제·표현이 겹치지 않도록 새로운 상황으로 작성하세요(중복 금지):');
    lines.push(recentQueries.map(q => `  · ${q}`).join('\n'));
  }
  lines.push('', '위 조건에 맞춰 JSON 하나만 출력하세요.');
  return lines.join('\n');
}

/**
 * 생성 결과 검증·정규화. 유효하지 않으면 null 반환(→ 호출측이 폐기 처리)
 * - workflow 의 server/tool 이 실재하지 않으면 폐기
 * - params 는 해당 도구 inputSchema 의 키만 남김
 * - query 10자 미만이면 폐기, difficulty 정규화
 */
function normalizeItem(raw, byId, diffHint) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  if (query.length < 10) return null;

  const wf = Array.isArray(raw.workflow) ? raw.workflow : [];
  if (wf.length < 1 || wf.length > 4) return null;

  const expected = [];
  for (const step of wf) {
    if (!step || typeof step !== 'object') return null;
    const server = byId.get(step.server);
    if (!server) return null; // 존재하지 않는 서버 → 폐기
    const tool = (server.tools || []).find(t => t.name === step.tool);
    if (!tool) return null;   // 존재하지 않는 도구 → 폐기
    const props = tool.inputSchema?.properties || {};
    const params = {};
    if (step.params && typeof step.params === 'object' && !Array.isArray(step.params)) {
      for (const [k, v] of Object.entries(step.params)) {
        if (Object.prototype.hasOwnProperty.call(props, k) && v !== undefined && v !== null) params[k] = v;
      }
    }
    expected.push({ serverId: server.id, toolName: tool.name, params });
  }

  // difficulty 는 워크플로우 길이와 정합화(1단계=easy, 2~3=medium, 4+=hard) — LLM 라벨과 다르면 보정값 채택
  const difficulty = expected.length <= 1 ? 'easy' : expected.length <= 3 ? 'medium' : 'hard';
  const category = typeof raw.category === 'string' ? raw.category.trim() : '';
  return { id: uuid(), query, expected, category, difficulty, source: 'auto', notes: '' };
}

/**
 * 벤치마크 항목 자동 생성
 * @param {Object} p
 * @param {Array}  p.mcps        등록된 MCP 서버 목록
 * @param {number} p.count       생성 개수(1~30)
 * @param {string} [p.model]     LLM 모델(미지정 시 기본 모델)
 * @param {string[]} [p.categories] 카테고리 필터(비우면 전체)
 * @param {string} [p.difficulty]   'auto'|'easy'|'medium'|'hard'
 * @param {(p:{done,total,lastItem})=>void} [p.onProgress]
 * @param {AbortSignal} [p.signal]
 * @returns {Promise<{items: Object[], failures: number, cancelled: boolean}>}
 */
export async function generateBenchmarkItems({
  mcps = [], count = 5, model, categories = [], difficulty = 'auto', onProgress, signal,
} = {}) {
  const items = [];
  let failures = 0;

  const total = Math.max(1, Math.min(30, (count | 0) || 1));
  const byId = new Map(mcps.map(m => [m.id, m]));

  // 서버 풀: 카테고리 필터(결과가 비면 전체로 폴백)
  let pool = mcps;
  if (categories?.length) {
    const filtered = mcps.filter(m => categories.includes(m.category));
    if (filtered.length) pool = filtered;
  }
  if (!pool.length) return { items, failures, cancelled: !!signal?.aborted };

  const plan = buildDifficultyPlan(total, difficulty);
  const sys = systemPrompt();

  // focus 서버는 커버리지 추적 라운드로빈으로 선택(생성 세션 내 미사용/최소사용 서버 우선, 동률은 랜덤)
  const usage = new Map(pool.map(s => [s.id, 0]));
  const pickFocus = (k) => {
    const chosen = shuffle(pool).sort((a, b) => usage.get(a.id) - usage.get(b.id)).slice(0, k);
    for (const s of chosen) usage.set(s.id, usage.get(s.id) + 1);
    return chosen;
  };

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) break;
    const diff = plan[i];

    let item = null;
    // 항목당 최대 3회 시도(최초 + 재시도 2회). 폐기될 때마다 failures 증가.
    for (let attempt = 0; attempt < 3 && !item; attempt++) {
      if (signal?.aborted) break;

      const k = Math.min(pool.length, 2 + Math.floor(Math.random() * 2)); // 2~3개
      const focus = pickFocus(k);
      const catalog = buildCatalog(focus);
      const recent = items.slice(-12).map(it => it.query);
      const messages = [
        { role: 'system', content: sys },
        { role: 'user', content: userPrompt({ catalog, diff, focusServers: focus, categories, recentQueries: recent }) },
      ];

      try {
        const { data } = await chatJSON({ model, messages, temperature: 0.7, signal });
        item = normalizeItem(data, byId, diff);
        if (!item) failures++;
      } catch (e) {
        if (signal?.aborted) break;
        failures++;
      }
    }

    if (item) {
      items.push(item);
      onProgress?.({ done: items.length, total, lastItem: item });
    }
  }

  return { items, failures, cancelled: !!signal?.aborted };
}
