// 전략 실행 엔진 — prompt(plan/react) · skill · rule 3종
// 모든 LLM 호출은 ollama.chatJSON(JSON 텍스트 파싱), 모든 도구 실행은 mockEngine 경유.
// executeStrategy는 절대 throw하지 않고 항상 ExecutionResult를 반환한다.
import { chatJSON, getDefaultModel, getNumCtx } from './ollama.js';
import { executeTool, validateParams } from './mockEngine.js';
import { retrieve } from './catalogIndex.js';
// r7: retrieveMulti는 catalogIndex(F2)가 병렬 구현 — 부재 시 multiQuery를 조용히 무시하기 위해 네임스페이스로도 참조.
import * as catalogIndexApi from './catalogIndex.js';
import { store } from '../core/store.js';
import { graphRetrieve, graphStatus, recommendPaths, GRAPH_KEY } from './catalogGraph.js';

/* ============================================================
   기본 프롬프트
   ============================================================ */

/** 기본 플래너 시스템 프롬프트 (plan 모드 기준). {{TOOL_CATALOG}}/{{QUERY}}/{{DATE}} 치환 */
export const DEFAULT_PLANNER_PROMPT =
`당신은 철도·교통 분야 MCP 오케스트레이션 플래너입니다.
사용자 질의를 해결하기 위해, 아래 "사용 가능한 도구" 목록에 있는 도구만 사용하여 실행 계획을 세웁니다.

# 사용 가능한 도구
{{TOOL_CATALOG}}

# 규칙
- 위 목록에 존재하는 server/tool 조합만 사용하세요. 목록에 없는 도구는 절대 만들지 마세요.
- 각 단계의 params는 도구 파라미터 명세(이름·타입·필수 여부·허용값)에 맞게, 값은 질의에서 직접 추출해 채우세요.
- 앞 단계의 출력을 뒤 단계 params에 써야 하면 {{step1.output.필드}} 형식으로 참조하세요(step 번호는 1부터).
- 질의 해결에 꼭 필요한 최소한의 단계만 사용하세요.
- 오늘 날짜는 {{DATE}} 입니다. "내일/모레/이번 주말" 같은 표현은 이 값을 기준으로 계산하세요.

# 응답 형식
{"plan": [{"server": "서버id", "tool": "도구명", "params": { }}], "reasoning": "선택 근거(한 문장)"}

# 예시
질의: "내일 아침 서울에서 부산 가는 KTX 알려줘"
응답: {"plan":[{"server":"kr-train-schedule","tool":"search_trains","params":{"from":"서울","to":"부산","trainType":"KTX"}}],"reasoning":"열차 시간표 조회 도구로 서울→부산 KTX 편성을 검색"}
질의: "모레 서울에서 동대구 가는 KTX 예매하려는데 자리 있는지 봐줘"
응답: {"plan":[{"server":"kr-train-schedule","tool":"search_trains","params":{"from":"서울","to":"동대구","trainType":"KTX"}},{"server":"rail-reservation","tool":"check_seat_availability","params":{"trainNo":"{{step1.output.trains.0.trainNo}}","date":"{{DATE}}"}}],"reasoning":"편성을 먼저 검색하고 첫 열차 번호로 잔여석을 확인하는 2단계 흐름"}

# 사용자 질의
{{QUERY}}

반드시 위 "응답 형식"의 JSON 하나만 출력하세요. 설명 문장·코드블록(\`\`\`)·주석은 금지합니다.`;

/** ReAct 모드에서 시스템 프롬프트 뒤에 덧붙는 응답 형식 계약 */
const REACT_ADDENDUM =
`# 진행 방식: ReAct (한 번에 한 단계)
지금부터는 위의 'plan' 일괄 형식 대신, 한 번에 한 단계씩 사고(thought)와 행동(action)을 반복합니다.
매 턴마다 아래 두 가지 중 하나의 JSON만 출력하세요.
- 도구를 실행하려면: {"thought": "무엇을 왜 할지", "action": {"server": "서버id", "tool": "도구명", "params": { }}}
- 정보가 충분해 최종 답변이 가능하면: {"thought": "요약", "final_answer": "사용자에게 줄 최종 답변"}
직전 행동의 실행 결과는 다음 사용자 메시지에 "관찰(observation)"로 제공됩니다. 관찰을 반영해 다음 단계를 결정하세요.
설명 문장이나 코드블록 없이 JSON 하나만 출력합니다.`;

/** 스킬 선택 라우터 기본 프롬프트 */
export const DEFAULT_SKILL_SELECTOR_PROMPT =
`당신은 사용자 질의에 가장 적합한 "스킬(정형화된 작업 절차)"을 고르는 라우터입니다.
아래 스킬 목록의 트리거와 설명을 참고하여, 질의를 가장 잘 처리할 스킬 하나를 선택하세요.
적합한 스킬이 하나도 없으면 skill 값으로 "none"을 반환하세요.
반드시 {"skill": "스킬id 또는 none", "reason": "선택 근거(한 문장)"} 형식의 JSON 하나만 출력합니다.`;

/* ============================================================
   도구 카탈로그
   ============================================================ */

function describeParam(name, prop = {}, required = false, withExamples = false) {
  let t = prop.type || 'any';
  if (prop.type === 'array') t = `array<${prop.items?.type || 'any'}>`;
  let s = `${name}:${t}`;
  if (required) s += '*';
  if (Array.isArray(prop.enum) && prop.enum.length) s += `(${prop.enum.map(String).join('|')})`;
  // r6: examples 필드가 켜진 경우(L0 전용) 첫 예시값을 '=예:값'으로 덧붙임(30자 절단)
  // r7: 예시값이 객체/배열이면 '[object Object]' 대신 JSON 직렬화 후 절단
  if (withExamples && Array.isArray(prop.examples) && prop.examples.length && prop.examples[0] != null) {
    const ex = prop.examples[0];
    let exStr;
    if (typeof ex === 'object') { try { exStr = JSON.stringify(ex); } catch { exStr = String(ex); } }
    else exStr = String(ex);
    s += `=예:${clip(exStr, 30)}`;
  }
  return s;
}

/**
 * 카탈로그 구성 요소 기본값(r6) — desc: 서버·도구 설명 / params: 입력 파라미터(타입·필수·enum) /
 * outputs: 도구별 출력 스키마 키 / examples: 파라미터 예시값.
 * 기본값으로 호출하면 buildToolCatalog 계열의 출력은 이전(r5)과 완전 동일하다(회귀 0).
 */
export const DEFAULT_CATALOG_FIELDS = Object.freeze({ desc: true, params: true, outputs: false, examples: false });

/** fields 부분 지정을 기본값으로 back-fill(순수 함수 — 인자 원본은 변경하지 않음) */
function normalizeCatalogFields(fields) {
  return { ...DEFAULT_CATALOG_FIELDS, ...(fields || {}) };
}

/**
 * outputs 표기용 키 목록 — outputSchema 최상위 properties 키 + array 항목의 1단계 properties 키('부모[].자식'),
 * 최대 10개 초과분은 '…'로 축약. 스키마가 없거나 키가 없으면 빈 문자열(표기 생략).
 */
function outputKeys(tool) {
  const props = tool?.outputSchema?.properties;
  if (!props || typeof props !== 'object') return '';
  const keys = [];
  for (const [k, v] of Object.entries(props)) {
    keys.push(k);
    const itemProps = v?.type === 'array' ? v?.items?.properties : null;
    if (itemProps && typeof itemProps === 'object') {
      for (const ik of Object.keys(itemProps)) keys.push(`${k}[].${ik}`);
    }
  }
  if (!keys.length) return '';
  return keys.slice(0, 10).join(', ') + (keys.length > 10 ? ', …' : '');
}

/**
 * 카탈로그 상단 표기 안내줄 — 켜진 fields와 레벨별 파라미터 표기 규칙에 맞춰 구성.
 * 기본 fields일 때 L0~L3 각각 기존(r5) 문구와 완전 동일한 줄을 생성한다.
 */
function catalogHeader(f, level = 0) {
  const parts = [];
  if (f.params) {
    if (level <= 1) {
      parts.push('도구명(파라미터명:타입)', '*=필수', '(a|b)=허용값');
      if (level === 0 && f.examples) parts.push('=예:값=예시값');
    } else if (level === 2) {
      parts.push('도구명(필수 파라미터:타입)', '(a|b)=허용값', '-=필수 파라미터 없음');
    } else {
      parts.push('도구명(필수 파라미터명)', '-=필수 파라미터 없음');
    }
  } else {
    parts.push('도구명');
  }
  if (f.outputs && level <= 1) parts.push('→ 출력:=출력 스키마 키');
  return `(표기: ${parts.join(' · ')})`;
}

/**
 * LLM 프롬프트용 도구 카탈로그 텍스트 (토큰 절약형)
 * @param {Array} mcps MCP 서버 배열
 * @param {{desc?:boolean, params?:boolean, outputs?:boolean, examples?:boolean}} [fields]
 *        포함 요소 선택(부분 지정 가능) — 미지정 시 DEFAULT_CATALOG_FIELDS(기존 출력과 완전 동일)
 */
