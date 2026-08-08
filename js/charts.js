/* ═══════════ charts.js — dependency-free SVG charts ═══════════
   line / area / bar / stacked / donut / sparkline / gauge /
   waterfall / heatmap / progress-ring. All responsive via viewBox,
   themed through CSS custom properties, with hover tooltips.
   ═════════════════════════════════════════════════════════════ */

import { h, showTip, hideTip } from './ui.js';
import { fmtMoney, fmtCompact, esc, PALETTE, money } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') { el.textContent = v; continue; }
    if (k.startsWith('on')) { el.addEventListener(k.slice(2).toLowerCase(), v); continue; }
    el.setAttribute(k, v);
  }
  kids.flat(2).filter(Boolean).forEach(k => el.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
}

/** Human-friendly axis bounds. */
export function niceScale(min, max, ticks = 5) {
  if (min === max) { if (min === 0) return { min: 0, max: 1, step: 0.25 }; min = Math.min(0, min * 0.8); max = max * 1.2; }
  const range = max - min;
  const raw = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}
const ticksOf = ({ min, max, step }) => {
  const out = []; for (let v = min; v <= max + step / 1000; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
};
const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
/** Catmull-Rom → cubic Bézier for smooth lines. */
function smoothPath(pts) {
  if (pts.length < 3) return path(pts);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
const gradId = () => 'g' + Math.random().toString(36).slice(2, 8);

function svgRoot(w, hgt) {
  return s('svg', { class: 'chart', viewBox: `0 0 ${w} ${hgt}`, width: '100%',
    style: 'height:auto', preserveAspectRatio: 'xMidYMid meet', role: 'img' });
}

/* ═══════════ LINE / AREA ═══════════ */
/** series: [{name,color,values:number[],area?,dashed?}] ; labels: string[] */
export function lineChart(series, labels, {
  height = 250, width = 760, fmt = v => fmtMoney(v, undefined, { compact: true }),
  smooth = true, showDots = true, yZero = true, legend = true, hLine,
} = {}) {
  const pad = { t: 14, r: 14, b: 26, l: 52 };
  const W = width, H = height;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const flat = series.flatMap(x => x.values).filter(Number.isFinite);
  const sc = niceScale(yZero ? Math.min(0, ...flat, 0) : Math.min(...flat), Math.max(...flat, 0), 5);
  const n = labels.length;
  const X = i => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = v => pad.t + ih - ((v - sc.min) / (sc.max - sc.min || 1)) * ih;

  const svg = svgRoot(W, H);
  const defs = s('defs');
  svg.append(defs);

  ticksOf(sc).forEach(t => {
    svg.append(s('line', { class: 'grid-l', x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t) }));
    svg.append(s('text', { class: 'lbl-y', x: pad.l - 8, y: Y(t) + 3.5, 'text-anchor': 'end', text: fmtCompact(t) }));
  });
  if (hLine != null) svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(hLine), y2: Y(hLine),
    stroke: 'var(--warn)', 'stroke-width': 1.4, 'stroke-dasharray': '5 4', opacity: .8 }));

  const every = Math.max(1, Math.ceil(n / (W > 520 ? 12 : 6)));
  labels.forEach((l, i) => {
    if (i % every && i !== n - 1) return;
    svg.append(s('text', { x: X(i), y: H - 7, 'text-anchor': 'middle', text: l }));
  });

  series.forEach((ser, si) => {
    const color = ser.color || PALETTE[si % PALETTE.length];
    const pts = ser.values.map((v, i) => [X(i), Y(v || 0)]);
    if (ser.area !== false && series.length <= 2) {
      const gid = gradId();
      defs.append(s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
        s('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': .3 }),
        s('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 })));
      svg.append(s('path', { d: `${smooth ? smoothPath(pts) : path(pts)} L${X(n - 1)} ${Y(sc.min)} L${X(0)} ${Y(sc.min)} Z`,
        fill: `url(#${gid})`, stroke: 'none' }));
    }
    svg.append(s('path', { d: smooth ? smoothPath(pts) : path(pts), fill: 'none', stroke: color,
      'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-dasharray': ser.dashed ? '6 5' : null }));
    if (showDots && n <= 40) pts.forEach(([x, y]) => svg.append(
      s('circle', { class: 'pt', cx: x, cy: y, r: n > 20 ? 2 : 3, fill: 'var(--surface)', stroke: color, 'stroke-width': 2 })));
  });

  // hover crosshair
  const hover = s('g', { opacity: 0 });
  const vline = s('line', { y1: pad.t, y2: pad.t + ih, stroke: 'var(--border-2)', 'stroke-width': 1 });
  hover.append(vline);
  const dots = series.map((ser, si) => s('circle', { r: 4.5, fill: ser.color || PALETTE[si % PALETTE.length],
    stroke: 'var(--surface)', 'stroke-width': 2 }));
  dots.forEach(d => hover.append(d));
  svg.append(hover);
  const overlay = s('rect', { x: pad.l, y: pad.t, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' });
  overlay.addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((rel - pad.l) / (iw || 1)) * (n - 1))));
    hover.setAttribute('opacity', 1);
    vline.setAttribute('x1', X(i)); vline.setAttribute('x2', X(i));
    series.forEach((ser, si) => { dots[si].setAttribute('cx', X(i)); dots[si].setAttribute('cy', Y(ser.values[i] || 0)); });
    showTip(`<b>${esc(labels[i])}</b><br>${series.map((ser, si) =>
      `<span style="color:${ser.color || PALETTE[si % PALETTE.length]}">●</span> ${esc(ser.name)}: <b>${fmt(ser.values[i] || 0)}</b>`).join('<br>')}`,
      e.clientX, e.clientY);
  });
  overlay.addEventListener('mouseleave', () => { hover.setAttribute('opacity', 0); hideTip(); });
  svg.append(overlay);

  const box = h('div', {});
  box.append(svg);
  if (legend && series.length > 1) box.append(legendEl(series.map((x, i) => ({ label: x.name, color: x.color || PALETTE[i % PALETTE.length] }))));
  return box;
}

