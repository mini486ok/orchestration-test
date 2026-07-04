// 전략 실행 엔진 — prompt(plan/react) · skill · rule 3종
// 모든 LLM 호출은 ollama.chatJSON(JSON 텍스트 파싱), 모든 도구 실행은 mockEngine 경유.
// executeStrategy는 절대 throw하지 않고 항상 ExecutionResult를 반환한다.
import { chatJSON, getDefaultModel, getNumCtx } from './ollama.js';
import { executeTool, validateParams } from './mockEngine.js';
import { retrieve } from './catalogIndex.js';

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

function describeParam(name, prop = {}, required = false) {
  let t = prop.type || 'any';
  if (prop.type === 'array') t = `array<${prop.items?.type || 'any'}>`;
  let s = `${name}:${t}`;
  if (required) s += '*';
  if (Array.isArray(prop.enum) && prop.enum.length) s += `(${prop.enum.map(String).join('|')})`;
  return s;
}

/** LLM 프롬프트용 도구 카탈로그 텍스트 (토큰 절약형) */
export function buildToolCatalog(mcps = []) {
  const lines = ['(표기: 도구명(파라미터명:타입) · *=필수 · (a|b)=허용값)'];
  for (const server of mcps || []) {
    if (!server || !server.tools || !server.tools.length) continue;
    const head = `[${server.id}] ${server.nameKo || server.name || ''}`;
    lines.push(server.description ? `${head} — ${server.description}` : head);
    for (const tool of server.tools) {
      const props = tool.inputSchema?.properties || {};
      const req = new Set(tool.inputSchema?.required || []);
      const params = Object.entries(props).map(([n, p]) => describeParam(n, p, req.has(n))).join(', ');
      lines.push(`  - ${tool.name}(${params || '파라미터 없음'}): ${tool.description || ''}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '(등록된 도구가 없습니다)';
}

/* ============================================================
   내부 유틸
   ============================================================ */

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
  const catalog = buildToolCatalog(mcps);
  const byId = new Map((mcps || []).map(m => [m.id, m]));
  const result = { ok: true, steps: [], trace: [], llmCalls: 0, totalLatencyMs: 0, hasStepErrors: false };
  // react는 도구 오류를 관찰(observation)로 흘려보내 모델이 회복하도록 두므로 step 오류만으로 실패 처리하지 않는다.
  const failOnStepError = !(strategy?.type === 'prompt' && cfg.planningMode === 'react');

  const emit = (type, label, detail) => {
    const ev = { ts: Date.now(), type, label: String(label) };
    if (detail !== undefined && detail !== null && detail !== '') {
      ev.detail = typeof detail === 'string' ? detail : safeStringify(detail);
    }
    result.trace.push(ev);
    try { onTrace && onTrace(ev); } catch { /* 콜백 오류는 무시 */ }
  };

  const ctx = {
    strategy, query, date, catalog, byId, result, emit, signal, failOnStepError,
    allMcps: mcps || [],
    model: strategy?.model || getDefaultModel(),
    temperature: Number.isFinite(cfg.temperature) ? cfg.temperature : 0.2,
    // 스킬 선택·파라미터 생성 등 내부 보조 호출용 온도: 명시 설정(온도 통일 포함)이 있으면 따르고, 없으면 안정성을 위해 0.1
    auxTemperature: Number.isFinite(cfg.temperature) ? cfg.temperature : 0.1,
    maxSteps: clampSteps(cfg.maxSteps, 6),
    throwIfAborted() { if (signal?.aborted) throw abortError(); },
    fail(msg) { result.ok = false; result.error = msg; emit('error', msg); },
    filledSystemPrompt() {
      let sp = fillPrompt(cfg.systemPrompt || DEFAULT_PLANNER_PROMPT, ctx);
      if (cfg.planningMode === 'react') sp += '\n\n' + REACT_ADDENDUM;
      return sp;
    },
    async llmJSON(messages, { temperature } = {}) {
      ctx.throwIfAborted();
      // 컨텍스트 예산 경고 (실행당 1회): 한글 혼합 텍스트 기준 대략 chars/2.2 ≈ 토큰
      if (!ctx._ctxWarned) {
        const totalChars = messages.reduce((s, m) => s + (m.content?.length || 0), 0);
        const estTokens = Math.round(totalChars / 2.2);
        const numCtx = getNumCtx();
        if (estTokens > numCtx * 0.9) {
          ctx._ctxWarned = true;
          emit('info', `⚠ 프롬프트 예상 토큰(~${estTokens.toLocaleString()})이 컨텍스트 길이(num_ctx=${numCtx.toLocaleString()})에 근접/초과합니다. 도구 카탈로그가 잘릴 수 있으니 설정에서 컨텍스트 길이를 상향하세요.`);
        }
      }
      emit('llm-request', `LLM 요청 (${ctx.model})`, messagesPreview(messages));
      let res;
      try {
        res = await chatJSON({ model: ctx.model, messages, temperature: temperature ?? ctx.temperature, signal });
      } catch (e) {
        // 실패한 시도도 실제 HTTP 호출이므로 집계 (chatJSON이 e.llmCalls에 시도 횟수를 실어줌)
        if (e?.name !== 'AbortError') result.llmCalls += (e?.llmCalls || 1);
        throw e;
      }
      result.llmCalls += (res.calls || 1); // ollama.chatJSON이 실제 호출 수(1|2)를 반환하면 반영, 없으면 1로 폴백
      result.totalLatencyMs += res.durationMs || 0;
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

/**
 * catalogMode==='retrieval'일 때 ctx.catalog를 축소 카탈로그로 교체.
 * 임베딩(vector/hybrid)은 LLM 호출로 세지 않는다 — llmCalls 미증가, totalLatencyMs만 반영.
 */
async function applyCatalogRetrieval(ctx) {
  const cfg = ctx.strategy.config || {};
  const r = cfg.retrieval || {};
  const method = r.method || 'hybrid';
  const topK = Number(r.topK) > 0 ? Math.floor(Number(r.topK)) : 8;

  const t0 = performance.now();
  let res;
  try {
    res = await retrieve(ctx.query, {
      mcps: ctx.allMcps,
      method,
      topK,
      threshold: Number.isFinite(r.threshold) ? r.threshold : 0,
      hybridAlpha: Number.isFinite(r.hybridAlpha) ? r.hybridAlpha : 0.5,
      expandServer: r.expandServer !== false,
      expandCategory: !!r.expandCategory,
      embedModel: r.embedModel || 'bge-m3:latest',
      signal: ctx.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    ctx.result.totalLatencyMs += performance.now() - t0; // 임베딩 시도 지연도 총 지연에 포함
    ctx.emit('error', `카탈로그 검색 실패 — 전체 카탈로그로 폴백: ${e.message}`);
    return;
  }
  ctx.result.totalLatencyMs += performance.now() - t0;

  const results = res.results || [];
  if (!results.length) {
    ctx.emit('info', `⚠ 카탈로그 검색 결과 0개 — 전체 카탈로그로 폴백합니다 (${res.usedMethod}${res.fallbackReason ? ', ' + res.fallbackReason : ''}).`);
    return;
  }

  const reduced = reduceMcps(ctx.allMcps, results);
  ctx.catalog = buildToolCatalog(reduced);

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
    `카탈로그 검색: ${results.length}개 도구 선택 (${res.usedMethod}, topK=${topK})${res.fallbackReason ? ' · 폴백: ' + res.fallbackReason : ''}`,
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

async function runSkill(ctx) {
  const cfg = ctx.strategy.config || {};
  const skills = cfg.skills || [];
  if (!skills.length) { ctx.fail('정의된 스킬이 없습니다.'); return; }

  const skillList = skills.map((s, i) =>
    `${i + 1}. id:"${s.id}" | 이름:${s.name || '-'} | 트리거:${s.trigger || '-'} | 설명:${s.description || '-'}`).join('\n');

  // selectorPrompt는 {{TOOL_CATALOG}}/{{QUERY}}/{{DATE}}에 더해 {{SKILLS}}(스킬 목록)도 지원
  const rawPrompt = cfg.selectorPrompt || DEFAULT_SKILL_SELECTOR_PROMPT;
  const sys = fillPrompt(rawPrompt, ctx).replaceAll('{{SKILLS}}', skillList);
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
    await executePlan(ctx, await planLLM(ctx, fillPrompt(prompt, ctx), { queryIncluded }), '폴백 플래너');
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