export function buildToolCatalog(mcps = [], fields) {
  const f = normalizeCatalogFields(fields);
  const lines = [catalogHeader(f, 0)];
  for (const server of mcps || []) {
    if (!server || !server.tools || !server.tools.length) continue;
    const head = `[${server.id}] ${server.nameKo || server.name || ''}`;
    lines.push(f.desc && server.description ? `${head} — ${server.description}` : head);
    for (const tool of server.tools) {
      let line = `  - ${tool.name}`;
      if (f.params) {
        const props = tool.inputSchema?.properties || {};
        const req = new Set(tool.inputSchema?.required || []);
        const params = Object.entries(props).map(([n, p]) => describeParam(n, p, req.has(n), f.examples)).join(', ');
        line += `(${params || '파라미터 없음'})`;
      }
      if (f.desc) line += `: ${tool.description || ''}`;
      if (f.outputs) {
        const outs = outputKeys(tool);
        if (outs) line += ` → 출력: ${outs}`;
      }
      lines.push(line);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '(등록된 도구가 없습니다)';
}

/**
 * 전체 카탈로그 프롬프트 텍스트의 추정 토큰 수 — buildToolCatalog 재사용, LLM 호출 없음(순수 함수).
 * 한글 혼합 텍스트 기준 chars/2.2 근사(llmJSON의 컨텍스트 예산 추정과 동일 기준). 평가 preflight용.
 * @param {Array} mcps MCP 서버 배열
 * @param {object} [fields] 카탈로그 구성 요소 선택 — 미지정 시 기본값(기존 결과와 동일)
 * @returns {number} 추정 토큰 수
 */
export function estimateCatalogTokens(mcps, fields) {
  return Math.round(buildToolCatalog(mcps, fields).length / 2.2);
}

/* ------------------------------------------------------------
   카탈로그 자동 축약 — 예산 초과 시 서버·도구를 하나도 빼지 않고
   상세도만 단계적으로 낮춰(L1~L4) 예산 안에 넣는다(무음 절단 제거).
   예산 이내면 L0 = 기존 buildToolCatalog와 완전 동일 출력(회귀 0).
   ------------------------------------------------------------ */

/** 축약 카탈로그 상단 안내 1줄(L1~L4 공통 — 레벨별 동일 문구로 토큰 부담 최소화) */
const CATALOG_COMPRESS_NOTICE =
  '(주의: 컨텍스트 예산에 맞춰 카탈로그가 축약됨 — 파라미터 상세는 도구 실행 결과/오류를 참고)';

/** n자 초과 시 절단 + '…' (카탈로그 축약 전용 — truncate()와 달리 총 길이 표기를 붙이지 않음) */
function clip(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** L1~L2용 파라미터 표기 — describeParam과 동일하되 enum 값을 4개까지만 표기(초과분 '|…').
 *  examples는 L1부터 제외되므로(축약 우선순위) 이 함수는 예시값을 표기하지 않는다. */
function describeParamClipped(name, prop = {}, required = false) {
  let t = prop.type || 'any';
  if (prop.type === 'array') t = `array<${prop.items?.type || 'any'}>`;
  let s = `${name}:${t}`;
  if (required) s += '*';
  if (Array.isArray(prop.enum) && prop.enum.length) {
    s += `(${prop.enum.slice(0, 4).map(String).join('|')}${prop.enum.length > 4 ? '|…' : ''})`;
  }
  return s;
}

/**
 * 레벨별 축약 카탈로그 생성(내부). 모든 레벨에서 서버·도구는 하나도 빠지지 않는다.
 * 켜진 fields(r6) 위에서 상세도만 하향한다 — 기본 fields면 각 레벨 출력이 r5와 완전 동일.
 * - L0: 현행 buildToolCatalog 그대로(출력 동일 보장 — 기존 함수 재사용, fields 반영)
 * - L1: examples 제외 + 서버 설명 60자·도구 설명 80자 절단, enum 값 4개까지 (outputs는 유지)
 * - L2: L1 + outputs 제외 + 선택(비필수) 파라미터 제외('*' 표기 불필요), 서버 설명 제거(head만)
 * - L3: L2 + 파라미터는 필수 이름만(타입·enum 제거), 도구 설명 30자 절단
 * - L4: 서버당 1줄 — `[id] 서버명: tool1, tool2, …` (설명·파라미터 없음, 헤더 표기줄도 최소화, fields 무관 최소형)
 */
function buildCatalogAtLevel(mcps = [], level = 0, fields) {
  const f = normalizeCatalogFields(fields);
  if (level <= 0) return buildToolCatalog(mcps, f);

  if (level >= 4) {
    const lines = [CATALOG_COMPRESS_NOTICE, '(표기: [서버id] 서버명: 도구명 목록)'];
    for (const server of mcps || []) {
      if (!server || !server.tools || !server.tools.length) continue;
      lines.push(`[${server.id}] ${server.nameKo || server.name || ''}: ${server.tools.map(t => t.name).join(', ')}`);
    }
    return lines.length > 2 ? lines.join('\n') : '(등록된 도구가 없습니다)';
  }

  // 축약 우선순위(r6): L1부터 examples 소멸(describeParamClipped가 미표기), L2부터 outputs 소멸
  const showOutputs = f.outputs && level === 1;
  // L1~L3 헤더: 켜진 fields와 레벨별 실제 표기 규칙만 안내(기본 fields면 r5 문구와 동일)
  const lines = [CATALOG_COMPRESS_NOTICE, catalogHeader(f, level)];
  const toolDescMax = level >= 3 ? 30 : 80; // 도구 설명: L1~L2 80자 · L3 30자
  for (const server of mcps || []) {
    if (!server || !server.tools || !server.tools.length) continue;
    const head = `[${server.id}] ${server.nameKo || server.name || ''}`;
    // 서버 설명: L1 60자 절단 · L2~L3 제거(head만) — desc 필드가 꺼져 있으면 항상 head만
    lines.push(f.desc && level === 1 && server.description ? `${head} — ${clip(server.description, 60)}` : head);
    for (const tool of server.tools) {
      let line = `  - ${tool.name}`;
      if (f.params) {
        const props = tool.inputSchema?.properties || {};
        const req = new Set(tool.inputSchema?.required || []);
        let entries = Object.entries(props);
        if (level >= 2) entries = entries.filter(([n]) => req.has(n)); // 선택(비필수) 파라미터 제외
        const params = entries
          .map(([n, p]) => (level >= 3 ? n : describeParamClipped(n, p, level === 1 && req.has(n))))
          .join(', ');
        // L2+는 전부 필수라 '*' 불필요, 필수 파라미터가 없으면 '파라미터 없음' 대신 '-'
        line += `(${params || (level >= 2 ? '-' : '파라미터 없음')})`;
      }
      if (f.desc) line += `: ${clip(tool.description || '', toolDescMax)}`;
      if (showOutputs) {
        const outs = outputKeys(tool);
        if (outs) line += ` → 출력: ${outs}`;
      }
      lines.push(line);
    }
  }
  return lines.length > 2 ? lines.join('\n') : '(등록된 도구가 없습니다)';
}

/**
 * 전체 카탈로그 주입 예산(추정 토큰) — numCtx에서 지시문·응답 여유분을 뺀 값.
 * react는 히스토리 누적·카탈로그 매턴 재전송을 감안해 여유분을 더 크게 잡는다.
 * r7: react 차감을 maxSteps에 비례시킴 — `min(floor(numCtx/2), 1536 + 450×clamp(maxSteps||6,1,20))`.
 *     기본 maxSteps=6이면 4236(≈현행 4096), 스텝이 많을수록 히스토리 여유분을 더 확보하되
 *     차감이 numCtx의 절반을 넘지 않도록 상한을 둔다. plan은 현행 2048 유지.
 * @param {number} numCtx Ollama num_ctx
 * @param {string} [planningMode] 'react'면 maxSteps 비례 차감, 그 외 2048 차감
 * @param {number} [maxSteps] react 최대 스텝 수(1~20으로 클램프, 미지정/비정상 시 6)
 * @returns {number} 추정 토큰 예산(최소 1500)
 */
export function catalogBudgetTokens(numCtx, planningMode, maxSteps) {
  const n = Number(numCtx) || 0;
  let reserve = 2048;
  if (planningMode === 'react') {
    const steps = Math.min(Math.max(Math.floor(Number(maxSteps)) || 6, 1), 20);
    reserve = Math.min(Math.floor(n / 2), 1536 + 450 * steps);
  }
  return Math.max(1500, n - reserve);
}

/**
 * 예산에 맞는 최소 축약 레벨(L0~L4)의 카탈로그 생성 — 서버·도구 전부 유지, 상세도만 하향.
 * 예산 이내면 L0(buildToolCatalog와 완전 동일 출력). L4도 초과면 L4 텍스트+level 4를 그대로
 * 반환한다(초과 여부는 기존 ctxOverflow 로직이 실행 시 감지).
 * @param {Array} mcps MCP 서버 배열
 * @param {number} budgetTokens 추정 토큰 예산(catalogBudgetTokens 결과)
 * @param {object} [fields] 카탈로그 구성 요소 선택 — 미지정 시 기본값(기존 결과와 동일)
 * @returns {{text:string, level:number, estTokens:number, fullEstTokens:number}}
 */
export function buildToolCatalogFitted(mcps = [], budgetTokens = Infinity, fields) {
  const est = (text) => Math.round(text.length / 2.2); // 기존 관례(estimateCatalogTokens)와 동일 근사
  const budget = Number.isFinite(Number(budgetTokens)) ? Number(budgetTokens) : Infinity;
  let text = buildToolCatalog(mcps, fields); // L0 — 기본 fields면 기존 함수 출력과 동일 보장
  const fullEstTokens = est(text);
  let estTokens = fullEstTokens;
  let level = 0;
  while (estTokens > budget && level < 4) {
    level += 1;
    text = buildCatalogAtLevel(mcps, level, fields);
    estTokens = est(text);
  }
  return { text, level, estTokens, fullEstTokens };
}

/**
 * r7: 전략이 "전체 도구 카탈로그"를 프롬프트에 주입할 수 있는지 판정(평가 preflight 분류용).
 * 유효 프롬프트 템플릿(커스텀 또는 기본)에 {{TOOL_CATALOG}}가 포함되고 전체 카탈로그가 주입될 수 있으면 true.
 * - prompt(full): 유효 systemPrompt에 {{TOOL_CATALOG}} 포함 시 true
 * - prompt(retrieval)/db: false (검색 축소 카탈로그 주입 — 검색 실패 시의 전체 폴백은 판정에서 제외)
 * - skill: 유효 셀렉터 템플릿에 {{TOOL_CATALOG}} 포함 시만 true (기본 셀렉터는 미포함 → false)
 * - rule: onNoMatch='llmFallback'이고 유효 폴백 템플릿에 {{TOOL_CATALOG}} 포함 시만 true
 * @param {object} strategy Strategy
 * @returns {boolean}
 */
export function usesFullCatalog(strategy) {
  const cfg = strategy?.config || {};
  const has = (tpl) => String(tpl || '').includes('{{TOOL_CATALOG}}');
  switch (strategy?.type) {
    case 'prompt':
      if (cfg.catalogMode === 'retrieval') return false;
      return has(cfg.systemPrompt || DEFAULT_PLANNER_PROMPT);
    case 'db':
      return false;
    case 'skill':
      return has(cfg.selectorPrompt || DEFAULT_SKILL_SELECTOR_PROMPT);
    case 'rule': {
      if ((cfg.onNoMatch || 'error') !== 'llmFallback') return false;
      // runRule과 동일한 유효 폴백 템플릿 규칙(빈 문자열/공백이면 기본 플래너 프롬프트)
      const prompt = (cfg.fallbackPrompt && cfg.fallbackPrompt.trim()) ? cfg.fallbackPrompt : DEFAULT_PLANNER_PROMPT;
      return has(prompt);
    }
    default:
      return false;
  }
}

/* ============================================================
   내부 유틸
   ============================================================ */

/**
 * mcps 전체 도구 수 — 전체 카탈로그 주입 시 suppliedToolCount 기록용.
 * r8: evaluator가 run.toolCount(실행 시점 전체 도구 수) 기록에 재사용하도록 export.
 */
export function countTools(mcps) {
  return (mcps || []).reduce((s, m) => s + ((m && Array.isArray(m.tools)) ? m.tools.length : 0), 0);
}

/** fields가 기본 구성(DEFAULT_CATALOG_FIELDS)과 동일한지 — 구성 안내 trace 생략 판단용(단일 참조) */
function isDefaultCatalogFields(fields) {
  return Object.keys(DEFAULT_CATALOG_FIELDS).every((k) => !!fields[k] === DEFAULT_CATALOG_FIELDS[k]);
}

function fillPrompt(tpl, { catalog, query, date }) {
  return String(tpl || '')
    .replaceAll('{{TOOL_CATALOG}}', catalog ?? '')
    .replaceAll('{{QUERY}}', query ?? '')
    .replaceAll('{{DATE}}', date ?? '');
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + `… (총 ${s.length}자)` : s;
}

function safeStringify(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function messagesPreview(messages) {
  return messages.map(m => `[${m.role}]\n${truncate(m.content, 500)}`).join('\n\n');
}

function clampSteps(n, def = 6) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(v, 20);
}

function abortError() {
  const e = new Error('사용자에 의해 중단됨');
  e.name = 'AbortError';
  return e;
}

/** 객체에서 점 경로 조회 (숫자 인덱스 지원) */
function getPath(obj, path) {
  const parts = String(path).split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const key = /^\d+$/.test(p) ? Number(p) : p;
    cur = cur[key];
  }
  return cur;
}

/* ============================================================
   실행 컨텍스트
   ============================================================ */

function createRunContext({ strategy, query, mcps, onTrace, signal }) {
  const cfg = strategy?.config || {};
  const date = new Date().toISOString().slice(0, 10);
  // r6: 카탈로그 구성 사용자 설정 — cfg.catalog.fields(포함 요소)·cfg.catalog.autoFit(자동 축약).
  // 설정이 없는 기존 전략은 기본값으로 back-fill되어 현행과 완전 동일하게 동작한다(회귀 0).
  const cat = cfg.catalog || {};
  const fields = normalizeCatalogFields(cat.fields); // r7: DEFAULT_CATALOG_FIELDS 단일 참조
  const autoFit = cat.autoFit !== false;
  const byId = new Map((mcps || []).map(m => [m.id, m]));
  const maxSteps = clampSteps(cfg.maxSteps, 6);
  // ctxOverflow: 카탈로그 프롬프트가 num_ctx를 초과(추정/실측)해 잘렸을 가능성 — 점수 신뢰도 판단용.
  // retrievalFallback: db 검색이 의도한 방식이 아닌 폴백으로 실행된 사유 문자열(없으면 null).
  // catalogDetail: 0=전체 상세(기존과 동일)·카탈로그 미주입 · 1~4=카탈로그 자동 축약 레벨(전체 주입 경로에만 의미).
  // r7 추가 — retrievedTools: db/retrieval 검색 성공 시 최종 후보 'serverId/toolName' 키 배열(전체 주입/폴백이면 null).
  //           suppliedToolCount: 플래너에 실제 공급된 도구 수(전체 주입이면 전체 도구 수, 카탈로그 미주입이면 null).
  // r8 확정 시점 — 검색 성공 값은 ctx.pendingRetrieval에 보관했다가 ctx.fillPrompt가 {{TOOL_CATALOG}}를
  //           실제 치환하는 시점에 result로 확정한다. 커스텀 프롬프트에 플레이스홀더가 없어 축소 카탈로그가
  //           끝내 주입되지 않으면 두 값 모두 null 유지(공급되지 않은 후보를 기록하지 않음).
  const result = { ok: true, steps: [], trace: [], llmCalls: 0, totalLatencyMs: 0, hasStepErrors: false, inputTokens: 0, outputTokens: 0, tokensEstimated: false, ctxOverflow: false, retrievalFallback: null, catalogDetail: 0, retrievedTools: null, suppliedToolCount: null };
  // react는 도구 오류를 관찰(observation)로 흘려보내 모델이 회복하도록 두므로 step 오류만으로 실패 처리하지 않는다.
  // prompt·db 모두 planningMode==='react'면 동일하게 처리(db도 프롬프트 실행 경로를 공유).
  const failOnStepError = !((strategy?.type === 'prompt' || strategy?.type === 'db') && cfg.planningMode === 'react');

  const emit = (type, label, detail) => {
    const ev = { ts: Date.now(), type, label: String(label) };
    if (detail !== undefined && detail !== null && detail !== '') {
      ev.detail = typeof detail === 'string' ? detail : safeStringify(detail);
    }
    result.trace.push(ev);
    try { onTrace && onTrace(ev); } catch { /* 콜백 오류는 무시 */ }
  };

  // ---- r7: 카탈로그 fitted 지연 계산(허위 축약 뱃지 제거) ----
  // 전체 카탈로그는 {{TOOL_CATALOG}}가 실제 치환되는 프롬프트가 실행될 때 최초 1회만 생성하고,
  // catalogDetail·'카탈로그 구성'·'카탈로그 자동 축약' trace도 그 시점에만 기록한다.
  // rule 매치 성공·기본 skill 셀렉터(카탈로그 미포함)는 계산도 기록도 하지 않는다(CPU 절약).
  let fitCache = null;
  const computeFit = () => {
    if (fitCache) return fitCache;
    // autoFit=true(기본)면 numCtx 예산에 맞춰 축약(예산 이내면 L0=기존 buildToolCatalog와 바이트 단위 동일, 초과 시 L1~L4),
    // autoFit=false면 축약 없이 선택 fields 그대로 주입(예산 초과 시 절단 가능성은 기존 ctxOverflow 로직이 실행 중 감지).
    const numCtxForCatalog = getNumCtx();
    // r7: react면 maxSteps를 예산 차감에 반영(히스토리 누적 여유분 비례)
    const budget = catalogBudgetTokens(numCtxForCatalog, cfg.planningMode, maxSteps);
    const fit = autoFit
      ? buildToolCatalogFitted(mcps, budget, fields)
      : (() => { const text = buildToolCatalog(mcps, fields); const t = Math.round(text.length / 2.2); return { text, level: 0, estTokens: t, fullEstTokens: t }; })();
    fitCache = { ...fit, budget, numCtx: numCtxForCatalog };
    return fitCache;
  };
  let catalogMarked = false;
  /** 전체 카탈로그를 실제 주입하는 시점에 1회 기록: catalogDetail·구성/축약 trace·suppliedToolCount */
  const materializeFullCatalog = () => {
    const fit = computeFit();
    if (!catalogMarked) {
      catalogMarked = true;
      result.catalogDetail = fit.level;
      result.retrievedTools = null; // 전체 주입/폴백 — 검색 후보 아님
      result.suppliedToolCount = countTools(mcps);
      // r6: fields가 기본 구성과 다를 때만 구성 안내 trace 1건(기본이면 추가 없음 — 회귀 0)
      if (!isDefaultCatalogFields(fields)) {
        const on = ['desc', 'params', 'outputs', 'examples'].filter((k) => fields[k]).join('/');
        emit('info', `카탈로그 구성: ${on || '(없음)'} 포함 (desc/params/outputs/examples 중 사용자 선택)`);
      }
      // 축약이 적용된 경우에만 안내 trace 추가(레벨 0이면 기존과 동일하게 아무 것도 추가하지 않음 — 회귀 0)
      // autoFit=false 경로는 항상 level 0이므로 축약 trace가 남지 않는다.
      if (fit.level > 0) {
        emit('info', `카탈로그 자동 축약: 레벨 ${fit.level} (전체 ≈${fit.fullEstTokens.toLocaleString()}tok → ≈${fit.estTokens.toLocaleString()}tok, 예산 ≈${fit.budget.toLocaleString()}tok/numCtx ${fit.numCtx.toLocaleString()})`);
      }
    }
    return fit.text;
  };

  const ctx = {
    strategy, query, date, byId, result, emit, signal, failOnStepError,
    allMcps: mcps || [],
    // 검색(retrieval/db) 성공 시 축소 카탈로그 문자열로 채워진다. null이면 {{TOOL_CATALOG}} 치환 시점에
    // 전체 카탈로그를 지연 생성·주입한다(위 materializeFullCatalog).
    catalog: null,
    // r8: 검색 성공 시 {retrievedTools, suppliedToolCount} 보류분 — fillPrompt의 실제 치환 시점에 result로 확정.
    pendingRetrieval: null,
    model: strategy?.model || getDefaultModel(),
    temperature: Number.isFinite(cfg.temperature) ? cfg.temperature : 0.2,
    // 스킬 선택·파라미터 생성 등 내부 보조 호출용 온도: 명시 설정(온도 통일 포함)이 있으면 따르고, 없으면 안정성을 위해 0.1
    auxTemperature: Number.isFinite(cfg.temperature) ? cfg.temperature : 0.1,
    maxSteps,
    throwIfAborted() { if (signal?.aborted) throw abortError(); },
    fail(msg) { result.ok = false; result.error = msg; emit('error', msg); },
    /** r7: {{TOOL_CATALOG}} 포함 템플릿일 때만 카탈로그를 (지연) 생성·주입하는 템플릿 치환 */
    fillPrompt(tpl) {
      const t = String(tpl || '');
      const needsCatalog = t.includes('{{TOOL_CATALOG}}');
      let catalogText = '';
      if (needsCatalog) {
        if (ctx.catalog != null) {
          catalogText = ctx.catalog;
          // r8: 검색 축소 카탈로그가 실제로 프롬프트에 주입되는 시점에 기록 확정(pending→result).
          // 플레이스홀더가 없는 템플릿만 쓰이면 이 분기에 오지 않아 retrievedTools/suppliedToolCount는 null 유지.
          if (ctx.pendingRetrieval) {
            result.retrievedTools = ctx.pendingRetrieval.retrievedTools;
            result.suppliedToolCount = ctx.pendingRetrieval.suppliedToolCount;
            ctx.pendingRetrieval = null;
          }
        } else {
          catalogText = materializeFullCatalog();
        }
      }
      return fillPrompt(t, { catalog: catalogText, query, date });
    },
    filledSystemPrompt() {
      let sp = ctx.fillPrompt(cfg.systemPrompt || DEFAULT_PLANNER_PROMPT);
      if (cfg.planningMode === 'react') sp += '\n\n' + REACT_ADDENDUM;
      return sp;
    },
    async llmJSON(messages, { temperature } = {}) {
      ctx.throwIfAborted();
      // 컨텍스트 예산 점검(호출마다 — react 대화 누적도 감지): 한글 혼합 텍스트 기준 대략 chars/2.2 ≈ 토큰
      const totalChars = messages.reduce((s, m) => s + (m.content?.length || 0), 0);
      const estTokens = Math.round(totalChars / 2.2);
      const numCtx = getNumCtx();
      // C2: 추정 토큰이 num_ctx를 초과하면 컨텍스트 초과 플래그 기록(프롬프트 절단 가능 — 점수 신뢰도 판단용)
      if (estTokens > numCtx) result.ctxOverflow = true;
      // 컨텍스트 예산 경고 trace는 실행당 1회(기존 동작 유지)
      if (!ctx._ctxWarned && estTokens > numCtx * 0.9) {
        ctx._ctxWarned = true;
        emit('info', `⚠ 프롬프트 예상 토큰(~${estTokens.toLocaleString()})이 컨텍스트 길이(num_ctx=${numCtx.toLocaleString()})에 근접/초과합니다. 도구 카탈로그가 잘릴 수 있으니 설정에서 컨텍스트 길이를 상향하세요.`);
      }
      emit('llm-request', `LLM 요청 (${ctx.model})`, messagesPreview(messages));
      let res;
      try {
        res = await chatJSON({ model: ctx.model, messages, temperature: temperature ?? ctx.temperature, signal });
      } catch (e) {
        // 실패한 시도도 실제 HTTP 호출이므로 집계 (chatJSON이 e.llmCalls에 시도 횟수를 실어줌)
        if (e?.name !== 'AbortError') {
          result.llmCalls += (e?.llmCalls || 1);
          // 실패 경로에서도 chatJSON이 실어 보낸 누적 토큰을 성공 경로와 동일 로직으로 반영(0 과소기록 방지)
          result.inputTokens += e?.promptTokens || 0;
          result.outputTokens += e?.outputTokens || 0;
          if (e?.tokensEstimated) result.tokensEstimated = true;
        }
        throw e;
      }
      result.llmCalls += (res.calls || 1); // ollama.chatJSON이 실제 호출 수(1|2)를 반환하면 반영, 없으면 1로 폴백
      result.totalLatencyMs += res.durationMs || 0;
      // 토큰 계측 누적(실측 우선, chatJSON이 내부 호출을 합산해 반환). 하나라도 추정이면 result 전체를 추정으로 표시.
      result.inputTokens += res.promptTokens || 0;
      result.outputTokens += res.outputTokens || 0;
      if (res.tokensEstimated) result.tokensEstimated = true;
      // C2: 실측 promptTokens가 num_ctx의 98% 이상이면 프롬프트 절단(초과)을 사후 확정.
      // 단, 형식 재요청(calls=2) 시 promptTokens는 두 호출의 합산이라 오탐하므로 단일 호출(calls===1)일 때만 판정.
      if (!res.tokensEstimated && res.calls === 1 && (res.promptTokens || 0) >= numCtx * 0.98) result.ctxOverflow = true;
      emit('llm-response', `LLM 응답 (${Math.round(res.durationMs || 0)}ms)${res.retried ? ' · 형식 재요청됨' : ''}`, res.raw);
      return res.data;
    },
  };
  return ctx;
}

/**
 * 단계 오류를 ExecutionResult에 반영.
 * - 모든 실행 경로에서 hasStepErrors 플래그를 기록한다.
 * - failOnStepError(=react 이외)면 result.ok=false로 강등하고 첫 오류를 result.error에 보존한다.
 *   (이후 단계는 계속 실행 — 기존 정책 유지)
 */
function markStepError(ctx, step) {
  ctx.result.hasStepErrors = true;
  if (ctx.failOnStepError) {
    ctx.result.ok = false;
    if (!ctx.result.error) ctx.result.error = step.error;
  }
}

/** 도구 한 단계 실행 (검증 → 실행). 항상 step 객체를 steps에 push하고 반환 */
async function execToolStep(ctx, serverId, toolName, params) {
  const p = params || {};
  ctx.emit('tool-call', `도구 호출: ${serverId} / ${toolName}`, p);
  const step = { serverId, toolName, params: p, output: null, latencyMs: 0 };

  const server = ctx.byId.get(serverId);
  const tool = server ? (server.tools || []).find(t => t.name === toolName) : null;

  if (!server) {
    step.error = `등록되지 않은 서버: '${serverId}'`;
    ctx.emit('error', step.error);
  } else if (!tool) {
    step.error = `서버 '${serverId}'에 도구 '${toolName}'가 없습니다`;
    ctx.emit('error', step.error);
  } else {
    const v = validateParams(tool, p);
    if (!v.ok) {
      step.error = '파라미터 검증 실패: ' + v.errors.join('; ');
      ctx.emit('error', step.error, p);
    } else {
      try {
        const { output, latencyMs } = await executeTool(server, toolName, p, { signal: ctx.signal });
        step.output = output;
        step.latencyMs = latencyMs;
        ctx.result.totalLatencyMs += latencyMs;
        ctx.emit('tool-result', `결과 수신: ${toolName} (${latencyMs}ms)`, output);
      } catch (e) {
        if (e?.name === 'AbortError') throw e; // 중단은 상위 실행기/진입점으로 전파
        step.error = String(e?.message || e);
        ctx.emit('error', `도구 실행 오류: ${step.error}`);
      }
    }
  }

  if (step.error) markStepError(ctx, step);
  ctx.result.steps.push(step);
  return step;
}

/* ============================================================
   paramsTemplate 치환 (skill · rule 공용)
   ============================================================ */

function resolveToken(token, ctx, stepOutputs) {
  if (token === 'QUERY') return ctx.query;
  if (token === 'DATE') return ctx.date;
  const m = token.match(/^step(\d+)\.output(?:\.(.+))?$/i);
  if (m) {
    const out = stepOutputs[Number(m[1]) - 1];
    if (out === undefined) { ctx.emit('info', `⚠ 템플릿: step${m[1]}의 출력이 아직 없습니다`); return ''; }
    if (!m[2]) return out;
    const v = getPath(out, m[2]);
    if (v === undefined) { ctx.emit('info', `⚠ 템플릿: 경로 '${token}'를 찾을 수 없습니다`); return ''; }
    return v;
  }
  ctx.emit('info', `⚠ 템플릿: 알 수 없는 토큰 '${token}'`);
  return '';
}

function substituteString(str, ctx, stepOutputs) {
  const exact = str.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (exact) {
    const v = resolveToken(exact[1].trim(), ctx, stepOutputs);
    return v === undefined ? '' : v; // 단일 토큰이면 원본 타입(객체/숫자 등) 유지
  }
  return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, tok) => {
    const v = resolveToken(tok.trim(), ctx, stepOutputs);
    if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

function resolveParamsTemplate(template, ctx, stepOutputs) {
  const walk = (val) => {
    if (typeof val === 'string') return substituteString(val, ctx, stepOutputs);
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(val)) o[k] = walk(v);
      return o;
    }
    return val;
  };
  return walk(template || {});
}

/** paramFill='llm'일 때 LLM으로 params 생성. 실패 시 템플릿 기본값으로 폴백 */
async function fillParamsWithLLM(ctx, step, stepOutputs) {
  const defaults = resolveParamsTemplate(step.paramsTemplate || {}, ctx, stepOutputs);
  const server = ctx.byId.get(step.serverId);
  const tool = server?.tools?.find(t => t.name === step.toolName);
  const schemaText = tool ? safeStringify(tool.inputSchema || {}) : '(스키마 없음)';
  const prevText = stepOutputs.length
    ? stepOutputs.map((o, i) => `step${i + 1}.output = ${truncate(JSON.stringify(o), 400)}`).join('\n')
    : '(이전 단계 출력 없음)';
  const messages = [
    { role: 'system', content: '당신은 도구 호출 파라미터를 생성하는 도우미입니다. 주어진 inputSchema에 정확히 맞는 JSON 객체 하나만 출력하세요. 설명·코드블록 금지.' },
    { role: 'user', content:
      `[도구] ${step.serverId} / ${step.toolName}\n` +
      `[inputSchema]\n${schemaText}\n\n` +
      `[사용자 질의]\n${ctx.query}\n\n` +
      `[이전 단계 출력]\n${prevText}\n\n` +
      `[참고용 기본값]\n${JSON.stringify(defaults)}\n\n` +
      `위 정보를 바탕으로 이 도구의 params JSON 객체만 출력하세요.` },
  ];
  try {
    const data = await ctx.llmJSON(messages, { temperature: ctx.auxTemperature });
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return (data.params && typeof data.params === 'object') ? data.params : data;
    }
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    ctx.emit('error', `파라미터 LLM 생성 실패 — 템플릿 기본값 사용: ${e.message}`);
  }
  return defaults;
}