/* ═══════════ BARS (grouped / stacked) ═══════════ */
/** series: [{name,color,values:number[]}] */
export function barChart(series, labels, {
  height = 250, width = 760, stacked = false, fmt = v => fmtMoney(v, undefined, { compact: true }),
  legend = true, horizontal = false,
} = {}) {
  if (horizontal) return hBarChart(series[0], labels, { height, width, fmt });
  const pad = { t: 14, r: 14, b: 28, l: 52 };
  const W = width, H = height, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, sr) => a + (sr.values[i] || 0), 0));
  const maxV = stacked ? Math.max(...totals, 0) : Math.max(...series.flatMap(x => x.values), 0);
  const minV = Math.min(0, ...series.flatMap(x => x.values));
  const sc = niceScale(minV, maxV, 5);
  const Y = v => pad.t + ih - ((v - sc.min) / (sc.max - sc.min || 1)) * ih;
  const bandW = iw / Math.max(n, 1);
  const groupW = bandW * 0.68;
  const barW = stacked ? groupW : groupW / series.length;

  const svg = svgRoot(W, H);
  ticksOf(sc).forEach(t => {
    svg.append(s('line', { class: 'grid-l', x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t) }));
    svg.append(s('text', { class: 'lbl-y', x: pad.l - 8, y: Y(t) + 3.5, 'text-anchor': 'end', text: fmtCompact(t) }));
  });

  const every = Math.max(1, Math.ceil(n / (W > 520 ? 12 : 6)));
  labels.forEach((l, i) => {
    const cx = pad.l + bandW * i + bandW / 2;
    if (i % every === 0 || n <= 14) svg.append(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle', text: l }));
    const g = s('g');
    if (stacked) {
      let acc = 0;
      series.forEach((sr, si) => {
        const v = sr.values[i] || 0;
        const y0 = Y(acc), y1 = Y(acc + v);
        acc += v;
        g.append(s('rect', { class: 'bar-r', x: cx - barW / 2, y: Math.min(y0, y1), width: barW,
          height: Math.max(1, Math.abs(y1 - y0)), fill: sr.color || PALETTE[si % PALETTE.length],
          rx: 3, ry: 3 }));
      });
    } else {
      series.forEach((sr, si) => {
        const v = sr.values[i] || 0;
        const y = Y(Math.max(0, v)), y0 = Y(0);
        g.append(s('rect', { class: 'bar-r', x: cx - groupW / 2 + si * barW, y, width: Math.max(1, barW - 2),
          height: Math.max(1, Math.abs(y0 - y)), fill: sr.color || PALETTE[si % PALETTE.length], rx: 3, ry: 3 }));
      });
    }
    g.append(s('rect', { x: pad.l + bandW * i, y: pad.t, width: bandW, height: ih, fill: 'transparent',
      onmousemove: e => showTip(`<b>${esc(l)}</b><br>${series.map((sr, si) =>
        `<span style="color:${sr.color || PALETTE[si % PALETTE.length]}">●</span> ${esc(sr.name)}: <b>${fmt(sr.values[i] || 0)}</b>`).join('<br>')}${
        stacked && series.length > 1 ? `<br><span class="t3">Total: <b>${fmt(totals[i])}</b></span>` : ''}`, e.clientX, e.clientY),
      onmouseleave: hideTip }));
    svg.append(g);
  });
  svg.append(s('line', { class: 'axis', x1: pad.l, x2: W - pad.r, y1: Y(0), y2: Y(0) }));

  const box = h('div', {});
  box.append(svg);
  if (legend && series.length > 1) box.append(legendEl(series.map((x, i) => ({ label: x.name, color: x.color || PALETTE[i % PALETTE.length] }))));
  return box;
}

