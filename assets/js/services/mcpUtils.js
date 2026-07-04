// MCP 서버 정규화·검증 공용 유틸 — mcpBuilder(수동/AI)와 mcps(가져오기) 양쪽에서 사용
// 외부 JSON(가져오기·LLM 출력)을 안전한 McpServer 형태로 정규화하고 프로토타입 오염을 차단한다.

export const CATEGORIES = [
  '운행정보', '예매·발권', '안전·관제', '시설·유지보수', '물류·화물',
  '도시교통', '여객서비스', '기상·환경', '데이터분석', '요금·정산',
];

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 깊은 복사하며 위험한 키(__proto__/constructor/prototype own key)를 제거 — 프로토타입 오염 방지 */
export function sanitizeKeys(value) {
  if (Array.isArray(value)) return value.map(sanitizeKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = sanitizeKeys(value[k]);
    }
    return out;
  }
  return value;
}

/* ---------- 문자열 정규화 ---------- */
export function slugify(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/[^a-z0-9가-힣\s_-]/g, '')
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
export function snakeify(s) {
  const v = String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return v || 'tool';
}
export function toolName(n) {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(String(n || '')) ? n : snakeify(n);
}

/** 임의 문자열을 가장 가까운 고정 카테고리로 보정 */
export function nearestCategory(c) {
  if (CATEGORIES.includes(c)) return c;
  const s = String(c || '');
  const found = CATEGORIES.find(k => s.includes(k) || k.includes(s));
  if (found) return found;
  const map = [
    ['운행', '운행정보'], ['시간표', '운행정보'], ['예매', '예매·발권'], ['발권', '예매·발권'], ['승차권', '예매·발권'],
    ['안전', '안전·관제'], ['관제', '안전·관제'], ['신호', '안전·관제'], ['시설', '시설·유지보수'], ['유지', '시설·유지보수'],
    ['정비', '시설·유지보수'], ['점검', '시설·유지보수'], ['물류', '물류·화물'], ['화물', '물류·화물'], ['도시', '도시교통'],
    ['지하철', '도시교통'], ['버스', '도시교통'], ['여객', '여객서비스'], ['서비스', '여객서비스'], ['기상', '기상·환경'],
    ['환경', '기상·환경'], ['날씨', '기상·환경'], ['데이터', '데이터분석'], ['분석', '데이터분석'], ['통계', '데이터분석'],
    ['요금', '요금·정산'], ['정산', '요금·정산'], ['결제', '요금·정산'],
  ];
  for (const [kw, cat] of map) if (s.includes(kw)) return cat;
  return '데이터분석';
}

/* ---------- 스키마/도구 정규화 ---------- */
export function normalizeSchema(sc) {
  const out = (sc && typeof sc === 'object' && !Array.isArray(sc)) ? { ...sc } : {};
  if (out.type !== 'object') out.type = 'object';
  if (!out.properties || typeof out.properties !== 'object' || Array.isArray(out.properties)) out.properties = {};
  // required 는 실재하는 프로퍼티 키만 유지(정규화 대상은 신뢰할 수 없는 외부 입력)
  if (Array.isArray(out.required)) {
    const keys = Object.keys(out.properties);
    out.required = out.required.filter(r => keys.includes(r));
  }
  return out;
}

export function normalizeTool(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    name: toolName(t.name || 'tool'),
    description: String(t.description || ''),
    inputSchema: normalizeSchema(t.inputSchema),
    outputSchema: normalizeSchema(t.outputSchema),
    ...(t.mock && typeof t.mock === 'object' ? { mock: t.mock } : {}),
  };
}

function defaultTool() {
  return {
    name: 'tool_1', description: '',
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', properties: {} },
  };
}

/** 임의 객체 → McpServer 형태로 정규화(프로토타입 오염 차단 포함). author/isSample/createdAt 은 호출측에서 부여 */
export function normalizeServer(raw, existingIds = new Set()) {
  const s = sanitizeKeys((raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {});
  let id = slugify(s.id || s.name || s.nameKo || 'mcp-server') || 'mcp-server';
  if (existingIds.has(id)) { const base = id; let n = 1; do { n++; id = `${base}-${n}`; } while (existingIds.has(id)); }
  const tools = (Array.isArray(s.tools) ? s.tools.map(normalizeTool).filter(Boolean) : []);
  return {
    id,
    name: String(s.name || s.nameKo || id),
    nameKo: String(s.nameKo || s.name || id),
    icon: (typeof s.icon === 'string' && s.icon.trim()) ? s.icon.trim() : '🚆',
    category: nearestCategory(s.category),
    description: String(s.description || ''),
    version: String(s.version || '1.0.0'),
    tags: Array.isArray(s.tags) ? s.tags.map(String).map(x => x.trim()).filter(Boolean).slice(0, 8)
      : (typeof s.tags === 'string' ? s.tags.split(',').map(x => x.trim()).filter(Boolean).slice(0, 8) : []),
    tools: tools.length ? tools : [defaultTool()],
  };
}

/** 스키마 기본 검증 — 루트 object, properties, required ⊆ properties 키 */
export function validateSchema(schema, label) {
  if (schema === undefined) return { ok: false, msg: `${label} 스키마 JSON 구문 오류` };
  if (!schema || schema.type !== 'object') return { ok: false, msg: `${label} 스키마 루트는 type:"object"여야 합니다` };
  if (!schema.properties || typeof schema.properties !== 'object') return { ok: false, msg: `${label} 스키마에 properties가 필요합니다` };
  if (Array.isArray(schema.required)) {
    const keys = Object.keys(schema.properties);
    const bad = schema.required.filter(r => !keys.includes(r));
    if (bad.length) return { ok: false, msg: `${label} required 항목이 properties에 없음: ${bad.join(', ')}` };
  }
  return { ok: true };
}

/**
 * 가져오기용 정규화+검증 — 통과분만 {ok:true, server} 반환, 실패는 {ok:false, reason}
 * (tools 배열과 유효한 도구가 최소 1개 필요. 검증 통과분에 한해 정규화된 서버 반환)
 */
export function normalizeImportedServer(raw, existingIds = new Set()) {
  const clean = sanitizeKeys(raw);
  if (!clean || typeof clean !== 'object' || Array.isArray(clean)) {
    return { ok: false, reason: '객체 형식이 아님' };
  }
  if (!Array.isArray(clean.tools) || !clean.tools.length) {
    return { ok: false, reason: 'tools 배열이 없거나 비어 있음' };
  }
  if (!clean.tools.map(normalizeTool).filter(Boolean).length) {
    return { ok: false, reason: '유효한 도구가 없음' };
  }
  const server = normalizeServer(clean, existingIds);
  server.createdAt = clean.createdAt || new Date().toISOString();
  return { ok: true, server };
}
