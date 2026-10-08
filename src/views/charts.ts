/** Small dependency-free SVG/HTML charts used by the dashboard. Colours come from CSS classes so themes apply. */
const NS = "http://www.w3.org/2000/svg";

/** Make a non-button element behave like a button for mouse, keyboard and screen readers. */
export function makeClickable(el: HTMLElement, label: string, fn: () => void): void {
  el.setAttr("role", "button");
  el.setAttr("tabindex", "0");
  el.setAttr("aria-label", label);
  el.addEventListener("click", fn);
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } });
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export const niceMax = (v: number): number => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

export interface BarSeries { name: string; values: number[]; cls: string }
export interface BarOpts {
  labels: string[]; series: BarSeries[]; stacked?: boolean; height?: number;
  fmt?: (n: number) => string; onClick?: (i: number) => void; ariaLabel: string; empty?: string; yTitle?: string;
}

export function barChart(parent: HTMLElement, o: BarOpts): void {
  const W = 720, H = o.height ?? 200, L = 44, B = 22, T = 8, R = 6;
  const n = o.labels.length;
  const totals = o.labels.map((_l, i) => (o.stacked ? o.series.reduce((a, s) => a + (s.values[i] ?? 0), 0) : Math.max(...o.series.map((s) => s.values[i] ?? 0))));
  const max = niceMax(Math.max(0, ...totals));
  const wrap = parent.createDiv({ cls: "fcb-chart" });
  if (!totals.some((t) => t > 0)) { wrap.createDiv({ cls: "fcb-chart-empty", text: o.empty ?? "No data in this period." }); return; }
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": o.ariaLabel, class: "fcb-svg" }, wrap);
  const fmt = o.fmt ?? ((x: number) => String(Math.round(x * 10) / 10));
  for (let g = 0; g <= 4; g++) {
    const y = T + ((H - T - B) * (4 - g)) / 4;
    svg("line", { x1: L, x2: W - R, y1: y, y2: y, class: "fcb-grid" }, s);
    svg("text", { x: L - 6, y: y + 3, class: "fcb-axis", "text-anchor": "end" }, s, fmt((max * g) / 4));
  }
  const slot = (W - L - R) / Math.max(1, n);
  const bw = Math.max(1, Math.min(34, slot * 0.78));
  const step = Math.ceil(n / 12);
  o.labels.forEach((lab, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    const g = svg("g", { class: "fcb-bar-g" + (o.onClick ? " is-click" : "") }, s);
    let acc = 0;
    const sers = o.stacked ? o.series : o.series;
    const per = o.stacked ? bw : bw / o.series.length;
    sers.forEach((ser, k) => {
      const v = ser.values[i] ?? 0;
      if (v <= 0) return;
      const h = ((H - T - B) * v) / max;
      const y = o.stacked ? H - B - ((H - T - B) * (acc + v)) / max : H - B - h;
      svg("rect", { x: o.stacked ? x : x + per * k, y, width: per, height: Math.max(1, h), class: `fcb-rect ${ser.cls}` }, g);
      acc += v;
    });
    const tip = o.series.map((ser) => `${ser.name}: ${fmt(ser.values[i] ?? 0)}`).join(" · ");
    svg("rect", { x: L + slot * i, y: T, width: slot, height: H - T - B, class: "fcb-hit" }, g);
    svg("title", {}, g, `${lab} — ${tip}`);
    if (o.onClick) g.addEventListener("click", () => o.onClick?.(i));
    if (i % step === 0) svg("text", { x: x + bw / 2, y: H - 6, class: "fcb-axis", "text-anchor": "middle" }, s, lab);
  });
  if (o.series.length > 1) {
    const lg = wrap.createDiv({ cls: "fcb-legend" });
    o.series.forEach((ser) => { const it = lg.createSpan({ cls: "fcb-legend-item" }); it.createSpan({ cls: `fcb-swatch ${ser.cls}` }); it.createSpan({ text: ser.name }); });
  }
}

export function lineChart(parent: HTMLElement, labels: string[], values: (number | null)[], ariaLabel: string, onClick?: (i: number) => void): void {
  const W = 720, H = 180, L = 44, B = 22, T = 8, R = 10;
  const wrap = parent.createDiv({ cls: "fcb-chart" });
  if (!values.some((v) => v !== null)) { wrap.createDiv({ cls: "fcb-chart-empty", text: "No reviews in this period yet." }); return; }
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": ariaLabel, class: "fcb-svg" }, wrap);
  for (let g = 0; g <= 4; g++) {
    const y = T + ((H - T - B) * (4 - g)) / 4;
    svg("line", { x1: L, x2: W - R, y1: y, y2: y, class: "fcb-grid" }, s);
    svg("text", { x: L - 6, y: y + 3, class: "fcb-axis", "text-anchor": "end" }, s, `${g * 25}%`);
  }
  const n = labels.length;
  const x = (i: number) => L + ((W - L - R) * (n === 1 ? 0.5 : i / (n - 1)));
  const y = (v: number) => T + (H - T - B) * (1 - v);
  let d = "", pen = false;
  values.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; });
  svg("path", { d, class: "fcb-line" }, s);
  const step = Math.ceil(n / 12);
  labels.forEach((lab, i) => {
    const v = values[i];
    if (v !== null) {
      const c = svg("circle", { cx: x(i), cy: y(v), r: 3.5, class: "fcb-dot" + (onClick ? " is-click" : "") }, s);
      svg("title", {}, c, `${lab} — ${Math.round(v * 100)}%`);
      if (onClick) c.addEventListener("click", () => onClick(i));
    }
    if (i % step === 0) svg("text", { x: x(i), y: H - 6, class: "fcb-axis", "text-anchor": "middle" }, s, lab);
  });
}

