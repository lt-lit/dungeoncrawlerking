// WALK STRESS (2026-09-09, the designer's second walk: "I feel the pieces
// should at least be able to stay adjacent if I'm only using d-pad
// movement"): random d-pad walks of the kit over the generated fixtures,
// measuring how the formation holds together — the king's lag to his slot,
// his distance to the nearest comrade, whether the army is one 8-connected
// body, teleports by reason — and dumping the local map (K the king, k his
// slot, @ the anchor) for the worst turns. Usage (from phase0/):
//   node harness/walk-stress.mjs [--steps 4000] [--seed 1] [--worst 6] [--world vaults-4]
//     [--hold 1]        a thumb on one arm of the pad: cardinals held 6–20 steps, no diagonals, no waits
//     [--splits N]      print N sampled turns where the army is split but the king is not the one detached
//     [--trace <turn>]  with --world: print every turn from turn−12 to turn (the maps and the moves)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as A from '../../play/js/army.mjs';
import { loadWorld, FLOOR, WALL, FURNITURE } from '../../play/js/world.mjs';
import { mulberry32 } from '../../play/js/prng.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const STEPS = parseInt(arg('steps', '4000'), 10);
const SEED = parseInt(arg('seed', '1'), 10);
const WORST = parseInt(arg('worst', '6'), 10);
const ONLY = arg('world', null);
const TRACE = arg('trace', null);
const HOLD = arg('hold', null);
const SPLITS = parseInt(arg('splits', '0'), 10);
const splits = [];
const KIT = { width: 3, royal: 'K', pieces: ['R', 'N'] };
const DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/worlds/manifest.json'), 'utf8'));
const worlds = manifest.worlds.filter((w) => !ONLY || w.id === ONLY);
const cheb = (a, b) => Math.max(Math.abs(a.f - b.f), Math.abs(a.r - b.r));