/** 정의된 steps 순차 실행 (skill · rule 공용) */
async function runSteps(ctx, steps, { paramFill = 'template' } = {}) {
  const list = steps || [];
  const stepOutputs = []; // step1.output → index 0
  const SAFETY = 30;
  for (let i = 0; i < list.length && i < SAFETY; i++) {
    ctx.throwIfAborted();
    const st = list[i];
    const params = paramFill === 'llm'
      ? await fillParamsWithLLM(ctx, st, stepOutputs)
      : resolveParamsTemplate(st.paramsTemplate || {}, ctx, stepOutputs);
    const executed = await execToolStep(ctx, st.serverId, st.toolName, params);
    stepOutputs.push(executed.output);
  }
}

/* ============================================================
   카탈로그 검색 기반 공급(retrieval)
   ============================================================ */

/**
 * C3: db 검색 폴백 사유를 결과에 기록 — 실행당 최초 1회(이미 기록돼 있으면 유지).
 * 예: 'graph→vector(stale)', 'hybrid→keyword(인덱스가 없어 키워드 검색으로 대체)', '검색 0건→전체 카탈로그'
 */
function noteRetrievalFallback(ctx, reason) {
  if (!ctx.result.retrievalFallback) ctx.result.retrievalFallback = String(reason);
}

