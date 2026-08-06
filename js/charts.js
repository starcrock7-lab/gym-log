// Inline SVG charts. A line and a bar chart do not justify a charting library,
// and a hand-rolled one is guaranteed to work offline.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) || magnitude * 10;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return ticks;
}

const shortDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// points: [{ x: epoch ms, y: number, label? }]
export function lineChart(points, { height = 190, format = (v) => String(Math.round(v)) } = {}) {
  const width = 340;
  const pad = { top: 12, right: 10, bottom: 22, left: 40 };

  if (!points.length) {
    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart' });
    const text = el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'axis-label' });
    text.textContent = 'No data in this range';
    svg.append(text);
    return svg;
  }

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const xs = sorted.map((p) => p.x);
  const ys = sorted.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  // A flat series must not collapse to a zero-height band, and a single point
  // must still be visible rather than dividing by zero.
  const rawMin = Math.min(...ys);
  const rawMax = Math.max(...ys);
  const span = rawMax - rawMin || Math.max(rawMax * 0.1, 1);
  const yMin = Math.max(0, rawMin - span * 0.15);
  const yMax = rawMax + span * 0.15;

  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const sx = (x) => (xMax === xMin ? pad.left + plotW / 2 : pad.left + ((x - xMin) / (xMax - xMin)) * plotW);
  const sy = (y) => pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', preserveAspectRatio: 'none' });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const defs = el('defs');
  const grad = el('linearGradient', { id: 'chart-fade', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(el('stop', { offset: '0%', 'stop-color': '#3b82f6', 'stop-opacity': '0.28' }));
  grad.append(el('stop', { offset: '100%', 'stop-color': '#3b82f6', 'stop-opacity': '0' }));
  defs.append(grad);
  svg.append(defs);

  for (const tick of niceTicks(yMin, yMax)) {
    const y = sy(tick);
    svg.append(el('line', { class: 'grid-line', x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
    const label = el('text', { class: 'axis-label', x: pad.left - 6, y: y + 3, 'text-anchor': 'end' });
    label.textContent = format(tick);
    svg.append(label);
  }

  const d = sorted.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  svg.append(el('path', {
    class: 'area',
    d: `${d} L${sx(xMax).toFixed(1)},${pad.top + plotH} L${sx(xMin).toFixed(1)},${pad.top + plotH} Z`,
  }));
  svg.append(el('path', { class: 'series', d }));

  // Dots only when they will not turn the line into a caterpillar.
  if (sorted.length <= 40) {
    for (const p of sorted) svg.append(el('circle', { class: 'dot', cx: sx(p.x), cy: sy(p.y), r: sorted.length > 20 ? 1.8 : 2.6 }));
  }

  for (const [i, x] of [xMin, xMax].entries()) {
    if (xMin === xMax && i === 1) break;
    const label = el('text', { class: 'axis-label', x: sx(x), y: height - 6, 'text-anchor': i === 0 ? 'start' : 'end' });
    label.textContent = shortDate(x);
    svg.append(label);
  }

  return svg;
}

// bars: [{ label, value }]
export function barChart(bars, { height = 150, format = (v) => String(Math.round(v)) } = {}) {
  const width = 340;
  const pad = { top: 10, right: 8, bottom: 20, left: 40 };
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart' });

  if (!bars.length) {
    const text = el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'axis-label' });
    text.textContent = 'No data in this range';
    svg.append(text);
    return svg;
  }

  const max = Math.max(...bars.map((b) => b.value), 1);
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / bars.length;
  const barW = Math.max(3, Math.min(26, slot * 0.62));

  for (const tick of niceTicks(0, max, 3)) {
    const y = pad.top + plotH - (tick / max) * plotH;
    svg.append(el('line', { class: 'grid-line', x1: pad.left, y1: y, x2: width - pad.right, y2: y }));
    const label = el('text', { class: 'axis-label', x: pad.left - 6, y: y + 3, 'text-anchor': 'end' });
    label.textContent = format(tick);
    svg.append(label);
  }

  bars.forEach((bar, i) => {
    const h = (bar.value / max) * plotH;
    const x = pad.left + slot * i + (slot - barW) / 2;
    svg.append(el('rect', { class: 'bar', x, y: pad.top + plotH - h, width: barW, height: Math.max(h, bar.value > 0 ? 2 : 0), rx: 2 }));
    if (bars.length <= 8) {
      const label = el('text', { class: 'axis-label', x: x + barW / 2, y: height - 6, 'text-anchor': 'middle' });
      label.textContent = bar.label;
      svg.append(label);
    }
  });

  return svg;
}
