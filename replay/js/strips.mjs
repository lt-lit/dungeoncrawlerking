// The strips under the scrubber (2026-09-07, designer: "graphs plotting The
// God's stats like pressure under the scrubber. Maybe eval score as well").
// Two small charts on one x-axis (the ply), a shared cursor, tap or drag to
// scrub:
//   the gods   P(quake) as a filled area, tedium and heat as lines — all
//              three live on ONE 0…1 axis, so one panel; a tick at every
//              ply the gods acted (full height = a quake landed, half = the
//              eval gate vetoed every draw).
//   eval       the enemy's reply searches, PLAYER's POV, clamped to ±10
//              pawns with a mate on the rail, a zero hairline; a probe made
//              in the analyzer is a ringed dot on top.
// Two measures of different scale → two charts, never a second y-axis.
// Pure data in, SVG out: `stripData(line, log)` builds the series from the
// log (the traces carry `p.quake`, `tedium`, `heat`; the states carry the
// meters when a trace is missing — old logs), `renderStrips` draws them in
// pixel space (a ResizeObserver redraws on a width change, so nothing is
// stretched), `setCursor` moves the hairline. Colours are the validated
// series tokens in replay.css (`--s-pressure` / `--s-tedium` / `--s-heat` /
// `--s-eval`, inside the dark-surface lightness band); the text of the
// readout wears the text tokens, never the series colour.

const SVG_NS = 'http://www.w3.org/2000/svg';
const EVAL_RAIL = 1000; // ±10 pawns; a mate sits on the rail
const PAD = { l: 4, r: 4, t: 4, b: 4 };
const LABEL_COL = 14; // the gods panel's right-edge label column (direct labels — four series share the axis)

/** The gods panel's series, in legend order: the key on the data, the
 *  swatch/label letter, whether it is drawn as an area. `fun` is the
 *  staleness score's complement (1 − staleness — the fill rate's input). */
export const GODS_SERIES = [
  { key: 'pressure', letter: 'P', area: true },
  { key: 'tedium', letter: 'T' },
  { key: 'heat', letter: 'H' },
  { key: 'fun', letter: 'F' },
];
export const ALL_SERIES = [...GODS_SERIES.map((s) => s.key), 'eval'];

/** The score of an engine record / probe (mover or white POV) as the PLAYER's POV, in cp, mate on the rail. */
function playerCp(score, pov, player) {
  if (!score) return null;
  const cp = score.type === 'mate' ? (score.value > 0 ? EVAL_RAIL : -EVAL_RAIL) : Math.max(-EVAL_RAIL, Math.min(EVAL_RAIL, score.value));
  // pov: 'enemy' (a reply search: the mover is the enemy) or 'white' (a probe).
  const white = pov === 'white' ? cp : player === 'black' ? cp : -cp;
  return player === 'black' ? -white : white;
}

/**
 * The series for one line of a log: per ply 0…plies, `pressure` / `tedium`
 * / `heat` (null where unknown), `eval` (the enemy's last search at or
 * before the ply, player POV, null before the first), `probes` (ply →
 * player-POV cp of a probe made here), `ticks` (ply → 'quake' | 'vetoed').
 */