/** 검색 결과 도구들만으로 축소 MCP 배열 구성(서버·도구 순서 보존) */
function reduceMcps(mcps, results) {
  const wanted = new Map(); // serverId -> Set(toolName)
  for (const r of results) {
    if (!wanted.has(r.serverId)) wanted.set(r.serverId, new Set());
    wanted.get(r.serverId).add(r.toolName);
  }
  const out = [];
  for (const srv of mcps || []) {
    const set = wanted.get(srv.id);
    if (!set) continue;
    const tools = (srv.tools || []).filter(t => set.has(t.name));
    if (tools.length) out.push({ ...srv, tools });
  }
  return out;
}

/** 후보 목록을 'serverId/toolName' 키 배열로(순서 보존·중복 제거) — retrievedTools 기록용 */
function uniqueToolKeys(list) {
  const keys = [];
  const seen = new Set();
  for (const x of list || []) {
    const k = `${x.serverId}/${x.toolName}`;
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  return keys;
}

/**
 * r7: 연결어미 절 분리 패턴 — '그리고' / '하고 나서' / '~한 다음(에)' / '~한 뒤(에)' / 보수 연결어미.
 * r8 품질 게이트: bare '고 ' 분리를 제거하고 어미를 '하고|되고|이고|보고'+공백으로 보수 한정 —
 * '재고 수량'·'전기차를 몰고' 같은 명사·용언 중간 절단('재고'→'재', '몰고'→'몰')을 금지한다.
 * lookbehind로 앞말(어간)은 보존하고 연결어미부터 뒤 공백까지만 분리 지점으로 삼는다.
 */
const CLAUSE_SPLIT_RE = /\s*(?:,\s*)?그리고\s+|(?<=[가-힣])(?:하고\s*나서|한\s*다음에?|한\s*뒤에?|하고|되고|이고|보고)\s+/;

/**
 * r8: 문장 분리 패턴 — 마침표(.)는 숫자 사이가 아닐 때만 문장 경계로 취급
 * ('규모 3.0'·'HS코드 3102.30' 같은 소수점·코드 절단 금지). ?·!·줄바꿈은 기존과 동일.
 */
const SENTENCE_SPLIT_RE = /(?:[?!\n]|(?<!\d)\.(?!\d))+/;

/**
 * r7: 휴리스틱 질의 분해(순수 함수, LLM 호출 없음) — 문장(.?!·줄바꿈) 분리 후 연결어미로 절 분리.
 * r8 품질 게이트: (a) 숫자 사이 '.' 비분리, (b) bare '고 ' 분리 제거(CLAUSE_SPLIT_RE 참조),
 * (c) 부질의 최소 길이 6자, (d) 단독 어절(공백 없음) 조각은 8자 미만이면 드랍('수량'·'있어' 등 검색 노이즈 방지).
 * 부질의 2~5개를 반환하며, 분해 결과가 1개면 [원질의] 그대로 반환한다(호출측이 단일 질의 경로 유지).
 * @param {string} query 사용자 질의
 * @returns {string[]} 부질의 배열(항상 1개 이상)
 */
export function decomposeQueryHeuristic(query) {
  const q = String(query || '').trim();
  if (!q) return [q];
  const parts = [];
  for (const sentence of q.split(SENTENCE_SPLIT_RE)) {
    for (const clause of sentence.split(CLAUSE_SPLIT_RE)) {
      const c = clause.trim();
      if (c.length < 6) continue; // r8: 최소 길이 미달 조각 드랍
      if (!/\s/.test(c) && c.length < 8) continue; // r8: 2어절 미만(단독 용언·조각) + 8자 미만 드랍
      parts.push(c);
    }
  }
  if (parts.length < 2) return [q];
  return parts.slice(0, 5);
}

/**
 * r7: 멀티 질의 분해 — 복합 질의를 측면별 부질의로 나눈다(vector multiQuery·graph multiSeed 공용).
 * - heuristic: decomposeQueryHeuristic(문장·연결어미 분리, LLM 호출 없음)
 * - llm: ctx.llmJSON 1회(JSON 문자열 배열 요청). 실패 시 원질의 1개로 폴백(llmCalls는 llmJSON에서 자연 계상).
 * trace '질의 분해: N개 (…)'를 남긴다. 반환은 항상 1개 이상.
 * @param {object} ctx 실행 컨텍스트
 * @param {'heuristic'|'llm'} mode 분해 방식
 * @returns {Promise<string[]>}
 */
async function decomposeQuery(ctx, mode) {
  const q = String(ctx.query || '').trim();
  let subs;
  if (mode === 'llm') {
    try {
      const data = await ctx.llmJSON([
        { role: 'system', content: '당신은 검색 질의 분해기입니다. 사용자 질의가 여러 작업/측면을 담고 있으면 독립적으로 검색 가능한 2~5개의 부질의로 분해하세요. 단일 작업이면 원 질의 하나만 담으세요. 반드시 JSON 문자열 배열(예: ["부질의1","부질의2"]) 하나만 출력합니다. 설명·코드블록은 금지합니다.' },
        { role: 'user', content: q },
      ], { temperature: ctx.auxTemperature });
      const arr = Array.isArray(data) ? data
        : Array.isArray(data?.queries) ? data.queries
          : Array.isArray(data?.subQueries) ? data.subQueries : null;
      const cleaned = (arr || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
      subs = cleaned.length >= 2 ? cleaned : [q];
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      ctx.emit('info', `⚠ 질의 분해(LLM) 실패 — 원질의 1개로 계속: ${e.message}`);
      subs = [q];
    }
  } else {
    subs = decomposeQueryHeuristic(q);
  }
  ctx.emit('info', `질의 분해: ${subs.length}개 (${subs.map((s) => clip(s, 30)).join(' | ')})`);
  return subs;
}

/**
 * 벡터/키워드 검색으로 ctx.catalog를 축소 카탈로그로 교체.
 * - 하위호환 prompt(catalogMode='retrieval')은 config.retrieval을,
 *   db(store='vector')은 config.vector를 파라미터로 넘긴다(opts.params).
 * 임베딩(vector/hybrid)은 LLM 호출로 세지 않는다 — llmCalls 미증가, totalLatencyMs만 반영.
 * @param {object} ctx 실행 컨텍스트
 * @param {{params?:object, label?:string}} [opts] params 미지정 시 config.retrieval 사용, label은 trace 접두어
 */
async function applyCatalogRetrieval(ctx, opts = {}) {
  const cfg = ctx.strategy.config || {};
  const r = opts.params || cfg.retrieval || {};
  const label = opts.label || '카탈로그 검색';
  const method = r.method || 'hybrid';
  const topK = Number(r.topK) > 0 ? Math.floor(Number(r.topK)) : 8;

  // r7: 멀티 질의 분해(multiQuery) — 켜져 있고 catalogIndex가 retrieveMulti를 제공(F2 병렬 구현)할 때만.
  // retrieveMulti 부재 시에는 multiQuery를 조용히 무시하고 기존 단일 질의 경로로 동작한다.
  const mq = r.multiQuery || {};
  let subQueries = null;
  if (mq.on && typeof catalogIndexApi.retrieveMulti === 'function') {
    const subs = await decomposeQuery(ctx, mq.mode === 'llm' ? 'llm' : 'heuristic');
    if (subs.length > 1) subQueries = subs; // 1개면 분해 무의미 — 기존 경로
  }

  const retrieveOpts = {
    mcps: ctx.allMcps,
    method,
    topK,
    threshold: Number.isFinite(r.threshold) ? r.threshold : 0,
    hybridAlpha: Number.isFinite(r.hybridAlpha) ? r.hybridAlpha : 0.5,
    // r7: hybrid 융합 방식(값만 전달, 적용은 catalogIndex 담당) — 'weighted'(기본, 현행)|'rrf'
    hybridFusion: r.hybridFusion === 'rrf' ? 'rrf' : 'weighted',
    expandServer: r.expandServer !== false,
    expandCategory: !!r.expandCategory,
    embedModel: r.embedModel || 'bge-m3:latest',
    // MMR 다양성 재랭킹 파라미터(값만 전달, 재랭킹 구현은 catalogIndex 담당).
    // 1.0=관련도만(현행, MMR off), 0.0=다양성 최대. 미설정 시 1.0으로 방어.
    mmrLambda: Number.isFinite(r.mmrLambda) ? r.mmrLambda : 1.0,
    // 문서 필드 구성(값만 전달, flatten/색인 구성은 catalogIndex 담당). 미지정(undefined)이면
    // catalogIndex가 인덱스 구축값으로 방어하므로 stale 판정·검색이 정합적으로 동작한다.
    docFields: r.docFields,
    signal: ctx.signal,
  };
  const t0 = performance.now();
  let res;
  try {
    // 멀티 질의: 부질의별 retrieve(perK) 후 라운드로빈 병합→topK(구현은 catalogIndex.retrieveMulti 담당)
    res = subQueries
      ? await catalogIndexApi.retrieveMulti(subQueries, { ...retrieveOpts, perK: Number(mq.perK) > 0 ? Math.floor(Number(mq.perK)) : 4 })
      : await retrieve(ctx.query, retrieveOpts);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    ctx.result.totalLatencyMs += performance.now() - t0; // 임베딩 시도 지연도 총 지연에 포함
    // C3: 검색 자체가 실패해 전체 카탈로그로 폴백
    noteRetrievalFallback(ctx, `${method} 검색 실패→전체 카탈로그`);
    ctx.emit('error', `${label} 실패 — 전체 카탈로그로 폴백: ${e.message}`);
    return;
  }
  ctx.result.totalLatencyMs += performance.now() - t0;

  const results = res.results || [];
  if (!results.length) {
    // C3: 검색 0건 → 전체 카탈로그 폴백(내부 방식 폴백이 함께 있었으면 사유에 병기)
    noteRetrievalFallback(ctx, `검색 0건→전체 카탈로그${res.fallbackReason ? ` (${res.usedMethod}: ${res.fallbackReason})` : ''}`);
    ctx.emit('info', `⚠ ${label} 결과 0개 — 전체 카탈로그로 폴백합니다 (${res.usedMethod}${res.fallbackReason ? ', ' + res.fallbackReason : ''}).`);
    return;
  }

  // C3: 검색은 성공했지만 catalogIndex 내부에서 방식 폴백(vector/hybrid→keyword 등)이 일어난 경우 기록
  if (res.fallbackReason) {
    noteRetrievalFallback(ctx, `${res.requestedMethod || method}→${res.usedMethod}(${res.fallbackReason})`);
  }

  const reduced = reduceMcps(ctx.allMcps, results);
  // r6 fields는 의도적으로 적용하지 않음(기본 구성 고정) — 검색 축소 카탈로그는 소수(topK) 도구의 상세 유지가 목적.
  ctx.catalog = buildToolCatalog(reduced);
  // 검색 축소(topK 소수) 카탈로그는 '전체 주입 축약'이 아니므로 상세도 표시를 0으로 재설정
  ctx.result.catalogDetail = 0;
  // r7: 검색 성공 — 최종 후보 키·실공급 도구 수(평가 retrievalRecall 계산용).
  // r8: pending에 보관 — ctx.fillPrompt가 {{TOOL_CATALOG}}를 실제 치환할 때 result로 확정(미치환이면 null 유지).
  ctx.pendingRetrieval = { retrievedTools: uniqueToolKeys(results), suppliedToolCount: countTools(reduced) };

  const detail = {
    method: res.usedMethod,
    requestedMethod: res.requestedMethod,
    topK: res.topK,
    threshold: res.threshold,
    fallbackReason: res.fallbackReason || null,
    servers: reduced.length,
    tools: results.map(x => ({
      tool: `${x.serverId}/${x.toolName}`,
      score: Math.round((x.score || 0) * 1e4) / 1e4,
      source: x.source,
    })),
  };
  ctx.emit('info',
    `${label}: ${results.length}개 도구 선택 (${res.usedMethod}, topK=${topK})${res.fallbackReason ? ' · 폴백: ' + res.fallbackReason : ''}`,
    detail);
}

/**
 * 그래프 db 검색으로 ctx.catalog를 축소 카탈로그로 교체(db, store='graph').
 * 그래프 없음/stale이면 vector(keyword) 검색으로 폴백 + 경고 trace.
 * 검색 임베딩(시드·semantic)은 llmCalls 미증가, totalLatencyMs만 반영.
 */
async function applyGraphRetrieval(ctx) {
  const cfg = ctx.strategy.config || {};
  const g = cfg.graph || {};
  const embedModel = g.embedModel || 'bge-m3:latest';
  // 추출 모델은 config가 null이면 기본 모델. graphStatus에 넘겨 llm 엣지 사용 그래프의 모델 변경도 stale 판정.
  const extractModel = g.extractModel || getDefaultModel();
  const benchmarks = store.get('benchmarks') || [];
  // G3: 현재 전략이 켠 엣지(semantic/llm) 기준으로 재구축 필요 여부까지 받는다.
  const status = graphStatus(ctx.allMcps, benchmarks, embedModel, extractModel, {
    wantSemantic: !!g.edges?.semantic?.on,
    wantLlm: !!g.edges?.llm?.on,
  });

  // 그래프 손상/실패 시 재사용하는 vector(→keyword) 폴백 — 전체 카탈로그가 아니라 축소 검색으로 폴백(E4).
  const graphVectorFallback = (label) => applyCatalogRetrieval(ctx, {
    params: {
      method: g.seedMethod || 'hybrid',
      topK: Number(g.topK) > 0 ? Math.floor(Number(g.topK)) : 8,
      threshold: 0,
      expandServer: true,
      expandCategory: false,
      embedModel,
    },
    label,
  });

  // 그래프 없음/stale → vector(또는 keyword) 폴백
  if (!status.exists || status.stale) {
    const why = !status.exists ? '그래프 db가 아직 구축되지 않음' : '그래프 db가 stale(MCP·벤치마크 변경됨)';
    // C3: graph→vector 폴백 사유 기록(이후 vector 내부 폴백이 있어도 최초 사유 유지)
    noteRetrievalFallback(ctx, `graph→vector(${!status.exists ? '미구축' : 'stale'})`);
    ctx.emit('info', `⚠ ${why} — vector 검색으로 폴백합니다. 그래프 편집기에서 그래프를 구축/재구축하세요.`);
    await graphVectorFallback('DB 검색(graph→vector 폴백)');
    return;
  }

  // G3: 그래프는 존재·최신이지만 켠 엣지(semantic/llm)가 아직 반영 안 됐거나 인덱스가 stale이면
  // 폴백까진 아니어도 경고로 알린다(사용자가 재구축 필요를 인지하도록). needsRebuild 사유를 그대로 노출.
  if (status.needsRebuild && status.rebuildReasons?.length) {
    ctx.emit('info', `⚠ 그래프 재구축 필요 — ${status.rebuildReasons.join(' / ')} (해당 엣지가 반영되지 않은 채 기존 그래프로 검색합니다)`);
  }

  // LLM 엣지를 켰는데 그래프에 llm 엣지가 0개면 사실을 명시(E5): 추출 실패(전부/일부) vs 개념 교차 없음 구분.
  if (g.edges?.llm?.on && status.usedLlm && (status.edgeCountByType?.llm || 0) === 0) {
    const failed = status.llmFailed || 0;
    if (failed >= status.nodeCount && status.nodeCount > 0) {
      ctx.emit('info', `⚠ LLM 엣지 0개 — 추출이 전부 실패했습니다(${failed}/${status.nodeCount} 도구). 추출 모델·Ollama 연결을 확인하고 재구축하세요.`);
    } else if (failed > 0) {
      ctx.emit('info', `⚠ LLM 엣지 0개 — 일부 도구 추출 실패(${failed}/${status.nodeCount}) 및 개념 교차 없음.`);
    } else {
      ctx.emit('info', 'ℹ LLM 엣지 0개 — 추출은 됐으나 도구 간 개념 교차가 없어 생성된 llm 엣지가 없습니다.');
    }
  }

  const graph = store.get(GRAPH_KEY);
  // 아래 graphRetrieve와 경로 추천(recommendPaths)에서 공용으로 재사용하는 순회 파라미터.
  const seedMethod = g.seedMethod || 'hybrid';
  const seedK = Number(g.seedK) > 0 ? Math.floor(Number(g.seedK)) : 5;
  const maxDegree = Number(g.maxDegree) > 0 ? Math.floor(Number(g.maxDegree)) : 12;
  const topKForGraph = Number(g.topK) > 0 ? Math.floor(Number(g.topK)) : 8;

  // r7: 멀티 시드 분해(multiSeed) — 켜져 있으면 부질의를 graphRetrieve의 queries로 전달(부질의별 시드·
  // relevance max-병합은 catalogGraph(F2) 담당). 구버전 graphRetrieve는 미지의 옵션을 무시하므로
  // 미구현 상태에서도 기존 단일 질의 경로와 동일하게 동작한다.
  const ms = g.multiSeed || {};
  let seedQueries = null;
  if (ms.on) {
    const subs = await decomposeQuery(ctx, ms.mode === 'llm' ? 'llm' : 'heuristic');
    if (subs.length > 1) seedQueries = subs; // 1개면 분해 무의미 — 기존 경로
  }

  const t0 = performance.now();
  let res;
  try {
    res = await graphRetrieve(ctx.query, {
      mcps: ctx.allMcps,
      graph,
      edgeParams: g.edges || {},
      seedMethod,
      seedK,
      hops: Number(g.hops) > 0 ? Math.floor(Number(g.hops)) : 2,
      decay: Number.isFinite(g.decay) ? g.decay : 0.5,
      topK: topKForGraph,
      embedModel,
      // Graph 신규 파라미터(값만 전달, 적용은 catalogGraph의 graphRetrieve/effectiveAdjacency 담당).
      // maxDegree: 노드별 최대 연결(io out-cap 포함) 상한. undefined면 기본 12로 방어.
      // hubNorm: 확산 시 허브 degree 정규화(1/√deg) on/off. undefined면 기본 true로 방어.
      maxDegree,
      hubNorm: g.hubNorm !== false,
      // r7 그래프 블렌드 파라미터(값만 전달, 적용은 catalogGraph 담당 — 기본값은 현행 상수와 동일).
      // relBonus: 관련도 블렌드 가중(기본 0.5) · relevanceK: 시드 relevance 상위 K(기본 15) ·
      // includeRelTopN: relevance 상위 N을 그래프 비도달이어도 후보 편입(기본 0=현행 off).
      relBonus: Number.isFinite(g.relBonus) ? g.relBonus : 0.5,
      relevanceK: Number(g.relevanceK) > 0 ? Math.floor(Number(g.relevanceK)) : 15,
      includeRelTopN: Number(g.includeRelTopN) > 0 ? Math.floor(Number(g.includeRelTopN)) : 0,
      // r7 멀티 시드: 부질의 배열(없으면 undefined — 기존 단일 질의 경로)
      queries: seedQueries || undefined,
      signal: ctx.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    ctx.result.totalLatencyMs += performance.now() - t0;
    // 그래프 검색 예외 → 전체 카탈로그가 아니라 vector(→keyword) 검색으로 폴백(축소효과 유지, E4).
    noteRetrievalFallback(ctx, 'graph 실패→vector'); // C3
    ctx.emit('error', `DB 검색(graph) 실패 — vector 검색으로 폴백합니다: ${e.message}`);
    await graphVectorFallback('DB 검색(graph 실패→vector 폴백)');
    return;
  }
  ctx.result.totalLatencyMs += performance.now() - t0;

  const results = res.results || [];
  if (!results.length) {
    // C3: graph 검색 0건 → 전체 카탈로그 폴백
    noteRetrievalFallback(ctx, `graph 검색 0건→전체 카탈로그${res.fallbackReason ? ` (${res.fallbackReason})` : ''}`);
    ctx.emit('info', `⚠ DB 검색(graph) 결과 0개 — 전체 카탈로그로 폴백합니다${res.fallbackReason ? ' (' + res.fallbackReason + ')' : ''}.`);
    return;
  }

  // C3: 검색은 성공했지만 내부 폴백 사유가 반환된 경우(시드 vector→keyword, 그래프/유효 엣지 없음 등) 기록
  if (res.fallbackReason) noteRetrievalFallback(ctx, `graph: ${res.fallbackReason}`);

  // 경로 추천(recommendPaths) 반영: graphRetrieve 후보에 추천 워크플로우 경로의 도구를 합집합으로 보강한다.
  // 실패/예외/빈 결과는 무시하고 기존 graphRetrieve 후보만 사용(회귀 없음). AbortError만 전파.
  let candidates = results;
  {
    const pathCfg = g.path || {};
    // 사용 엣지: io는 항상, llm은 llm 엣지를 켰을 때만 유효(그래프 편집기 미리보기와 동일 규칙).
    const pathEdges = (Array.isArray(pathCfg.edges) ? pathCfg.edges : ['io'])
      .filter(t => t === 'io' || (t === 'llm' && g.edges?.llm?.on));
    if (!pathEdges.length) pathEdges.push('io');
    const tp = performance.now();
    try {
      const rec = await recommendPaths(ctx.query, {
        mcps: ctx.allMcps,
        graph,
        edgeParams: g.edges || {},
        seedMethod,
        seedK,
        edges: pathEdges,
        beamWidth: pathCfg.beamWidth,
        maxLen: pathCfg.maxLen,
        maxDegree,
        embedModel,
        // P2: graphRetrieve가 이미 계산한 시드/질의 관련도를 재사용해 시드 이중 임베딩(질의 임베딩 2회)을 제거.
        // (동일 seedMethod·seedK로 얻은 관련도이므로 recommendPaths 내부 재검색과 결과 동일 — 회귀 없음)
        seeds: res.seeds,
        relevance: res.relevance,
        signal: ctx.signal,
      });
      ctx.result.totalLatencyMs += performance.now() - tp; // 경로 추천 임베딩(시드) 지연도 총 지연에 포함
      const paths = (rec && Array.isArray(rec.paths)) ? rec.paths : [];
      if (paths.length) {
        // 상위 1~2개 경로의 도구를 순서대로 수집(기존 후보와 중복 제거).
        const usePaths = paths.slice(0, 2);
        const seen = new Set(results.map(r => `${r.serverId}/${r.toolName}`));
        const added = [];
        for (const p of usePaths) {
          for (const s of (p.steps || [])) {
            const key = `${s.serverId}/${s.toolName}`;
            if (!seen.has(key)) { seen.add(key); added.push({ serverId: s.serverId, toolName: s.toolName }); }
          }
        }
        if (added.length) {
          // 전체 상한(topK) 유지: 경로 도구를 우선 포함하고, 상한 초과분은 하위 graph 후보부터 잘라 자리를 확보한다.
          candidates = (results.length + added.length > topKForGraph)
            ? [...results.slice(0, Math.max(0, topKForGraph - added.length)), ...added]
            : [...results, ...added];
          const summary = usePaths
            .map(p => (p.steps || []).map(s => `${s.serverId}/${s.toolName}`).join(' → '))
            .join(' | ');
          ctx.emit('info', `경로 추천 반영: ${added.length}개 도구 추가 (${summary})`);
        }
      }
    } catch (e) {
      ctx.result.totalLatencyMs += performance.now() - tp;
      if (e?.name === 'AbortError') throw e;
      // 경로 추천 실패는 무시하고 기존 graphRetrieve 후보만 사용(회귀 없음).
    }
  }

  // P1: 경로 도구 합집합 후 최종 상한(topK) 강제 — 극단 config(추가 도구 수 > topK)에서도 총량이 topK를 넘지 않도록 보장.
  if (candidates.length > topKForGraph) candidates = candidates.slice(0, topKForGraph);

  const reduced = reduceMcps(ctx.allMcps, candidates);
  // r6 fields는 의도적으로 적용하지 않음(기본 구성 고정) — 검색 축소 카탈로그는 소수(topK) 도구의 상세 유지가 목적.
  ctx.catalog = buildToolCatalog(reduced);
  // 검색 축소(topK 소수) 카탈로그는 '전체 주입 축약'이 아니므로 상세도 표시를 0으로 재설정
  ctx.result.catalogDetail = 0;
  // r7: 검색 성공 — 최종 후보(경로추천 반영 후) 키·실공급 도구 수(평가 retrievalRecall 계산용).
  // r8: pending에 보관 — ctx.fillPrompt가 {{TOOL_CATALOG}}를 실제 치환할 때 result로 확정(미치환이면 null 유지).
  ctx.pendingRetrieval = { retrievedTools: uniqueToolKeys(candidates), suppliedToolCount: countTools(reduced) };

  const hops = Number(g.hops) > 0 ? Math.floor(Number(g.hops)) : 2;
  // P3: 상세(detail.tools)와 카운트를 최종 candidates 기준으로 표기 — 경로추천으로 추가된 도구도 목록에 반영(카운트·목록 일치).
  // 경로추천으로 추가된 후보는 score/source/hop이 없으므로 source는 'path'로 표기하고 나머지는 비워 둔다(JSON에서 자연 생략).
  const detail = {
    seeds: (res.seeds || []).map(s => `${s.serverId}/${s.toolName}(${s.score})`),
    usedEmbed: res.usedEmbed,
    fallbackReason: res.fallbackReason || null,
    servers: reduced.length,
    tools: candidates.map(x => ({
      tool: `${x.serverId}/${x.toolName}`,
      score: x.score,
      source: x.source || 'path',
      hop: x.hop,
      via: (x.viaEdges || []).join('+') || undefined,
    })),
  };
  ctx.emit('info',
    `DB 검색(graph): ${candidates.length}개 도구 (시드 ${res.seeds?.length || 0}개, hops=${hops})${res.fallbackReason ? ' · ' + res.fallbackReason : ''}`,
    detail);
}

/* ============================================================
   실행기: plan / react / skill / rule
   ============================================================ */

async function planLLM(ctx, systemPromptFilled, { queryIncluded = false } = {}) {
  // 시스템 프롬프트에 {{QUERY}}가 치환되어 질의가 이미 포함된 경우, user 메시지에서 질의를 중복 전달하지 않는다.
  const userMsg = queryIncluded ? '위 지시에 따라 JSON만 출력하세요.' : ctx.query;
  const messages = [
    { role: 'system', content: systemPromptFilled },
    { role: 'user', content: userMsg },
  ];
  const data = await ctx.llmJSON(messages);
  if (data?.reasoning) ctx.emit('info', '플래너 근거', String(data.reasoning));
  return Array.isArray(data?.plan) ? data.plan : (Array.isArray(data) ? data : null);
}

async function executePlan(ctx, plan, label) {
  if (!plan) { ctx.fail(`${label}가 유효한 plan 배열을 반환하지 않았습니다.`); return; }
  if (plan.length > ctx.maxSteps) {
    // 계획이 잘리면 부분 실행이므로 성공으로 기록하지 않는다 (react의 maxSteps 실패 처리와 대칭)
    ctx.emit('error', `⚠ 계획 ${plan.length}단계가 maxSteps(${ctx.maxSteps})를 초과 — ${ctx.maxSteps}단계까지만 실행하고 부분 실행(실패)으로 기록합니다.`);
    plan = plan.slice(0, ctx.maxSteps);
    ctx.result.hasStepErrors = true;
    ctx.result.truncated = true;
    ctx.result.ok = false;
    if (!ctx.result.error) ctx.result.error = `계획이 maxSteps(${ctx.maxSteps})를 초과하여 부분 실행됨`;
  }
  ctx.emit('info', `계획 실행 시작: 총 ${plan.length}단계`);
  const stepOutputs = []; // step1.output → index 0
  for (const s of plan) {
    ctx.throwIfAborted();
    const params = resolveParamsTemplate(s.params || {}, ctx, stepOutputs);
    const executed = await execToolStep(ctx, s.server ?? s.serverId, s.tool ?? s.toolName, params);
    stepOutputs.push(executed.output);
  }
}

async function runPlan(ctx) {
  const tpl = (ctx.strategy.config || {}).systemPrompt || DEFAULT_PLANNER_PROMPT;
  const queryIncluded = /\{\{\s*QUERY\s*\}\}/.test(tpl);
  await executePlan(ctx, await planLLM(ctx, ctx.filledSystemPrompt(), { queryIncluded }), '플래너');
}

async function runReact(ctx) {
  const sys = ctx.filledSystemPrompt();
  const tpl = (ctx.strategy.config || {}).systemPrompt || DEFAULT_PLANNER_PROMPT;
  const queryIncluded = /\{\{\s*QUERY\s*\}\}/.test(tpl);
  const firstUser = queryIncluded
    ? '위 지시와 질의에 따라 첫 번째 사고(thought)와 행동(action)을 JSON으로 출력하세요.'
    : `질의: ${ctx.query}\n\n첫 번째 사고(thought)와 행동(action)을 JSON으로 출력하세요.`;
  const conversation = [{ role: 'user', content: firstUser }];
  const stepOutputs = []; // step1.output → index 0 (관찰값 참조 치환용)

  for (let stepNo = 1; stepNo <= ctx.maxSteps; stepNo++) {
    ctx.throwIfAborted();
    const data = await ctx.llmJSON([{ role: 'system', content: sys }, ...conversation]);
    if (data?.thought) ctx.emit('info', `사고 #${stepNo}`, String(data.thought));

    const action = data?.action;
    const hasAction = action && (action.server ?? action.serverId) && (action.tool ?? action.toolName);

    if (!hasAction && data?.final_answer != null) {
      ctx.result.finalAnswer = String(data.final_answer);
      ctx.emit('info', '최종 답변 도달', ctx.result.finalAnswer);
      return;
    }
    if (!hasAction) {
      ctx.emit('error', `#${stepNo}: 응답에 유효한 action 또는 final_answer가 없습니다`, data);
      conversation.push({ role: 'assistant', content: safeStringify(data) });
      conversation.push({ role: 'user', content: '관찰(observation): 유효한 action(server/tool 포함) 또는 final_answer가 필요합니다. 형식을 지켜 다시 출력하세요.' });
      continue;
    }

    conversation.push({ role: 'assistant', content: JSON.stringify({ thought: data.thought, action }) });
    const params = resolveParamsTemplate(action.params || {}, ctx, stepOutputs);
    const step = await execToolStep(ctx, action.server ?? action.serverId, action.tool ?? action.toolName, params);
    stepOutputs.push(step.output);
    const observation = step.error ? `오류: ${step.error}` : truncate(JSON.stringify(step.output), 800);
    ctx.emit('info', `관찰 #${stepNo}`, observation);
    conversation.push({ role: 'user', content: `관찰(observation): ${observation}\n\n다음 사고와 행동, 또는 final_answer를 JSON으로 출력하세요.` });
  }
  ctx.fail(`최대 단계(${ctx.maxSteps})에 도달했지만 final_answer를 생성하지 못했습니다`);
}

/**
 * db 전략 실행 — store(vector|graph)로 관련 도구를 검색해 축소 카탈로그를 구성한 뒤,
 * planningMode(plan|react)에 따라 기존 프롬프트 실행 경로(runPlan/runReact)를 재사용한다.
 */
async function runDb(ctx) {
  const cfg = ctx.strategy.config || {};
  const dbStore = cfg.store === 'graph' ? 'graph' : 'vector';
  if (dbStore === 'graph') await applyGraphRetrieval(ctx);
  else await applyCatalogRetrieval(ctx, { params: cfg.vector || {}, label: 'DB 검색(vector)' });

  if (cfg.planningMode === 'react') await runReact(ctx);
  else await runPlan(ctx);
}

async function runSkill(ctx) {
  const cfg = ctx.strategy.config || {};
  const skills = cfg.skills || [];
  if (!skills.length) { ctx.fail('정의된 스킬이 없습니다.'); return; }

  const skillList = skills.map((s, i) =>
    `${i + 1}. id:"${s.id}" | 이름:${s.name || '-'} | 트리거:${s.trigger || '-'} | 설명:${s.description || '-'}`).join('\n');

  // selectorPrompt는 {{TOOL_CATALOG}}/{{QUERY}}/{{DATE}}에 더해 {{SKILLS}}(스킬 목록)도 지원.
  // r7: 기본 셀렉터(카탈로그 미포함)는 ctx.fillPrompt가 카탈로그를 생성하지 않는다(지연 계산 — 계산·기록 없음).
  const rawPrompt = cfg.selectorPrompt || DEFAULT_SKILL_SELECTOR_PROMPT;
  const sys = ctx.fillPrompt(rawPrompt).replaceAll('{{SKILLS}}', skillList);
  const messages = [{ role: 'system', content: sys }];

  // 프롬프트에 스킬 목록/질의 플레이스홀더가 없으면 사용자 메시지로 보강
  const extras = [];
  if (!/\{\{\s*SKILLS\s*\}\}/.test(rawPrompt)) extras.push(`[스킬 목록]\n${skillList}`);
  if (!/\{\{\s*QUERY\s*\}\}/.test(rawPrompt)) extras.push(`[사용자 질의]\n${ctx.query}`);
  extras.push('가장 적합한 스킬 하나를 {"skill":"id","reason":"근거"} 형식으로 선택하세요. 없으면 {"skill":"none","reason":"근거"}.');
  messages.push({ role: 'user', content: extras.join('\n\n') });

  const data = await ctx.llmJSON(messages, { temperature: ctx.auxTemperature });
  const chosen = data?.skill;
  const reason = data?.reason ?? data?.reasoning;
  if (!chosen || String(chosen).toLowerCase() === 'none') {
    ctx.fail(`적합한 스킬을 찾지 못했습니다${reason ? ': ' + reason : ''}.`);
    return;
  }
  const skill = skills.find(s => s.id === chosen) || skills.find(s => s.name === chosen);
  if (!skill) { ctx.fail(`선택된 스킬 '${chosen}'을(를) 목록에서 찾을 수 없습니다.`); return; }

  ctx.emit('info', `스킬 선택: ${skill.name}`, reason ? String(reason) : undefined);
  if (!skill.steps?.length) { ctx.emit('info', `스킬 '${skill.name}'에 정의된 단계가 없습니다.`); return; }
  await runSteps(ctx, skill.steps, { paramFill: cfg.paramFill === 'llm' ? 'llm' : 'template' });
}

function evalCondition(cond, query, ctx) {
  const q = query || '';
  const value = cond?.value ?? '';
  if (String(value).trim() === '') return false; // 빈 조건은 모든 질의에 매칭되지 않도록 차단(가져온/구버전 데이터 방어)
  if (cond?.type === 'regex') {
    try { return new RegExp(value, 'i').test(q); }
    catch (e) { ctx.emit('info', `⚠ 잘못된 정규식 무시: /${value}/ (${e.message})`); return false; }
  }
  return q.toLowerCase().includes(String(value).toLowerCase());
}

function evalRule(rule, query, ctx) {
  const conds = rule?.conditions || [];
  if (!conds.length) return false;
  const results = conds.map(c => evalCondition(c, query, ctx));
  return (rule.matchMode === 'all') ? results.every(Boolean) : results.some(Boolean);
}

async function runRule(ctx) {
  const cfg = ctx.strategy.config || {};
  const rules = [...(cfg.rules || [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  let matched = null;
  for (const rule of rules) {
    if (evalRule(rule, ctx.query, ctx)) { matched = rule; break; }
  }
  if (matched) {
    ctx.emit('info', `룰 매치: ${matched.name} (우선순위 ${matched.priority ?? 0})`);
    if (!matched.steps?.length) { ctx.emit('info', `룰 '${matched.name}'에 정의된 단계가 없습니다.`); return; }
    await runSteps(ctx, matched.steps, { paramFill: 'template' });
    return;
  }

  ctx.emit('info', '매치되는 룰이 없습니다.');
  if ((cfg.onNoMatch || 'error') === 'llmFallback') {
    ctx.result.usedFallback = true;
    ctx.emit('info', 'LLM 플래너로 폴백합니다.');
    const prompt = (cfg.fallbackPrompt && cfg.fallbackPrompt.trim()) ? cfg.fallbackPrompt : DEFAULT_PLANNER_PROMPT;
    const queryIncluded = /\{\{\s*QUERY\s*\}\}/.test(prompt);
    // r7: ctx.fillPrompt — 폴백 프롬프트가 {{TOOL_CATALOG}}를 포함할 때만 이 시점에 카탈로그 생성·기록
    await executePlan(ctx, await planLLM(ctx, ctx.fillPrompt(prompt), { queryIncluded }), '폴백 플래너');
  } else {
    ctx.fail('매치되는 룰이 없어 실행을 종료합니다 (onNoMatch: error).');
  }
}

/* ============================================================
   진입점
   ============================================================ */

/**
 * 전략 실행 — 절대 throw하지 않음.
 * @param {object} strategy Strategy
 * @param {string} query 사용자 질의
 * @param {{mcps?:Array, onTrace?:Function, signal?:AbortSignal}} opts
 * @returns {Promise<object>} ExecutionResult
 */
export async function executeStrategy(strategy, query, { mcps = [], onTrace, signal } = {}) {
  const ctx = createRunContext({ strategy, query, mcps, onTrace, signal });
  try {
    if (signal?.aborted) { ctx.fail('사용자에 의해 중단됨'); return ctx.result; }
    ctx.emit('info', `실행 시작 · 타입=${strategy?.type} · 모델=${ctx.model}`);

    switch (strategy?.type) {
      case 'prompt':
        if (strategy.config?.catalogMode === 'retrieval') await applyCatalogRetrieval(ctx);
        if ((strategy.config?.planningMode) === 'react') await runReact(ctx);
        else await runPlan(ctx);
        break;
      case 'db': await runDb(ctx); break;
      case 'skill': await runSkill(ctx); break;
      case 'rule': await runRule(ctx); break;
      default: ctx.fail(`알 수 없는 전략 타입: ${strategy?.type}`);
    }
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) {
      ctx.result.ok = false;
      ctx.result.error = '사용자에 의해 중단됨';
      ctx.emit('error', '사용자에 의해 중단됨');
    } else {
      ctx.result.ok = false;
      ctx.result.error = ctx.result.error || String(e?.message || e);
      ctx.emit('error', '실행 중 예기치 못한 오류', String(e?.message || e));
    }
  }
  ctx.emit('info', `실행 종료 · 성공=${ctx.result.ok} · LLM ${ctx.result.llmCalls}회 · ${Math.round(ctx.result.totalLatencyMs)}ms`);
  return ctx.result;
}
