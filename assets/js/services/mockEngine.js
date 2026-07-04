// MCP 모의 실행 엔진 — outputSchema 기반 결정적 응답 생성
// 시드 = hash(serverId + toolName + params) → 같은 입력이면 항상 같은 출력

/* ---------- 결정적 의사난수 ---------- */
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 도메인 값 풀 ---------- */
const POOLS = {
  station: ['서울', '용산', '대전', '동대구', '부산', '광주송정', '오송', '천안아산', '익산', '전주', '강릉', '평창', '행신', '수서', '울산', '포항', '여수엑스포'],
  city: ['서울', '부산', '대전', '대구', '광주', '인천', '울산', '세종'],
  line: ['경부선', '호남선', '경전선', '전라선', '중앙선', '경강선', '2호선', '9호선', '수인분당선', '신분당선'],
  trainNo: () => ['KTX-', 'ITX-', 'M-', 'F-'][Math.floor(Math.random() * 0)] , // 미사용(아래 gen에서 처리)
  personName: ['김민준', '이서연', '박지훈', '최수아', '정도윤', '한예은'],
  facility: ['교량', '터널', '신호기', '선로전환기', '전차선', '승강장 스크린도어', '레일', '침목'],
  status: ['정상', '주의', '점검중', '경미지연', '운행중'],
  company: ['한국철도공사', 'SR', '서울교통공사', '인천교통공사', '국가철도공단'],
  weather: ['맑음', '구름많음', '흐림', '비', '눈', '안개'],
};