export function stripData(line, log) {
  const plies = line.plies ?? 0;
  const player = log.player === 'black' ? 'black' : 'white';
  const traces = new Map((line.quakeTraces ?? []).map((t) => [t.ply, t]));
  const quakes = new Set((line.quakes ?? []).map((q) => q.ply));
  const states = new Map();
  for (const s of line.states ?? []) if (!states.has(s.ply) || states.get(s.ply).ended) states.set(s.ply, s);
  const pressure = [];
  const tedium = [];
  const heat = [];
  const fun = [];
  const ticks = new Map();
  const num = (...vs) => vs.find((v) => typeof v === 'number') ?? null;
  for (let p = 0; p <= plies; p++) {
    const t = traces.get(p);
    const m = states.get(p)?.meter;
    pressure.push(num(t?.p?.quake));
    tedium.push(num(t?.tedium, m?.tedium));
    heat.push(num(t?.heat, m?.heat));
    const stale = num(t?.staleness, m?.staleness);
    fun.push(stale === null ? null : 1 - stale);
    if (quakes.has(p)) ticks.set(p, 'quake');
    else if (t?.outcome === 'vetoed') ticks.set(p, 'vetoed');
  }
  const evalAt = [];
  let last = null;
  const byPly = new Map((line.engine ?? []).map((e) => [e.ply, e]));
  for (let p = 0; p <= plies; p++) {
    const e = byPly.get(p);
    if (e?.score) last = playerCp(e.score, 'enemy', player);
    evalAt.push(last);
  }
  const probes = new Map();
  for (const s of line.states ?? []) if (s.probe && !s.ended) probes.set(s.ply, playerCp(s.probe, 'white', player));
  return { plies, pressure, tedium, heat, fun, evalAt, probes, ticks };
}

