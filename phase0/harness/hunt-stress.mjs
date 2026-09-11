#!/usr/bin/env node
// HUNT STRESS (2026-09-10, the enemies session): does the hunt CONVERGE?
// On every generated fixture, the kit at the start and each enemy in turn
// stood at its spawn with sight granted by hand (state 'hunt'), the enemy
// takes its turns alone (the player STANDING; or FLEEING — a held cardinal
// walk away from it, the enemy moving after each input) until the trigger
// fires, the enemy parks (blocked or arrived with no trigger) or the
// budget runs out. Reports turns-to-catch, parks and misses per fixture,
// plus the enemy work per turn. Usage (from phase0/):
//   node harness/hunt-stress.mjs [--turns 120] [--world vaults-2] [--flee]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as A from '../../play/js/army.mjs';
import { loadWorld } from '../../play/js/world.mjs';
import { spawnEnemies, enemyTurn, triggerFor, axisArmies } from '../../play/js/enemy.mjs';
import { mulberry32 } from '../../play/js/prng.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const TURNS = parseInt(arg('turns', '120'), 10);
const ONLY = arg('world', null);
const FLEE = argv.includes('--flee');
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/worlds/manifest.json'), 'utf8'));
const worlds = manifest.worlds.filter((w) => !ONLY || w.id === ONLY);
const grand = { runs: 0, caught: 0, parked: 0, missed: 0, turns: [], ms: [], initiative: { w: 0, b: 0 }, pivots: 0 };
for (const w of worlds) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/worlds', w.file ?? `${w.id}.json`), 'utf8'));
  const world0 = loadWorld(json);
  const rows = [];
  for (let n = 0; n < world0.spawns.length; n++) {
    const world = loadWorld(json);
    const at = world.start;
    const player = A.spawnArmy(world, A.makePattern(A.OPENING_KIT), { f: at.f, r: at.r }, at.facing ?? 0, 'w');
    const enemies = spawnEnemies(world, 1);
    // Every other enemy leaves the floor; this one hunts from its spawn with sight granted.
    for (let i = 0; i < enemies.length; i++) if (i !== n) enemies[i].army.lift(world);
    const e = enemies[n];
    if (!e) continue;
    e.state = 'hunt';
    e.lastSeen = { f: player.king.f, r: player.king.r };
    const rng = mulberry32(n + 1);
    let dir = DIRS[Math.floor(rng() * 4)];
    let result = 'missed', turns = 0, blocked = 0, arrived = 0, moves = 0;
    let t0 = performance.now();
    for (; turns < TURNS; turns++) {
      const alongs = axisArmies(world, player);
      if (FLEE) {
        const plan = A.planTurn(world, player, { kind: 'step', df: dir[0], dr: dir[1] });
        if (plan.ok) A.applyTurn(world, player, plan);
        else dir = DIRS[Math.floor(rng() * 4)];
        e.state = 'hunt'; e.lastSeen = { f: player.king.f, r: player.king.r }; // sight granted throughout: the chase, not the stealth, is measured
        const c0 = triggerFor(world, player, e, { seed: 1, turn: 'w', alongs });
        if (c0) { result = 'caught'; grand.initiative.w++; if (c0.pivot) grand.pivots++; break; }
      }
      const r = enemyTurn(world, player, e, { seed: 1, alongs, sight: true });
      if (r.plan) moves++;
      if (r.blocked) blocked++;
      if (r.arrived) arrived++;
      const c = triggerFor(world, player, e, { seed: 1, turn: 'b', alongs });
      if (c) { result = 'caught'; grand.initiative.b++; if (c.pivot) grand.pivots++; break; }
      if (blocked >= 6 || arrived >= 6) { result = 'parked'; break; }
    }
    const ms = (performance.now() - t0) / Math.max(1, turns);
    grand.runs++;
    grand[result]++;
    if (result === 'caught') grand.turns.push(turns + 1);
    grand.ms.push(ms);
    rows.push(`${w.id} enemy ${e.id} (${e.width} wide, ${Math.max(Math.abs(e.spawn.f - at.f), Math.abs(e.spawn.r - at.r))} cells off): ${result} after ${turns + (result === 'caught' ? 1 : 0)} turns (${moves} moves, ${blocked} blocked, ${arrived} arrived), ${ms.toFixed(1)} ms/turn`);
  }
  for (const r of rows) console.log(r);
}
const sorted = [...grand.turns].sort((a, b) => a - b);
const med = sorted.length ? sorted[sorted.length >> 1] : null;
console.log(`hunt-stress${FLEE ? ' (fleeing)' : ' (standing)'}: ${grand.runs} hunts — caught ${grand.caught} (median ${med} turns, max ${sorted[sorted.length - 1] ?? '-'}; initiative w ${grand.initiative.w} / b ${grand.initiative.b}, ${grand.pivots} through a pivot), parked ${grand.parked}, missed ${grand.missed} at ${TURNS} turns; enemy work ${(grand.ms.reduce((a, b) => a + b, 0) / Math.max(1, grand.ms.length)).toFixed(1)} ms/turn (grid-only, no ffish)`);