function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function genTime(rand) { return `${pad(Math.floor(rand() * 24))}:${pad(Math.floor(rand() * 12) * 5)}`; }
function genDate(rand) {
  const d = new Date(Date.now() + Math.floor(rand() * 14) * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function genDateTime(rand) { return `${genDate(rand)}T${genTime(rand)}:00`; }

/** 필드명 휴리스틱으로 도메인 인지 문자열 생성 */
function genString(rand, key = '', prop = {}) {
  if (prop.enum?.length) return pick(rand, prop.enum);
  if (prop.format === 'date') return genDate(rand);
  if (prop.format === 'date-time') return genDateTime(rand);
  if (prop.format === 'time') return genTime(rand);
  if (prop.examples?.length) return pick(rand, prop.examples);
  const k = key.toLowerCase();
  if (/(station|origin|destination|depart.*station|arriv.*station|from|to)$/.test(k) || k.includes('station')) return pick(rand, POOLS.station);
  if (k.includes('city') || k.includes('region')) return pick(rand, POOLS.city);
  if (k.includes('line') || k.includes('route')) return pick(rand, POOLS.line);
  if (k.includes('train') && (k.includes('no') || k.includes('num') || k.includes('id'))) return 'KTX-' + (100 + Math.floor(rand() * 900));
  if (k.includes('time') || k.includes('departure') || k.includes('arrival')) return genTime(rand);
  if (k.includes('date') || k.includes('day')) return genDate(rand);
  if (k.includes('name') && k.includes('passenger')) return pick(rand, POOLS.personName);
  if (k.includes('facility') || k.includes('asset') || k.includes('equipment')) return pick(rand, POOLS.facility);
  if (k.includes('status') || k.includes('state')) return pick(rand, POOLS.status);
  if (k.includes('operator') || k.includes('company') || k.includes('agency')) return pick(rand, POOLS.company);
  if (k.includes('weather') || k.includes('condition')) return pick(rand, POOLS.weather);
  if (k.includes('id') || k.includes('code') || k.includes('no')) return 'ID-' + Math.floor(rand() * 90000 + 10000);
  if (k.includes('message') || k.includes('desc') || k.includes('summary') || k.includes('note')) {
    return pick(rand, ['정상 처리되었습니다.', '조회 결과입니다.', '요청이 접수되었습니다.', '데이터가 갱신되었습니다.']);
  }
  if (k.includes('url') || k.includes('link')) return 'https://rail.example.kr/' + Math.floor(rand() * 9999);
  return pick(rand, ['샘플값-' + Math.floor(rand() * 100), '데이터-' + Math.floor(rand() * 100)]);
}

function genNumber(rand, key = '', prop = {}, integer = false) {
  let min = prop.minimum ?? 0;
  let max = prop.maximum;
  const k = key.toLowerCase();
  if (max === undefined) {
    if (k.includes('fare') || k.includes('price') || k.includes('amount') || k.includes('cost')) { min = 2000; max = 89000; }
    else if (k.includes('lat')) { min = 34; max = 38; }
    else if (k.includes('lon') || k.includes('lng')) { min = 126; max = 130; }
    else if (k.includes('percent') || k.includes('rate') || k.includes('ratio')) { min = 0; max = 100; }
    else if (k.includes('temp')) { min = -12; max = 34; }
    else if (k.includes('speed')) { min = 0; max = 305; }
    else if (k.includes('count') || k.includes('num') || k.includes('total')) { min = 0; max = 500; }
    else if (k.includes('delay')) { min = 0; max = 45; }
    else { min = 0; max = 1000; }
  }
  const v = min + rand() * (max - min);
  if (integer || (k.includes('fare') || k.includes('price'))) {
    const iv = Math.round(v);
    return (k.includes('fare') || k.includes('price')) ? Math.round(iv / 100) * 100 : iv;
  }
  return Math.round(v * 100) / 100;
}

/** 스키마 순회 값 생성 */
function genValue(rand, schema = {}, key = '', depth = 0) {
  if (depth > 6) return null;
  if (schema.enum?.length) return pick(rand, schema.enum);
  switch (schema.type) {
    case 'object': {
      const out = {};
      for (const [k, p] of Object.entries(schema.properties || {})) out[k] = genValue(rand, p, k, depth + 1);
      return out;
    }
    case 'array': {
      const n = 2 + Math.floor(rand() * 3); // 2~4개
      return Array.from({ length: n }, () => genValue(rand, schema.items || { type: 'string' }, key.replace(/s$/, ''), depth + 1));
    }
    case 'integer': return genNumber(rand, key, schema, true);
    case 'number': return genNumber(rand, key, schema, false);
    case 'boolean': return rand() > 0.35;
    case 'string':
    default: return genString(rand, key, schema);
  }
}

/** params 값을 출력에 자연스럽게 반영 (동일 키/유사 키 문자열 필드 치환) */
function reflectParams(output, params, depth = 0) {
  if (!output || typeof output !== 'object' || !params || depth > 5) return output;
  const paramEntries = Object.entries(params).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
  const walk = (node, d) => {
    if (!node || typeof node !== 'object' || d > 6) return;
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (val && typeof val === 'object') { walk(val, d + 1); continue; }
      for (const [pk, pv] of paramEntries) {
        if (key === pk || key.toLowerCase() === pk.toLowerCase()) node[key] = pv;
        else if (typeof val === 'string' && (
          (pk === 'from' && /^(departure(Station)?|origin)$/i.test(key)) ||
          (pk === 'to' && /^(arrival(Station)?|destination)$/i.test(key)) ||
          (pk === 'date' && /date/i.test(key))
        )) node[key] = pv;
      }
    }
  };
  walk(output, depth);
  return output;
}

/** 단일 값의 타입/범위/enum 검사 — path 는 오류 메시지용 필드 경로(예 "cargo.weight") */
function checkValue(path, prop, v, errors, depth) {
  if (prop.enum && !prop.enum.includes(v)) {
    errors.push(`${path}: 허용값(${prop.enum.join(', ')}) 중 하나여야 합니다`);
    return;
  }
  const t = prop.type;
  if (t === 'string') {
    if (typeof v !== 'string') errors.push(`${path}: 문자열이어야 합니다`);
  } else if (t === 'number' || t === 'integer') {
    let num = v;
    if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) num = Number(v); // 숫자 문자열 허용
    if (typeof num !== 'number' || Number.isNaN(num)) { errors.push(`${path}: 숫자여야 합니다`); return; }
    if (prop.minimum !== undefined && num < prop.minimum) errors.push(`${path}: 최소값 ${prop.minimum} 미만`);
    if (prop.maximum !== undefined && num > prop.maximum) errors.push(`${path}: 최대값 ${prop.maximum} 초과`);
  } else if (t === 'boolean') {
    if (typeof v !== 'boolean') errors.push(`${path}: 불리언이어야 합니다`);
  } else if (t === 'array') {
    if (!Array.isArray(v)) { errors.push(`${path}: 배열이어야 합니다`); return; }
    const items = prop.items;
    if (items && items.type && depth < 2) {
      const n = Math.min(v.length, 20); // 원소별 타입 검사(최대 20개)
      for (let i = 0; i < n; i++) {
        if (items.type === 'object') {
          // 배열 원소가 object면 내부 required/타입도 1단계 검사
          if (!v[i] || typeof v[i] !== 'object' || Array.isArray(v[i])) errors.push(`${path}[${i}]: 객체여야 합니다`);
          else checkObjectParams(items, v[i], `${path}[${i}]`, errors, depth + 1);
        } else {
          checkValue(`${path}[${i}]`, items, v[i], errors, depth + 1);
        }
      }
    }
  } else if (t === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(`${path}: 객체여야 합니다`); return; }
    if (depth < 1) checkObjectParams(prop, v, path, errors, depth + 1); // 중첩 object 1단계 재귀
  }
}

