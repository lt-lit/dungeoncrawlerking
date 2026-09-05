// The Gods' v4 scorecard — the metrics the 2026-09-05 rework was measured
// on, over any set of god-lab corpora, side by side.
//
//   node harness/godlab/gods-metrics.mjs results/godlab/godlab-wave6-*.jsonl
//
// One row per corpus file (arm × tag). Columns are the designer's five
// complaints turned into numbers:
//   q/100p     quakes per 100 plies — the pacing
//   gap=1      share of quakes that fired on the very next ply after a quake
//              ("neither player gets time"); median gap alongside
//   dbl-touch  share of multi-action quakes that touched a square or moved a
//              piece twice (v3 had no memory within a quake)
//   un-mate    quakes fired with a forced mate on the referee's board that
//              destroyed or delayed it — all mates, and mate-in-3 or less
//   heat       mean heat the record ran at (v4 corpora only)
//   pinned     share of post-onset plies with pressure ≥ 0.95
//   floor      share of quakes fired at a ply where the late ply BACKSTOP
//              was the binding pressure (the meter alone would not have)
//   dead       share of quakes fired by the DEAD-BOARD backstop (v4: the
//              tedium floor on a record with nothing irreversible in it)
//   terrain    standing walls+crates at the end as a share of the start
//              (holes read as '*' in the trail, so the game's hole count is
//              taken back out)
//   ended      games that terminated (no lab error, no max-plies)
//
// Pure file reading — no engine, no RNG. Digests come from run.mjs; the
// referee evals are white-POV probes at the sweep's refereeGo.

import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node harness/godlab/gods-metrics.mjs <corpus.jsonl>...');
  process.exit(1);
}

const DIS = /^([a-zA-Z])([a-l](?:10|[1-9]))>([a-l](?:10|[1-9]))$/;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (num, den) => (den ? `${Math.round((100 * num) / den)}%` : '—');

function mateWorse(before, after) {
  if (!before || !after) return false;
  if (before.type === 'mate' && after.type !== 'mate') return true;
  return before.type === 'mate' && after.type === 'mate' && Math.abs(after.value) > Math.abs(before.value);
}

/** Did one quake touch any square twice, or move any piece twice? */
function doubleTouched(q) {
  const touched = new Map();
  const landed = [];
  const bump = (sq) => touched.set(sq, (touched.get(sq) ?? 0) + 1);
  for (const d of q.displacements ?? []) {
    const m = DIS.exec(d);
    if (!m) continue;
    if (landed.includes(m[2])) return true; // the piece that just landed moves again
    landed.push(m[3]);
    bump(m[2]);
    bump(m[3]);
  }
  for (const t of q.terrain ?? []) bump(String(t).split('@')[1]);
  if (q.crumble) bump(q.crumble.sq);
  for (const n of touched.values()) if (n > 1) return true;
  return false;
}