const el = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/** A polyline path over (ply, value) with gaps at nulls. */
function linePath(values, x, y) {
  let d = '';
  let pen = false;
  values.forEach((v, p) => {
    if (v === null || v === undefined) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(p).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** An area under (ply, value) down to `y0`, split at nulls. */
function areaPath(values, x, y, y0) {
  let d = '';
  let run = [];
  const flush = () => {
    if (!run.length) return;
    d += `M${x(run[0][0]).toFixed(1)} ${y0.toFixed(1)}`;
    for (const [p, v] of run) d += `L${x(p).toFixed(1)} ${y(v).toFixed(1)}`;
    d += `L${x(run[run.length - 1][0]).toFixed(1)} ${y0.toFixed(1)}Z`;
    run = [];
  };
  values.forEach((v, p) => {
    if (v === null || v === undefined) flush();
    else run.push([p, v]);
  });
  flush();
  return d;
}

/** The last non-null value of a series and its ply. */
function lastPoint(values) {
  for (let p = values.length - 1; p >= 0; p--) if (values[p] !== null && values[p] !== undefined) return { p, v: values[p] };
  return null;
}

/**
 * Draw both panels into their <svg> hosts. `hosts` = { gods, eval } (svg
 * elements sized by CSS), `data` from stripData, `cursor` the current ply,
 * `hidden` a Set of series keys toggled off (the legend's toggles).
 * Returns the geometry the cursor and the hit-test use.
 */
export function renderStrips(hosts, data, cursor, hidden = new Set()) {
  const out = {};
  for (const [name, svg] of Object.entries(hosts)) {
    svg.textContent = '';
    const W = Math.max(40, svg.clientWidth || 300);
    const H = Math.max(24, svg.clientHeight || 48);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const x0 = PAD.l;
    const x1 = W - PAD.r - (name === 'gods' ? LABEL_COL : 0);
    const y0 = PAD.t;
    const y1 = H - PAD.b;
    const plies = Math.max(1, data.plies);
    const x = (p) => x0 + ((x1 - x0) * p) / plies;
    out[name] = { W, H, x0, x1, plies };
    if (name === 'gods') {
      const y = (v) => y1 - (y1 - y0) * Math.max(0, Math.min(1, v));
      // Grid: hairlines at 0.5 and 1 (recessive, one step off the surface).
      for (const v of [0.5, 1]) svg.appendChild(el('line', { x1: x0, x2: x1, y1: y(v), y2: y(v), class: 'st-grid' }));
      const shown = GODS_SERIES.filter((s) => !hidden.has(s.key));
      for (const s of shown) {
        if (s.area) svg.appendChild(el('path', { d: areaPath(data[s.key], x, y, y1), class: `st-area st-${s.key}` }));
        svg.appendChild(el('path', { d: linePath(data[s.key], x, y), class: `st-line st-${s.key}` }));
      }
      for (const [p, kind] of data.ticks) {
        const top = kind === 'quake' ? y0 : (y0 + y1) / 2;
        svg.appendChild(el('line', { x1: x(p), x2: x(p), y1: top, y2: y1, class: `st-tick st-tick-${kind}` }));
      }
      // Direct labels at the right edge — four series on one axis need them
      // (the legend alone is not enough): each visible line's letter in the
      // label column, pushed apart where they would collide, with a leader
      // in the series colour from the line's end to its letter.
      const ends = shown.map((s) => ({ s, end: lastPoint(data[s.key]) })).filter((e) => e.end).map((e) => ({ s: e.s, yl: y(e.end.v), xe: x(e.end.p), yt: y(e.end.v) }));
      ends.sort((a, b) => a.yl - b.yl);
      const gap = 9;
      for (let i = 1; i < ends.length; i++) if (ends[i].yt < ends[i - 1].yt + gap) ends[i].yt = ends[i - 1].yt + gap;
      const over = ends.length ? ends[ends.length - 1].yt - (H - 2) : 0;
      if (over > 0) for (const e of ends) e.yt -= over;
      for (const e of ends) {
        svg.appendChild(el('line', { x1: e.xe, y1: e.yl, x2: x1 + 5, y2: e.yt, class: `st-leader st-${e.s.key}` }));
        const t = el('text', { x: x1 + 7, y: e.yt + 3, class: 'st-label' });
        t.textContent = e.s.letter;
        svg.appendChild(t);
      }
    } else {
      const y = (cp) => (y0 + y1) / 2 - ((y1 - y0) / 2) * (Math.max(-EVAL_RAIL, Math.min(EVAL_RAIL, cp)) / EVAL_RAIL);
      svg.appendChild(el('line', { x1: x0, x2: x1, y1: y(0), y2: y(0), class: 'st-grid st-zero' }));
      // Step line: the enemy's verdict holds until its next search.
      const stepped = [];
      data.evalAt.forEach((v, p) => stepped.push(v));
      if (!hidden.has('eval')) svg.appendChild(el('path', { d: linePath(stepped, x, y), class: 'st-line st-eval' }));
      for (const [p, cp] of data.probes) {
        if (cp === null || hidden.has('eval')) continue;
        svg.appendChild(el('circle', { cx: x(p), cy: y(cp), r: 4.5, class: 'st-dot-ring' }));
        svg.appendChild(el('circle', { cx: x(p), cy: y(cp), r: 3, class: 'st-dot st-eval' }));
      }
    }
    for (const p of data.forks ?? []) svg.appendChild(el('line', { x1: x(p), x2: x(p), y1: y0, y2: y0 + 4, class: 'st-fork' }));
    svg.appendChild(el('line', { x1: x(cursor), x2: x(cursor), y1: 0, y2: H, class: 'st-cursor' }));
  }
  return out;
}

/** Move the cursor hairlines without a redraw. */
export function setCursor(hosts, geom, ply) {
  for (const [name, svg] of Object.entries(hosts)) {
    const g = geom[name];
    if (!g) continue;
    const c = svg.querySelector('.st-cursor');
    if (!c) continue;
    const x = g.x0 + ((g.x1 - g.x0) * ply) / g.plies;
    c.setAttribute('x1', x);
    c.setAttribute('x2', x);
  }
}

/** The ply under an x offset in a panel's own pixels (the hit-test). */
export function plyAtX(geom, xPx) {
  const t = (xPx - geom.x0) / (geom.x1 - geom.x0);
  return Math.max(0, Math.min(geom.plies, Math.round(t * geom.plies)));
}

const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');
/** The readout line for one ply: "pressure 0.27 · tedium 0.67 · heat 0.25 · eval +8.3". */
export function readoutAt(data, ply) {
  const cp = data.probes.has(ply) ? data.probes.get(ply) : data.evalAt[ply];
  const ev = cp === null || cp === undefined ? '—' : Math.abs(cp) >= EVAL_RAIL ? (cp > 0 ? 'M / +10' : 'M / −10') : `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
  return { pressure: f2(data.pressure[ply]), tedium: f2(data.tedium[ply]), heat: f2(data.heat[ply]), fun: f2(data.fun[ply]), eval: ev, probed: data.probes.has(ply) };
}