/** object 스키마에 대한 required/타입 검사(재귀). basePath 가 비면 최상위 */
function checkObjectParams(schema, obj, basePath, errors, depth) {
  const props = schema.properties || {};
  for (const r of schema.required || []) {
    const val = obj?.[r];
    if (val === undefined || val === null || val === '') {
      errors.push(basePath ? `${basePath}.${r}: 필수 항목 누락` : `필수 파라미터 누락: ${r}`);
    }
  }
  for (const [k, v] of Object.entries(obj || {})) {
    const p = props[k];
    if (!p) continue; // 정의되지 않은 파라미터는 허용(관대한 모의 환경)
    if (v === undefined || v === null) continue;
    checkValue(basePath ? `${basePath}.${k}` : k, p, v, errors, depth);
  }
}

/** 파라미터 유효성 검사 — required/type/enum/min·max/중첩 object·array items */
export function validateParams(tool, params = {}) {
  const errors = [];
  checkObjectParams(tool.inputSchema || {}, params || {}, '', errors, 0);
  return { ok: errors.length === 0, errors };
}

/** 값이 스키마 type 과 얕게 일치하는지 */
function shallowTypeOk(v, type) {
  switch (type) {
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': case 'integer': return typeof v === 'number';
    case 'boolean': return typeof v === 'boolean';
    default: return true;
  }
}

/** 샘플이 outputSchema와 얕게 부합하는지 — required 존재 + 샘플에 존재하는 모든 정의 필드의 타입 검사 */
function sampleMatchesSchema(sample, schema) {
  if (!schema || schema.type !== 'object' || !schema.properties) return true; // 스키마 정보 부족 → 통과
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return false;
  for (const r of schema.required || []) {
    if (!(r in sample)) return false;
  }
  for (const [k, v] of Object.entries(sample)) {
    const p = schema.properties[k];
    if (p && p.type && v !== null && v !== undefined && !shallowTypeOk(v, p.type)) return false;
  }
  return true;
}

/**
 * MCP tool 모의 실행
 * @param {object} server MCP 서버
 * @param {string} toolName 도구명
 * @param {object} params 파라미터
 * @param {{signal?: AbortSignal}} [opts] 중단 신호(선택)
 * @returns {Promise<{output, latencyMs}>}
 */
export async function executeTool(server, toolName, params = {}, { signal } = {}) {
  const tool = (server?.tools || []).find(t => t.name === toolName);
  if (!tool) throw new Error(`도구를 찾을 수 없습니다: ${server?.id}/${toolName}`);
  if (signal?.aborted) throw new DOMException('중단됨', 'AbortError');

  const seed = strHash(server.id + '|' + toolName + '|' + JSON.stringify(params ?? {}));
  const rand = mulberry32(seed);
  const fallbackSchema = tool.outputSchema || { type: 'object', properties: { result: { type: 'string' } } };

  let output;
  if (tool.mock?.samples?.length) {
    const sample = pick(rand, tool.mock.samples);
    // 샘플이 outputSchema 최상위 required 와 어긋나면 스키마 기반 생성으로 폴백
    output = sampleMatchesSchema(sample, tool.outputSchema)
      ? JSON.parse(JSON.stringify(sample))
      : genValue(rand, fallbackSchema);
    output = reflectParams(output, params);
  } else {
    output = genValue(rand, fallbackSchema);
    output = reflectParams(output, params);
  }

  const [minL, maxL] = tool.mock?.latencyMs || [80, 500];
  const latencyMs = Math.round(minL + rand() * (maxL - minL));

  // 체감용 대기(상한 1.5s) — 대기 중 signal abort 시 즉시 중단
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve(); }, Math.min(latencyMs, 1500));
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(new DOMException('중단됨', 'AbortError')); };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });

  return { output, latencyMs };
}