const rows = [];
for (const file of files) {
  const games = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((g) => !g.skipped);
  const label = path.basename(file).replace(/^godlab-/, '').replace(/\.jsonl$/, '');
  let plies = 0;
  let quakes = 0;
  let actions = 0;
  let gap1 = 0;
  const gaps = [];
  let multi = 0;
  let dbl = 0;
  let withMate = 0;
  let unmated = 0;
  let withMate3 = 0;
  let unmated3 = 0;
  const heat = [];
  let pinned = 0;
  let onset = 0;
  const terrainLeft = [];
  const pliesPerGame = [];
  let ended = 0;
  const terminations = {};
  let protectedPieces = [];
  let truncated = 0;
  let floorFired = 0;
  let deadFired = 0;
  for (const g of games) {
    plies += g.plies;
    pliesPerGame.push(g.plies);
    if (!g.error) ended++;
    terminations[g.termination ?? g.error?.slice(0, 20) ?? '?'] = (terminations[g.termination ?? g.error?.slice(0, 20) ?? '?'] ?? 0) + 1;
    const qs = g.quakes ?? [];
    quakes += qs.length;
    const ps = qs.map((q) => q.ply);
    for (let i = 1; i < ps.length; i++) {
      const gap = ps[i] - ps[i - 1];
      gaps.push(gap);
      if (gap === 1) gap1++;
    }
    for (const q of qs) {
      const n = (q.displacements?.length ?? 0) + (q.terrain?.length ?? 0) + (q.crumble ? 1 : 0);
      actions += n;
      if (n > 1) {
        multi++;
        if (doubleTouched(q)) dbl++;
      }
      const eb = q.evalBefore;
      if (eb?.type === 'mate') {
        withMate++;
        if (mateWorse(eb, q.evalAfter)) unmated++;
        if (Math.abs(eb.value) <= 3) {
          withMate3++;
          if (mateWorse(eb, q.evalAfter)) unmated3++;
        }
      }
      if (q.protected) {
        protectedPieces.push(q.protected.pieces);
        if (q.protected.truncated) truncated++;
      }
    }
    const t = g.trail ?? {};
    const on = g.directorConfig?.onsetPly ?? 0;
    const pr = t.pressure ?? [];
    // The backstop, recomputed from the recorded config: a quake whose
    // recorded pressure equals the floor at its ply was floor-driven.
    const mc = g.directorConfig?.meter ?? {};
    const floorAt = (ply) => Math.min(1, Math.max(0, (ply - (mc.floorOnsetPly ?? 120)) / Math.max(1, mc.floorRampPlies ?? 120)));
    for (const q of qs) {
      if (typeof q.pressureFloor === 'number') {
        // v4 digests carry every source; the highest one fired.
        const m = q.pressureMeter ?? 0;
        const d = q.pressureDead ?? 0;
        if (d > 0 && d >= m && d >= q.pressureFloor) deadFired++;
        else if (q.pressureFloor > 0 && q.pressureFloor >= m) floorFired++;
        continue;
      }
      const fl = floorAt(q.ply);
      const p = pr[q.ply - 1];
      if (fl > 0 && typeof p === 'number' && p <= fl + 1e-6) floorFired++;
    }
    for (let i = on; i < pr.length; i++) {
      onset++;
      if (pr[i] >= 0.95) pinned++;
    }
    if (t.heat?.length) heat.push(mean(t.heat));
    if (t.walls?.length) {
      const start = (t.walls[0] ?? 0) + (t.crates[0] ?? 0);
      const end = (t.walls.at(-1) ?? 0) + (t.crates.at(-1) ?? 0) - (g.holesEnd ?? 0);
      if (start) terrainLeft.push(end / start);
    }
  }
  rows.push({
    label,
    games: games.length,
    ended: pct(ended, games.length),
    medPlies: median(pliesPerGame),
    q100: plies ? ((100 * quakes) / plies).toFixed(1) : '—',
    aPerQ: quakes ? (actions / quakes).toFixed(2) : '—',
    gap1: pct(gap1, gaps.length),
    medGap: median(gaps),
    dbl: pct(dbl, multi),
    unmate: `${unmated}/${withMate}`,
    unmate3: `${unmated3}/${withMate3}`,
    heat: heat.length ? pct(mean(heat), 1) : '—',
    pinned: pct(pinned, onset),
    floor: pct(floorFired, quakes),
    dead: pct(deadFired, quakes),
    terrain: terrainLeft.length ? pct(mean(terrainLeft), 1) : '—',
    prot: protectedPieces.length ? `${median(protectedPieces)} (${truncated} cut)` : '—',
    terminations: Object.entries(terminations)
      .map(([k, v]) => `${k} ${v}`)
      .join(', '),
  });
}

const cols = [
  ['label', 'corpus'],
  ['games', 'games'],
  ['ended', 'ended'],
  ['medPlies', 'med plies'],
  ['q100', 'q/100p'],
  ['aPerQ', 'act/q'],
  ['gap1', 'gap=1'],
  ['medGap', 'med gap'],
  ['dbl', 'dbl-touch'],
  ['unmate', 'un-mate'],
  ['unmate3', 'un-mate≤3'],
  ['heat', 'heat'],
  ['pinned', 'pinned'],
  ['floor', 'floor'],
  ['dead', 'dead'],
  ['terrain', 'terrain'],
  ['prot', 'prot pcs'],
];
const widths = cols.map(([k, h]) => Math.max(h.length, ...rows.map((r) => String(r[k]).length)));
console.log(cols.map(([, h], i) => h.padEnd(widths[i])).join('  '));
for (const r of rows) console.log(cols.map(([k], i) => String(r[k]).padEnd(widths[i])).join('  '));
console.log('\nterminations:');
for (const r of rows) console.log(`  ${r.label}: ${r.terminations}`);
