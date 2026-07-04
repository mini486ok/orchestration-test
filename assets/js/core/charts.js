// 경량 SVG 차트 라이브러리 — 외부 의존성 없음, 디자인 토큰 색상 사용
import { el } from './ui.js';

export const SERIES_COLORS = ['#31d07c', '#4da3ff', '#f4b63f', '#a78bfa', '#f06a5d', '#3ecfcf', '#e879a7', '#9db35c'];

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const AXIS = '#3a4f6b';
const GRID = 'rgba(34,51,73,.6)';
const TEXT = '#7488a1';
const TEXT_STRONG = '#b9c6d8';

function legend(items) {
  return el('div', { class: 'chart-legend' },
    items.map(it => el('span', { class: 'lg-item' },
      el('span', { class: 'lg-swatch', style: { background: it.color } }),
      it.label)));
}

/**
 * 그룹 막대 차트 — 지표별로 여러 시리즈(전략) 비교
 * groups: [{ label, values: number[] }], series: [{ label }], opts: { max=1, fmt, height }
 */
export function groupedBarChart(groups, series, { max = 1, height = 260, fmtVal = (v) => (v * 100).toFixed(0) + '%' } = {}) {
  const W = Math.max(460, groups.length * (series.length * 34 + 46) + 70);
  const H = height, padL = 46, padB = 34, padT = 16, padR = 8;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMinYMid meet' });

  // 그리드 + Y라벨
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4;
    const y = padT + plotH - (plotH * i / 4);
    svg.appendChild(svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: i === 0 ? AXIS : GRID, 'stroke-width': 1 }));
    const t = svgEl('text', { x: padL - 7, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: TEXT, 'font-family': 'IBM Plex Mono, monospace' });
    t.textContent = fmtVal(v);
    svg.appendChild(t);
  }

  const groupW = plotW / groups.length;
  const barW = Math.min(26, (groupW - 22) / series.length);
  groups.forEach((g, gi) => {
    const gx = padL + groupW * gi + (groupW - barW * series.length) / 2;
    g.values.forEach((v, si) => {
      const val = Math.max(0, Math.min(max, v ?? 0));
      const bh = plotH * (val / max);
      const x = gx + si * barW;
      const y = padT + plotH - bh;
      const rect = svgEl('rect', {
        x, y: padT + plotH, width: Math.max(barW - 5, 4), height: 0, rx: 3,
        fill: SERIES_COLORS[si % SERIES_COLORS.length], opacity: .92,
      });
      rect.appendChild(svgEl('title', {}, `${g.label} · ${series[si].label}: ${fmtVal(v ?? 0)}`));
      svg.appendChild(rect);
      // 등장 애니메이션
      requestAnimationFrame(() => {
        rect.style.transition = `y .5s cubic-bezier(.22,.9,.35,1) ${si * 60}ms, height .5s cubic-bezier(.22,.9,.35,1) ${si * 60}ms`;
        rect.setAttribute('y', y); rect.setAttribute('height', Math.max(bh, val > 0 ? 2 : 0));
      });
    });
    const t = svgEl('text', { x: padL + groupW * gi + groupW / 2, y: H - 12, 'text-anchor': 'middle', 'font-size': 11, fill: TEXT_STRONG });
    t.textContent = g.label;
    svg.appendChild(t);
  });

  return el('div', { class: 'chart-box' }, svg, legend(series.map((s, i) => ({ label: s.label, color: SERIES_COLORS[i % SERIES_COLORS.length] }))));
}

/**
 * 레이더 차트 — 전략별 다차원 지표 비교
 * axes: [{ label }], series: [{ label, values: number[] (0~1) }]
 */
