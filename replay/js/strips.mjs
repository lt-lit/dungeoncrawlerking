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
  const ticks = new Map();
  for (let p = 0; p <= plies; p++) {
    const t = traces.get(p);
    const m = states.get(p)?.meter;
    pressure.push(typeof t?.p?.quake === 'number' ? t.p.quake : null);
    tedium.push(typeof t?.tedium === 'number' ? t.tedium : typeof m?.tedium === 'number' ? m.tedium : null);
    heat.push(typeof t?.heat === 'number' ? t.heat : typeof m?.heat === 'number' ? m.heat : null);
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
  return { plies, pressure, tedium, heat, evalAt, probes, ticks };
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

/**
 * Draw both panels into their <svg> hosts. `hosts` = { gods, eval } (svg
 * elements sized by CSS), `data` from stripData, `cursor` the current ply.
 * Returns the geometry the cursor and the hit-test use.
 */
export function renderStrips(hosts, data, cursor) {
  const out = {};
  for (const [name, svg] of Object.entries(hosts)) {
    svg.textContent = '';
    const W = Math.max(40, svg.clientWidth || 300);
    const H = Math.max(24, svg.clientHeight || 48);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const x0 = PAD.l;
    const x1 = W - PAD.r;
    const y0 = PAD.t;
    const y1 = H - PAD.b;
    const plies = Math.max(1, data.plies);
    const x = (p) => x0 + ((x1 - x0) * p) / plies;
    out[name] = { W, H, x0, x1, plies };
    if (name === 'gods') {
      const y = (v) => y1 - (y1 - y0) * Math.max(0, Math.min(1, v));
      // Grid: hairlines at 0.5 and 1 (recessive, one step off the surface).
      for (const v of [0.5, 1]) svg.appendChild(el('line', { x1: x0, x2: x1, y1: y(v), y2: y(v), class: 'st-grid' }));
      svg.appendChild(el('path', { d: areaPath(data.pressure, x, y, y1), class: 'st-area st-pressure' }));
      svg.appendChild(el('path', { d: linePath(data.pressure, x, y), class: 'st-line st-pressure' }));
      svg.appendChild(el('path', { d: linePath(data.tedium, x, y), class: 'st-line st-tedium' }));
      svg.appendChild(el('path', { d: linePath(data.heat, x, y), class: 'st-line st-heat' }));
      for (const [p, kind] of data.ticks) {
        const top = kind === 'quake' ? y0 : (y0 + y1) / 2;
        svg.appendChild(el('line', { x1: x(p), x2: x(p), y1: top, y2: y1, class: `st-tick st-tick-${kind}` }));
      }
    } else {
      const y = (cp) => (y0 + y1) / 2 - ((y1 - y0) / 2) * (Math.max(-EVAL_RAIL, Math.min(EVAL_RAIL, cp)) / EVAL_RAIL);
      svg.appendChild(el('line', { x1: x0, x2: x1, y1: y(0), y2: y(0), class: 'st-grid st-zero' }));
      // Step line: the enemy's verdict holds until its next search.
      const stepped = [];
      data.evalAt.forEach((v, p) => stepped.push(v));
      svg.appendChild(el('path', { d: linePath(stepped, x, y), class: 'st-line st-eval' }));
      for (const [p, cp] of data.probes) {
        if (cp === null) continue;
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
  return { pressure: f2(data.pressure[ply]), tedium: f2(data.tedium[ply]), heat: f2(data.heat[ply]), eval: ev, probed: data.probes.has(ply) };
}