function localMap(world, army, plan, radius = 6) {
  const k = army.king;
  const slot = army.slotOf(k);
  const lines = [];
  for (let r = k.r + radius; r >= k.r - radius; r--) {
    let line = '';
    for (let f = k.f - radius; f <= k.f + radius; f++) {
      const p = army.pieceAt(f, r);
      let ch;
      if (!world.inBounds(f, r)) ch = ' ';
      else if (p) ch = p.ch;
      else if (f === army.at.f && r === army.at.r) ch = '@';
      else if (f === slot.f && r === slot.r) ch = 'k';
      else { const t = world.at(f, r); ch = t === FLOOR ? '.' : t === WALL ? '#' : t === FURNITURE ? '^' : 'O'; }
      line += ch;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

let grand = { turns: 0, refused: 0, regroups: 0, teleports: 0, why: {}, pivots: 0, detached: {}, detachedOnTarget: 0, detachedMoved: 0, detachedN: 0, detachedDist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], lag: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], far: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], split: 0 };
const worst = [];
for (const w of worlds) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/worlds', w.file ?? `${w.id}.json`), 'utf8'));
  const world = loadWorld(json);
  const rng = mulberry32(SEED);
  const at = world.start;
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: at.f, r: at.r }, at.facing ?? 0, 'w');
  let dir = DIRS[Math.floor(rng() * 8)];
  let hold = 0;
  for (let t = 0; t < STEPS; t++) {
    if (hold <= 0) {
      if (HOLD !== null) { dir = DIRS[2 * Math.floor(rng() * 4)]; hold = 6 + Math.floor(rng() * 15); }
      else { dir = DIRS[Math.floor(rng() * 8)]; hold = 1 + Math.floor(rng() * 8); }
    }
    hold--;
    const input = HOLD === null && rng() < 0.04 ? { kind: 'wait' } : { kind: 'step', df: dir[0], dr: dir[1] };
    const before = localMap(world, army, null);
    const kb = { ...army.king }, atb = { ...army.at }, fb = army.facing;
    const plan = A.advance(world, army, input);
    if (TRACE !== null && t >= +TRACE - 12 && t <= +TRACE) {
      const k = army.king; const s = army.slotOf(k);
      console.log(`\n=== ${w.id} turn ${t}: input ${JSON.stringify(input)} facing ${fb}→${army.facing} ok ${plan.ok}${plan.pivot ? ' PIVOT' : ''}${plan.regroup ? ' REGROUP' : ''} anchor ${atb.f},${atb.r}→${army.at.f},${army.at.r} king ${kb.f},${kb.r}→${k.f},${k.r} slot ${s.f},${s.r} lag ${cheb(k, s)}\nmoves: ${(plan.moves ?? []).map((m) => `${army.piece(m.id)?.ch}${m.from.f},${m.from.r}>${m.to.f},${m.to.r}${m.teleport ? ' TP' : ''}`).join('  ')}\n${localMap(world, army, plan)}`);
    }
    if (!plan.ok) { grand.refused++; hold = 0; continue; }
    grand.turns++;
    if (plan.regroup) grand.regroups++;
    grand.teleports += plan.teleports?.length ?? 0;
    if (plan.pivot) grand.pivots++;
    for (const id of plan.teleports ?? []) { const w = `${plan.teleportWhy?.[id] ?? '?'}${plan.pivot ? '/pivot' : ''}`; grand.why[w] = (grand.why[w] ?? 0) + 1; }
    const k = army.king;
    const lag = cheb(k, army.slotOf(k));
    const far = Math.min(...army.pieces.filter((p) => p !== k).map((p) => cheb(k, p)));
    grand.lag[Math.min(9, lag)]++;
    grand.far[Math.min(9, far)]++;
    // Connectivity: 8-connected components over the pieces.
    const seen = new Set();
    let comps = 0;
    for (const p of army.pieces) {
      if (seen.has(p.id)) continue;
      comps++;
      const stack = [p];
      seen.add(p.id);
      while (stack.length) { const q = stack.pop(); for (const o of army.pieces) if (!seen.has(o.id) && cheb(q, o) <= 1) { seen.add(o.id); stack.push(o); } }
    }
    if (comps > 1) {
      grand.split++;
      // The detached pieces: everyone outside the king's component.
      const kingComp = new Set([k.id]);
      const st = [k];
      while (st.length) { const q = st.pop(); for (const o of army.pieces) if (!kingComp.has(o.id) && cheb(q, o) <= 1) { kingComp.add(o.id); st.push(o); } }
      for (const p of army.pieces) {
        if (kingComp.has(p.id)) continue;
        grand.detachedN++;
        grand.detached[p.ch] = (grand.detached[p.ch] ?? 0) + 1;
        const t = plan.targets?.[p.id];
        const d = t ? cheb(p, t) : 9;
        grand.detachedDist[Math.min(9, d)]++;
        if (d === 0) grand.detachedOnTarget++;
        if (plan.moves.some((m) => m.id === p.id)) grand.detachedMoved++;
      }
    }
    const score = far * 10 + lag;
    if (far < 2 && comps > 1 && SPLITS > 0 && splits.length < SPLITS && t % 97 === 0) splits.push({ world: w.id, turn: t, input, comps, facing: army.facing, regroup: !!plan.regroup, moves: plan.moves.map((m) => `${army.piece(m.id)?.ch}${m.from.f},${m.from.r}>${m.to.f},${m.to.r}${m.via?.length ? ` via ${m.via.map((c) => `${c.f},${c.r}`).join(' ')}` : ''}${m.teleport ? ' TP' : ''}`).join('  '), targets: army.pieces.map((p) => `${p.ch}${p.f},${p.r}→${plan.targets?.[p.id]?.f},${plan.targets?.[p.id]?.r}`).join('  '), before, after: localMap(world, army, plan) });
    if (far >= 2) {
      worst.push({ score, world: w.id, turn: t, input, far, lag, comps, facing: army.facing, regroup: !!plan.regroup, moves: plan.moves.map((m) => `${army.piece(m.id)?.ch}${m.from.f},${m.from.r}>${m.to.f},${m.to.r}${m.via?.length ? ` via ${m.via.map((c) => `${c.f},${c.r}`).join(' ')}` : ''}${m.teleport ? ' TP' : ''}`).join('  '), before, after: localMap(world, army, plan) });
      worst.sort((a, b) => b.score - a.score);
      if (worst.length > WORST) worst.length = WORST;
    }
  }
}
console.log(`walk-stress: ${grand.turns} turns (${grand.refused} refused, ${grand.pivots} pivots, ${grand.regroups} regroups, ${grand.teleports} teleports: ${Object.entries(grand.why).map(([k, v]) => `${k} ${v}`).join(', ')}) over ${worlds.map((w) => w.id).join(', ')}`);
console.log(`king lag to slot   0..9: ${grand.lag.join(' ')}`);
console.log(`king to nearest    0..9: ${grand.far.join(' ')}`);
console.log(`army split turns: ${grand.split}; detached pieces ${grand.detachedN}: ${Object.entries(grand.detached).map(([k, v]) => `${k} ${v}`).join(', ')}; on target ${grand.detachedOnTarget}, moved this turn ${grand.detachedMoved}; distance to target 0..9: ${grand.detachedDist.join(' ')}`);
for (const c of splits) {
  console.log(`\n--- SPLIT ${c.world} turn ${c.turn}: ${c.comps} groups, facing ${c.facing}, input ${JSON.stringify(c.input)}${c.regroup ? ' REGROUP' : ''}\nmoves: ${c.moves}\ntargets: ${c.targets}\nBEFORE:\n${c.before}\nAFTER:\n${c.after}`);
}
for (const c of worst) {
  console.log(`\n--- ${c.world} turn ${c.turn}: king ${c.far} from the nearest piece, lag ${c.lag}, ${c.comps} groups, facing ${c.facing}, input ${JSON.stringify(c.input)}${c.regroup ? ' REGROUP' : ''}\nmoves: ${c.moves}\nBEFORE (K king, k his slot, @ anchor):\n${c.before}\nAFTER:\n${c.after}`);
}