export interface Row { label: string; title?: string; secondary?: string; indent?: number; strong?: boolean; value: number; sub: string; ratio: number | null; onClick?: () => void }
/** Horizontal bar list (deck / tag performance): bar length = reviews, colour = accuracy. Labels wrap, never truncate. */
export function rowList(parent: HTMLElement, rows: Row[], empty: string): void {
  const wrap = parent.createDiv({ cls: "fcb-rows" });
  if (!rows.length) { wrap.createDiv({ cls: "fcb-chart-empty", text: empty }); return; }
  const max = Math.max(1, ...rows.map((r) => r.value));
  for (const r of rows) {
    const row = wrap.createDiv({ cls: "fcb-row-item" + (r.onClick ? " is-click" : "") + (r.strong ? " is-parent" : "") });
    if (r.title) row.setAttr("title", r.title);
    const lab = row.createDiv({ cls: "fcb-row-label" });
    lab.style.paddingLeft = `${(r.indent ?? 0) * 16}px`;
    if ((r.indent ?? 0) > 0) lab.createSpan({ cls: "fcb-row-branch", text: "└ " });
    lab.createSpan({ cls: "fcb-row-name", text: r.label });
    if (r.secondary) lab.createDiv({ cls: "fcb-row-path", text: r.secondary });
    const bar = row.createDiv({ cls: "fcb-row-bar" });
    const fill = bar.createDiv({ cls: "fcb-row-fill " + (r.ratio === null ? "" : r.ratio >= 0.9 ? "is-good" : r.ratio >= 0.75 ? "is-ok" : "is-bad") });
    fill.style.width = `${Math.max(2, (r.value / max) * 100)}%`;
    row.createDiv({ cls: "fcb-row-sub", text: r.sub });
    if (r.onClick) makeClickable(row, `${r.title ?? r.label}: ${r.sub}. Filter the dashboard.`, r.onClick);
  }
}

/** Activity heat map: weeks as columns, Monday first. `days` are consecutive logical days. */
export function heatmap(parent: HTMLElement, days: { start: number; n: number; label: string }[], onClick: (start: number) => void, selected: number | null): void {
  const wrap = parent.createDiv({ cls: "fcb-heatwrap" });
  const grid = wrap.createDiv({ cls: "fcb-heat2" });
  const max = Math.max(1, ...days.map((d) => d.n));
  if (days.length) { const dow = (new Date(days[0].start + 12 * 3_600_000).getDay() + 6) % 7; for (let i = 0; i < dow; i++) grid.createDiv({ cls: "fcb-heat-pad" }); }
  for (const d of days) {
    const lvl = d.n === 0 ? 0 : Math.min(4, 1 + Math.floor((d.n / max) * 3.99));
    const c = grid.createDiv({ cls: `fcb-heat-cell l${lvl}${selected === d.start ? " is-selected" : ""}`, attr: { "aria-label": `${d.label}: ${d.n} reviews`, title: `${d.label}: ${d.n} reviews` } });
    makeClickable(c, `${d.label}: ${d.n} reviews. Show details.`, () => onClick(d.start));
  }
}

/** Small progress ring with a centred label (e.g. retention %). `ratio` null → “—”. */
export function ring(parent: HTMLElement, ratio: number | null, label: string, caption: string): void {
  const wrap = parent.createDiv({ cls: "fcb-ring" });
  wrap.createDiv({ cls: "fcb-ring-caption", text: caption });
  const R = 22, C = 2 * Math.PI * R;
  const s = svg("svg", { viewBox: "0 0 56 56", class: "fcb-ring-svg", role: "img", "aria-label": `${caption}: ${ratio === null ? "no data" : label}` }, wrap);
  svg("circle", { cx: 28, cy: 28, r: R, class: "fcb-ring-bg" }, s);
  if (ratio !== null) svg("circle", { cx: 28, cy: 28, r: R, class: "fcb-ring-fg", "stroke-dasharray": `${Math.max(0, Math.min(1, ratio)) * C} ${C}`, transform: "rotate(-90 28 28)" }, s);
  svg("text", { x: 28, y: 32, class: "fcb-ring-text", "text-anchor": "middle" }, s, ratio === null ? "—" : label);
}

/** Tiny activity line for a list of daily counts. */
export function sparkline(parent: HTMLElement, values: number[], ariaLabel: string): void {
  const W = 220, H = 56, pad = 4;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "fcb-spark", role: "img", "aria-label": ariaLabel }, parent);
  const max = Math.max(1, ...values);
  const x = (i: number) => pad + ((W - 2 * pad) * (values.length <= 1 ? 0.5 : i / (values.length - 1)));
  const y = (v: number) => H - pad - ((H - 2 * pad) * v) / max;
  if (!values.some((v) => v > 0)) { svg("line", { x1: pad, x2: W - pad, y1: H - pad, y2: H - pad, class: "fcb-grid" }, s); return; }
  let line = "";
  values.forEach((v, i) => (line += `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`));
  svg("path", { d: `${line}L${x(values.length - 1).toFixed(1)} ${H - pad}L${x(0).toFixed(1)} ${H - pad}Z`, class: "fcb-spark-area" }, s);
  svg("path", { d: line, class: "fcb-line" }, s);
}