export function radarChart(axes, series, { size = 300 } = {}) {
  const C = size / 2, R = size / 2 - 46;
  const n = axes.length;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: size, style: 'max-width:420px;margin:0 auto;display:block' });
  const angle = (i) => (Math.PI * 2 * i / n) - Math.PI / 2;
  const pt = (i, r) => [C + Math.cos(angle(i)) * r, C + Math.sin(angle(i)) * r];

  // 배경 웹
  for (let ring = 1; ring <= 4; ring++) {
    const r = R * ring / 4;
    const points = Array.from({ length: n }, (_, i) => pt(i, r).join(',')).join(' ');
    svg.appendChild(svgEl('polygon', { points, fill: ring === 4 ? 'rgba(26,38,55,.28)' : 'none', stroke: GRID, 'stroke-width': 1 }));
  }
  // 축선 + 라벨
  axes.forEach((a, i) => {
    const [x, y] = pt(i, R);
    svg.appendChild(svgEl('line', { x1: C, y1: C, x2: x, y2: y, stroke: GRID }));
    const [lx, ly] = pt(i, R + 22);
    const t = svgEl('text', {
      x: lx, y: ly + 4, 'text-anchor': 'middle', 'font-size': 10.5, fill: TEXT_STRONG,
    });
    t.textContent = a.label;
    svg.appendChild(t);
  });
  // 시리즈
  series.forEach((s, si) => {
    const color = SERIES_COLORS[si % SERIES_COLORS.length];
    const points = s.values.map((v, i) => pt(i, R * Math.max(0, Math.min(1, v ?? 0))).join(',')).join(' ');
    const poly = svgEl('polygon', { points, fill: color, 'fill-opacity': .13, stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    poly.appendChild(svgEl('title', {}, s.label));
    svg.appendChild(poly);
    s.values.forEach((v, i) => {
      const [x, y] = pt(i, R * Math.max(0, Math.min(1, v ?? 0)));
      const c = svgEl('circle', { cx: x, cy: y, r: 3.2, fill: color });
      c.appendChild(svgEl('title', {}, `${s.label} · ${axes[i].label}: ${((v ?? 0) * 100).toFixed(1)}%`));
      svg.appendChild(c);
    });
  });

  return el('div', { class: 'chart-box' }, svg, legend(series.map((s, i) => ({ label: s.label, color: SERIES_COLORS[i % SERIES_COLORS.length] }))));
}

/**
 * 수평 막대 차트 — 단일 지표 순위 비교
 * items: [{ label, value, color? }], opts { max, fmt }
 */
export function hBarChart(items, { max = 1, fmtVal = (v) => (v * 100).toFixed(1) + '%', height } = {}) {
  const rowH = 34, padL = 8, W = 520;
  const H = height || items.length * rowH + 8;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', preserveAspectRatio: 'xMinYMin meet' });
  const labelW = 150, barMax = W - labelW - 74;

  items.forEach((it, i) => {
    const y = i * rowH + 6;
    const color = it.color || SERIES_COLORS[i % SERIES_COLORS.length];
    const t = svgEl('text', { x: padL, y: y + 15, 'font-size': 11.5, fill: TEXT_STRONG });
    t.textContent = it.label.length > 14 ? it.label.slice(0, 13) + '…' : it.label;
    t.appendChild(svgEl('title', {}, it.label));
    svg.appendChild(t);
    svg.appendChild(svgEl('rect', { x: labelW, y: y + 4, width: barMax, height: 14, rx: 4, fill: 'rgba(7,11,18,.8)', stroke: GRID }));
    const w = barMax * Math.max(0, Math.min(1, (it.value ?? 0) / max));
    const bar = svgEl('rect', { x: labelW, y: y + 4, width: 0, height: 14, rx: 4, fill: color, opacity: .9 });
    svg.appendChild(bar);
    requestAnimationFrame(() => {
      bar.style.transition = `width .6s cubic-bezier(.22,.9,.35,1) ${i * 70}ms`;
      bar.setAttribute('width', Math.max(w, (it.value ?? 0) > 0 ? 3 : 0));
    });
    const v = svgEl('text', { x: labelW + barMax + 8, y: y + 15, 'font-size': 11, fill: TEXT, 'font-family': 'IBM Plex Mono, monospace' });
    v.textContent = fmtVal(it.value ?? 0);
    svg.appendChild(v);
  });

  return el('div', { class: 'chart-box' }, svg);
}

/** 도넛 차트 — 구성비 */
export function donutChart(items, { size = 170, centerLabel = '' } = {}) {
  const C = size / 2, R = size / 2 - 12, SW = 20;
  const total = items.reduce((s, it) => s + (it.value || 0), 0) || 1;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, style: 'margin:0 auto;display:block' });
  let acc = -Math.PI / 2;
  items.forEach((it, i) => {
    const frac = (it.value || 0) / total;
    if (frac <= 0) return;
    const a0 = acc, a1 = acc + frac * Math.PI * 2;
    acc = a1;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const p0 = [C + Math.cos(a0) * R, C + Math.sin(a0) * R];
    const p1 = [C + Math.cos(a1) * R, C + Math.sin(a1) * R];
    const path = frac >= 0.999
      ? svgEl('circle', { cx: C, cy: C, r: R, fill: 'none', stroke: it.color || SERIES_COLORS[i % SERIES_COLORS.length], 'stroke-width': SW })
      : svgEl('path', {
          d: `M ${p0[0]} ${p0[1]} A ${R} ${R} 0 ${large} 1 ${p1[0]} ${p1[1]}`,
          fill: 'none', stroke: it.color || SERIES_COLORS[i % SERIES_COLORS.length], 'stroke-width': SW, 'stroke-linecap': 'butt',
        });
    path.appendChild(svgEl('title', {}, `${it.label}: ${it.value}`));
    svg.appendChild(path);
  });
  if (centerLabel) {
    const t = svgEl('text', { x: C, y: C + 5, 'text-anchor': 'middle', 'font-size': 14, fill: TEXT_STRONG, 'font-family': 'IBM Plex Mono, monospace', 'font-weight': 600 });
    t.textContent = centerLabel;
    svg.appendChild(t);
  }
  return el('div', {}, svg, legend(items.map((it, i) => ({ label: `${it.label} (${it.value})`, color: it.color || SERIES_COLORS[i % SERIES_COLORS.length] }))));
}