/** Horizontal ranked bars — great for category breakdowns. */
export function hBarChart(ser, labels, { width = 760, rowH = 30, fmt = v => fmtMoney(v), colors } = {}) {
  const n = labels.length;
  const H = Math.max(60, n * rowH + 12);
  const labW = Math.min(190, Math.max(...labels.map(l => l.length)) * 6.6 + 12);
  const iw = width - labW - 74;
  const max = Math.max(...ser.values, 1);
  const svg = svgRoot(width, H);
  labels.forEach((l, i) => {
    const y = 6 + i * rowH;
    const v = ser.values[i] || 0;
    const w = Math.max(2, (v / max) * iw);
    const color = colors?.[i] || PALETTE[i % PALETTE.length];
    svg.append(s('text', { x: labW - 8, y: y + rowH / 2 + 3.5, 'text-anchor': 'end', text: l.length > 26 ? l.slice(0, 25) + '…' : l, fill: 'var(--text-2)' }));
    svg.append(s('rect', { x: labW, y: y + 5, width: iw, height: rowH - 14, rx: 5, fill: 'var(--surface-3)' }));
    svg.append(s('rect', { class: 'bar-r', x: labW, y: y + 5, width: w, height: rowH - 14, rx: 5, fill: color,
      onmousemove: e => showTip(`<b>${esc(l)}</b><br>${fmt(v)} · ${((v / (ser.values.reduce((a, b) => a + b, 0) || 1)) * 100).toFixed(1)}%`, e.clientX, e.clientY),
      onmouseleave: hideTip }));
    svg.append(s('text', { x: labW + iw + 8, y: y + rowH / 2 + 3.5, text: fmtCompact(v), fill: 'var(--text-2)' }));
  });
  return h('div', {}, svg);
}

