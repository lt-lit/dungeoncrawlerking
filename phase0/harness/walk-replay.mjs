// WALK REPLAY (2026-09-10, the fifth walk's verdict): rebuild a walk position
// and replay a d-pad input on it, printing what the walk did and why. The
// companion of walk-stress.mjs — every case the fourth and fifth verdicts were
// read on went through this (as scratch scripts; committed with the
// designer's "this will do for now"). Usage (from phase0/):
//   node harness/walk-replay.mjs <world> <df,dr> [--hold N] [--trace] [pieces: K1@f,r R2@f,r … anchor f,r facing n]
//     <world>     a fixture id in play/worlds/ (vaults-1 … vaults-4)
//     <df,dr>     the input, a WORLD delta (0,1 north, 1,0 east, 1,1 north-east …)
//     --hold N    hold the input N turns (default 1), printing the map, the plan and the position after each
//     --trace     print every stage of planTurn's trace (targets, vias, stuck, queued) on every turn —
//                 on by default for a single turn and for a refused step
//     pieces …    the position: the `pieces:` line walk-stress prints, verbatim (K1@f,r tokens, `anchor f,r`,
//                 `facing n`; anything else on the line is ignored) — without it the kit spawns at the start
//   The map: K the king, k his slot, @ the anchor (% / x the same one cell into stone), # wall, ^ crate,
//   O hole. The position after each turn is printed as a pieces: line, so an output feeds the next run.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as A from '../../play/js/army.mjs';
import { loadWorld, FLOOR, WALL, FURNITURE } from '../../play/js/world.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, v !== undefined && !v.startsWith('--') && n === 'hold' ? 2 : 1); return v ?? true; };
const HOLD = parseInt(flag('hold') ?? '1', 10);
let TRACE = flag('trace') !== null;
const [wid, dS, ...rest] = argv;
if (!wid || !dS) {
  console.error('usage: node harness/walk-replay.mjs <world> <df,dr> [--hold N] [--trace] [pieces: K1@f,r … anchor f,r facing n]');
  process.exit(2);
}
const KIT = A.OPENING_KIT; // THE OPENING KIT (army.mjs): four wide since 2026-09-10

const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/worlds', `${wid}.json`), 'utf8'));
const world = loadWorld(json);
const start = world.start;
const army = A.spawnArmy(world, A.makePattern(KIT), { f: start.f, r: start.r }, start.facing ?? 0, 'w');

// The position, if one was given: the harness's own `pieces:` line.
let placed = 0;
for (let i = 0; i < rest.length; i++) {
  const s = rest[i];
  const m = /^([A-Z])(\d+)@(\d+),(\d+)$/.exec(s);
  if (m) { const p = army.piece(+m[2]); if (!p) { console.error(`no piece ${m[2]} in the kit`); process.exit(2); } p.f = +m[3]; p.r = +m[4]; placed++; continue; }
  if (s === 'anchor' && rest[i + 1]) { const [f, r] = rest[++i].split(',').map(Number); army.at = { f, r }; continue; }
  if (s === 'facing' && rest[i + 1]) { army.facing = parseInt(rest[++i], 10); continue; }
}
if (placed) army.stamp(world);
const [df, dr] = dS.split(',').map(Number);
if (!Number.isInteger(df) || !Number.isInteger(dr)) { console.error(`bad input ${dS}: expected df,dr`); process.exit(2); }
if (HOLD === 1) TRACE = true;

function map(radius = 6) {
  const k = army.king;
  const slot = army.slotOf(k);
  const lines = [];
  for (let r = k.r + radius; r >= k.r - radius; r--) {
    let line = '';
    for (let f = k.f - radius; f <= k.f + radius; f++) {
      const p = army.pieceAt(f, r);
      let ch;
      const t = world.inBounds(f, r) ? world.at(f, r) : null;
      if (!world.inBounds(f, r)) ch = ' ';
      else if (p) ch = p.ch;
      else if (f === army.at.f && r === army.at.r) ch = t === FLOOR ? '@' : '%';
      else if (f === slot.f && r === slot.r) ch = t === FLOOR ? 'k' : 'x';
      else ch = t === FLOOR ? '.' : t === WALL ? '#' : t === FURNITURE ? '^' : 'O';
      line += ch;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
const piecesLine = () => `pieces: ${army.pieces.map((p) => `${p.ch}${p.id}@${p.f},${p.r}`).join(' ')} anchor ${army.at.f},${army.at.r} facing ${army.facing}`;
const cellS = (c) => (c ? `${c.f},${c.r}` : '-');

console.log(`${wid}: input ${df},${dr} held ${HOLD} turn${HOLD === 1 ? '' : 's'} (map: K at local 6,6 = world ${army.king.f},${army.king.r})`);
console.log(map());
console.log(piecesLine());
for (let t = 0; t < HOLD; t++) {
  const trace = [];
  const plan = A.planTurn(world, army, { kind: 'step', df, dr }, { trace });
  const moves = (plan.moves ?? []).map((m) => `${army.piece(m.id)?.ch}${m.id}:${cellS(m.from)}>${cellS(m.to)}${m.via?.length ? ` via ${m.via.map(cellS).join(' ')}` : ''}${m.teleport ? ' TP' : ''}`);
  if (plan.ok) A.applyTurn(world, army, plan);
  console.log(`\n--- turn ${t + 1}: ${plan.ok ? 'ok' : `REFUSED ${plan.reason} (${plan.why})`}${plan.regroup ? ' REGROUP' : ''} moves ${moves.length} teleports ${plan.teleports?.length ?? 0}${plan.teleportWhy && Object.keys(plan.teleportWhy).length ? ` (${JSON.stringify(plan.teleportWhy)})` : ''} clustered ${A.isClustered(world, army)} box ${A.boxOf(army).ok ? 'ok' : 'BROKEN'} anchor ${cellS(army.at)} facing ${army.facing}`);
  if (moves.length) console.log(`  ${moves.join('  ')}`);
  if (TRACE || !plan.ok) {
    for (const st of trace) {
      const dest = army.pieces.map((p) => `${p.ch}${p.id}@${cellS(st.dest[p.id])}${st.vias?.[p.id]?.length ? `(via ${st.vias[p.id].map(cellS).join(';')})` : ''}`).join(' ');
      const targets = st.targets ? ` targets ${army.pieces.map((p) => `${p.ch}${p.id}→${cellS(st.targets[p.id])}`).join(' ')}` : '';
      console.log(`  ${st.label}${st.whole === null ? '' : ` whole=${st.whole}`} at ${cellS(st.at)}: ${dest}${st.stuck?.length ? ` stuck ${JSON.stringify(st.stuck)}` : ''}${st.queued?.length ? ` queued ${JSON.stringify(st.queued)}` : ''}${targets}`);
    }
  }
  console.log(map());
  console.log(piecesLine());
}
