#!/usr/bin/env node
// CHARGE STRESS (2026-09-11, the first phone logs): does a player who WALKS AT
// a sentry get a duel? On every generated fixture, the kit at the start walks
// toward each spawn in turn (a crude thumb: the anchor's neighbour nearest the
// enemy king by BFS, a step that moves nobody skipped, a fresh direction after
// six still turns), the enemy under the game's own sight rule (any piece of
// its army seeing any of the player's — `--kings` replays the old king-to-king
// rule for comparison) taking its turn after each input, the trigger checked
// after each army's turn. After first sight the player either keeps walking at
// it (`--policy charge`, the default) or presses wait (`--policy wait`).
// Reports first sight (turn, king distance), whether and when the duel started
// and with whose initiative, and THE RETREAT DANCE: turns after first sight on
// which the player stepped nearer and the enemy king stepped away. Usage
// (from phase0/):
//   node harness/charge-stress.mjs [--turns 250] [--world vaults-2] [--policy charge|wait] [--kings]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as A from '../../play/js/army.mjs';
import { loadWorld } from '../../play/js/world.mjs';
import { spawnEnemies, enemyTurn, triggerFor, axisArmies, lineOfSight, armiesSee } from '../../play/js/enemy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const TURNS = parseInt(arg('turns', '250'), 10);
const POLICY = arg('policy', 'charge');
const ONLY = arg('world', null);
const KINGS = argv.includes('--kings');
const K8 = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const cheb = (a, b) => Math.max(Math.abs(a.f - b.f), Math.abs(a.r - b.r));
const sees = (world, e, player) => (KINGS ? lineOfSight(world, e.army.king, player.king) : armiesSee(world, e.army, player));

function stepToward(world, player, target, mem) {
  const dist = A.distanceField(world, player, [target]);
  const at = player.at;
  const cands = K8.map(([df, dr]) => ({ df, dr, f: at.f + df, r: at.r + dr }))
    .filter((c) => world.inBounds(c.f, c.r) && dist[world.idx(c.f, c.r)] >= 0)
    .sort((a, b) => dist[world.idx(a.f, a.r)] - dist[world.idx(b.f, b.r)]);
  const shake = mem.still >= 6;
  if (shake) { mem.still = 0; mem.rot = cands.length ? (mem.rot + 3) % cands.length : 0; }
  const order = shake ? [...cands.slice(mem.rot), ...cands.slice(0, mem.rot)] : cands;
  let fallback = null;
  for (const c of order) {
    const plan = A.planTurn(world, player, { kind: 'step', df: c.df, dr: c.dr });
    if (!plan.ok) continue;
    const moved = plan.moves.some((m) => m.to.f !== m.from.f || m.to.r !== m.from.r);
    if (!moved) continue;
    if (!plan.regroup) return plan;
    if (!fallback) fallback = plan;
  }
  return fallback;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/worlds/manifest.json'), 'utf8'));
const worlds = manifest.worlds.filter((w) => !ONLY || w.id === ONLY);
const G = { runs: 0, seenAt: [], distAt: [], started: 0, startedTurn: [], dance: [], neverSeen: 0, init: { w: 0, b: 0 }, pivots: 0, rows: [] };
for (const w of worlds) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/worlds', w.file ?? `${w.id}.json`), 'utf8'));
  const world0 = loadWorld(json);
  for (let n = 0; n < world0.spawns.length; n++) {
    const world = loadWorld(json);
    const at = world.start;
    const player = A.spawnArmy(world, A.makePattern(A.OPENING_KIT), { f: at.f, r: at.r }, at.facing ?? 0, 'w');
    const enemies = spawnEnemies(world, 1);
    for (let i = 0; i < enemies.length; i++) if (i !== n) enemies[i].army.lift(world);
    const e = enemies[n];
    if (!e) continue;
    let firstSeen = -1, distSeen = -1, result = 'no duel', turns = 0, dance = 0, retreats = 0, stuck = 0, row = null;
    const mem = { still: 0, rot: 0, last: null };
    for (; turns < TURNS; turns++) {
      const alongs = axisArmies(world, player);
      const ek0 = { ...e.army.king }, pk0 = { ...player.king };
      const d0 = cheb(ek0, pk0);
      let plan = null;
      if (firstSeen >= 0 && POLICY === 'wait') plan = A.planTurn(world, player, { kind: 'wait' });
      else plan = stepToward(world, player, e.army.king, mem);
      if (plan && plan.ok) A.applyTurn(world, player, plan);
      else { stuck++; const wp = A.planTurn(world, player, { kind: 'wait' }); if (wp.ok) A.applyTurn(world, player, wp); }
      { const key = `${player.at.f},${player.at.r}`; if (key === mem.last) mem.still++; else mem.still = 0; mem.last = key; }
      // Sight after the player's move, the game's way (or the old king-to-king rule).
      const saw1 = sees(world, e, player);
      if (saw1) { e.state = 'hunt'; e.lastSeen = { f: player.king.f, r: player.king.r }; e.seen = true; if (firstSeen < 0) { firstSeen = turns; distSeen = cheb(e.army.king, player.king); } }
      else if (e.state === 'hunt') e.state = 'search';
      const c0 = triggerFor(world, player, e, { seed: 1, turn: 'w', alongs });
      if (c0) { result = 'duel'; row = c0.row; G.init.w++; if (c0.pivot) G.pivots++; break; }
      const pk1 = { ...player.king };
      enemyTurn(world, player, e, { seed: 1, alongs, sight: saw1 ? true : null });
      const ek1 = { ...e.army.king };
      if (firstSeen >= 0 && cheb(pk1, ek0) < d0 && cheb(ek1, pk1) > cheb(ek0, pk1)) dance++;
      if (firstSeen >= 0 && cheb(ek1, pk1) > cheb(ek0, pk1)) retreats++;
      const c = triggerFor(world, player, e, { seed: 1, turn: 'b', alongs });
      if (c) { result = 'duel'; row = c.row; G.init.b++; if (c.pivot) G.pivots++; break; }
    }
    G.runs++;
    if (firstSeen < 0) G.neverSeen++; else { G.seenAt.push(firstSeen + 1); G.distAt.push(distSeen); G.dance.push(dance); }
    if (result === 'duel') { G.started++; G.startedTurn.push(turns + 1); G.rows.push(row); }
    console.log(`${w.id} enemy ${e.id}: first sight ${firstSeen < 0 ? 'never' : `turn ${firstSeen + 1} at king distance ${distSeen}`}; ${result}${result === 'duel' ? ` on turn ${turns + 1} (box row ${row})` : ` in ${TURNS} turns`}; dance ${dance} (enemy retreats ${retreats}), player stuck ${stuck}`);
  }
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : '-'; };
console.log(`charge-stress (sight ${KINGS ? 'king to king' : 'between armies'}, after first sight the player ${POLICY === 'wait' ? 'presses wait' : 'keeps walking'}): ${G.runs} charges — sighted ${G.runs - G.neverSeen} (median first sight turn ${med(G.seenAt)}, median king distance ${med(G.distAt)}), duels ${G.started} (median turn ${med(G.startedTurn)}, max ${G.startedTurn.length ? Math.max(...G.startedTurn) : '-'}; initiative w ${G.init.w} / b ${G.init.b}, ${G.pivots} through a pivot; box rows ${G.rows.join(',')}), never sighted ${G.neverSeen} (the thumb is crude — it sticks in the vaults); median dance turns ${med(G.dance)}`);