/* ═══════════ DONUT / PIE ═══════════ */
/** data: [{label,value,color}] */
export function donut(data, { size = 230, thickness = 30, centerLabel = 'Total', fmt = v => fmtMoney(v, undefined, { compact: true }), legend = true, max = 8 } = {}) {
  let rows = data.filter(d => d.value > 0);
  if (rows.length > max) {
    const top = rows.slice(0, max - 1);
    const rest = rows.slice(max - 1);
    rows = [...top, { label: `Other (${rest.length})`, value: money(rest.reduce((a, b) => a + b.value, 0)), color: '#94a3b8' }];
  }
  const total = rows.reduce((a, b) => a + b.value, 0);
  const R = size / 2, r = R - thickness;
  const svg = svgRoot(size, size);
  if (!total) {
    svg.append(s('circle', { cx: R, cy: R, r: (R + r) / 2, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': thickness }));
    svg.append(s('text', { class: 'l', x: R, y: R + 4, 'text-anchor': 'middle', text: 'No data', fill: 'var(--text-3)' }));
    return h('div', { class: 'gauge-wrap' }, svg);
  }
  let a0 = -Math.PI / 2;
  rows.forEach((d, i) => {
    const frac = d.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (ang, rad) => [R + rad * Math.cos(ang), R + rad * Math.sin(ang)];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    const color = d.color || PALETTE[i % PALETTE.length];
    const seg = s('path', {
      d: `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`,
      fill: color, style: 'transition:opacity .15s,transform .15s;transform-origin:center',
      onmouseenter: e => { e.target.style.opacity = .82; },
      onmousemove: e => showTip(`<b>${esc(d.label)}</b><br>${fmt(d.value)} · ${(frac * 100).toFixed(1)}%`, e.clientX, e.clientY),
      onmouseleave: e => { e.target.style.opacity = 1; hideTip(); },
    });
    svg.append(seg);
    a0 = a1;
  });
  svg.append(s('text', { class: 'donut-center v', x: R, y: R - 1, 'text-anchor': 'middle', text: fmt(total), fill: 'var(--text)', style: 'font-size:17px;font-weight:700' }));
  svg.append(s('text', { class: 'donut-center l', x: R, y: R + 15, 'text-anchor': 'middle', text: centerLabel, fill: 'var(--text-3)', style: 'font-size:10px' }));

  const box = h('div', { class: 'gauge-wrap' });
  box.append(svg);
  if (legend) box.append(legendEl(rows.map((d, i) => ({
    label: d.label, color: d.color || PALETTE[i % PALETTE.length],
    note: `${((d.value / total) * 100).toFixed(0)}%`,
  }))));
  return box;
}

export function legendEl(items) {
  return h('div', { class: 'chart-legend' }, ...items.map(it =>
    h('div', { class: 'it' },
      h('span', { class: 'sw', style: { background: it.color } }),
      h('span', { text: it.label }),
      it.note ? h('span', { class: 't3', text: it.note }) : null)));
}

/* ═══════════ SPARKLINE ═══════════ */
export function sparkline(values, { width = 120, height = 32, color = 'var(--accent)', fill = true, strokeW = 1.8 } = {}) {
  if (!values.length) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const rng = max - min || 1;
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * width, height - 2 - ((v - min) / rng) * (height - 5)]);
  const d = smoothPath(pts);
  const gid = gradId();
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" style="display:block">
    ${fill ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".28"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${width} ${height} L0 ${height} Z" fill="url(#${gid})"/>` : ''}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ═══════════ PROGRESS RING / GAUGE ═══════════ */
export function ring(pct, { size = 128, thickness = 11, color, label, value, track = 'var(--surface-3)' } = {}) {
  const p = Math.max(0, Math.min(100, pct));
  const R = (size - thickness) / 2, C = 2 * Math.PI * R;
  const col = color || (p >= 100 ? 'var(--pos)' : p >= 75 ? 'var(--warn)' : 'var(--accent)');
  const svg = svgRoot(size, size);
  svg.append(s('circle', { cx: size / 2, cy: size / 2, r: R, fill: 'none', stroke: track, 'stroke-width': thickness }));
  svg.append(s('circle', { cx: size / 2, cy: size / 2, r: R, fill: 'none', stroke: col, 'stroke-width': thickness,
    'stroke-linecap': 'round', 'stroke-dasharray': `${(C * p) / 100} ${C}`,
    transform: `rotate(-90 ${size / 2} ${size / 2})`, style: 'transition:stroke-dasharray .8s cubic-bezier(.16,1,.3,1)' }));
  // The SVG carries width:100% so charts can fill a card, which means `size` is
  // only a viewBox unless the wrapper pins it. Without this the ring inflates to
  // whatever space it is given and squeezes its siblings out of the card.
  return h('div', { class: 'score-ring', style: { width: `${size}px`, maxWidth: '100%', flex: 'none' } }, svg,
    h('div', { class: 'n' }, h('b', { text: value ?? `${Math.round(p)}%` }), label ? h('small', { text: label }) : null));
}

/** Semi-circular gauge with coloured zones — used for the health score. */
export function gauge(value, { size = 210, min = 0, max = 100, label = '', zones } = {}) {
  const W = size, H = size * 0.62;
  const cx = W / 2, cy = H - 6, R = W / 2 - 16, th = 15;
  const svg = svgRoot(W, H);
  const ang = v => Math.PI + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * Math.PI;
  const arc = (a0, a1, color, w = th) => {
    const p = (a, rad) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R);
    return s('path', { d: `M${x0} ${y0} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`,
      fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round' });
  };
  const zs = zones || [[0, 40, 'var(--neg)'], [40, 70, 'var(--warn)'], [70, 100, 'var(--pos)']];
  zs.forEach(([a, b, c]) => svg.append(arc(ang(a), ang(b), c, th - 4)));
  svg.append(arc(ang(min), ang(value), 'var(--accent)', 5));
  const a = ang(value);
  svg.append(s('circle', { cx: cx + R * Math.cos(a), cy: cy + R * Math.sin(a), r: 7, fill: 'var(--surface)', stroke: 'var(--accent)', 'stroke-width': 3.4 }));
  svg.append(s('text', { x: cx, y: cy - 20, 'text-anchor': 'middle', text: Math.round(value), fill: 'var(--text)', style: 'font-size:30px;font-weight:700' }));
  svg.append(s('text', { x: cx, y: cy - 3, 'text-anchor': 'middle', text: label, fill: 'var(--text-3)', style: 'font-size:11px' }));
  return h('div', { class: 'gauge-wrap' }, svg);
}

/* ═══════════ WATERFALL ═══════════ */
/** steps: [{label,value,isTotal?}] */
export function waterfall(steps, { width = 760, height = 250, fmt = v => fmtMoney(v, undefined, { compact: true }) } = {}) {
  const pad = { t: 16, r: 14, b: 34, l: 56 };
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  let run = 0;
  const bars = steps.map(st => {
    if (st.isTotal) { const b = { ...st, from: 0, to: st.value ?? run }; run = b.to; return b; }
    const from = run; run += st.value; return { ...st, from, to: run };
  });
  const vals = bars.flatMap(b => [b.from, b.to]);
  const sc = niceScale(Math.min(0, ...vals), Math.max(0, ...vals), 5);
  const Y = v => pad.t + ih - ((v - sc.min) / (sc.max - sc.min || 1)) * ih;
  const bw = (iw / bars.length) * 0.6;
  const svg = svgRoot(width, height);
  ticksOf(sc).forEach(t => {
    svg.append(s('line', { class: 'grid-l', x1: pad.l, x2: width - pad.r, y1: Y(t), y2: Y(t) }));
    svg.append(s('text', { class: 'lbl-y', x: pad.l - 8, y: Y(t) + 3.5, 'text-anchor': 'end', text: fmtCompact(t) }));
  });
  bars.forEach((b, i) => {
    const cx = pad.l + (iw / bars.length) * (i + 0.5);
    const y0 = Y(b.from), y1 = Y(b.to);
    const color = b.isTotal ? 'var(--accent)' : (b.to >= b.from ? 'var(--pos)' : 'var(--neg)');
    svg.append(s('rect', { class: 'bar-r', x: cx - bw / 2, y: Math.min(y0, y1), width: bw,
      height: Math.max(2, Math.abs(y1 - y0)), rx: 4, fill: color,
      onmousemove: e => showTip(`<b>${esc(b.label)}</b><br>${fmt(b.isTotal ? b.to : b.value)}`, e.clientX, e.clientY),
      onmouseleave: hideTip }));
    if (i < bars.length - 1 && !bars[i + 1].isTotal)
      svg.append(s('line', { x1: cx + bw / 2, x2: cx + (iw / bars.length) - bw / 2, y1: Y(b.to), y2: Y(b.to),
        stroke: 'var(--border-2)', 'stroke-dasharray': '3 3' }));
    svg.append(s('text', { x: cx, y: height - 12, 'text-anchor': 'middle',
      text: b.label.length > 12 ? b.label.slice(0, 11) + '…' : b.label }));
  });
  svg.append(s('line', { class: 'axis', x1: pad.l, x2: width - pad.r, y1: Y(0), y2: Y(0) }));
  return h('div', {}, svg);
}

/* ═══════════ HEATMAP (calendar-style) ═══════════ */
/** cells: [{key,value,label}] laid out in weeks. */
export function heatmap(cells, { cols = 53, cell = 12, gap = 3, color = 'var(--accent)', fmt = v => fmtMoney(v) } = {}) {
  const max = Math.max(...cells.map(c => Math.abs(c.value)), 1);
  const rows = 7;
  const W = cols * (cell + gap), H = rows * (cell + gap);
  const svg = svgRoot(W, H);
  cells.forEach((c, i) => {
    const col = Math.floor(i / rows), row = i % rows;
    const intensity = Math.abs(c.value) / max;
    svg.append(s('rect', { x: col * (cell + gap), y: row * (cell + gap), width: cell, height: cell, rx: 3,
      fill: c.value ? color : 'var(--surface-3)', opacity: c.value ? 0.18 + intensity * 0.82 : 1,
      onmousemove: e => showTip(`<b>${esc(c.label || c.key)}</b><br>${fmt(c.value)}`, e.clientX, e.clientY),
      onmouseleave: hideTip }));
  });
  return h('div', { style: { overflowX: 'auto' } }, svg);
}

/* ═══════════ STACKED AREA ═══════════ */
export function stackedArea(series, labels, { height = 250, width = 760, fmt = v => fmtMoney(v, undefined, { compact: true }) } = {}) {
  const pad = { t: 14, r: 14, b: 26, l: 52 };
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, sr) => a + (sr.values[i] || 0), 0));
  const sc = niceScale(0, Math.max(...totals, 1), 5);
  const X = i => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = v => pad.t + ih - ((v - sc.min) / (sc.max - sc.min || 1)) * ih;
  const svg = svgRoot(width, height);
  ticksOf(sc).forEach(t => {
    svg.append(s('line', { class: 'grid-l', x1: pad.l, x2: width - pad.r, y1: Y(t), y2: Y(t) }));
    svg.append(s('text', { class: 'lbl-y', x: pad.l - 8, y: Y(t) + 3.5, 'text-anchor': 'end', text: fmtCompact(t) }));
  });
  const acc = new Array(n).fill(0);
  series.forEach((sr, si) => {
    const lower = acc.map((v, i) => [X(i), Y(v)]);
    sr.values.forEach((v, i) => { acc[i] += v || 0; });
    const upper = acc.map((v, i) => [X(i), Y(v)]);
    const color = sr.color || PALETTE[si % PALETTE.length];
    svg.append(s('path', { d: `${path(upper)} ${path([...lower].reverse()).replace('M', 'L')} Z`, fill: color, opacity: .75,
      onmousemove: e => showTip(`<b>${esc(sr.name)}</b>`, e.clientX, e.clientY), onmouseleave: hideTip }));
  });
  const every = Math.max(1, Math.ceil(n / 12));
  labels.forEach((l, i) => { if (i % every === 0 || i === n - 1) svg.append(s('text', { x: X(i), y: height - 7, 'text-anchor': 'middle', text: l })); });
  const box = h('div', {});
  box.append(svg);
  box.append(legendEl(series.map((x, i) => ({ label: x.name, color: x.color || PALETTE[i % PALETTE.length] }))));
  void fmt;
  return box;
}
