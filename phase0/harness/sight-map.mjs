#!/usr/bin/env node
// SIGHT MAP (2026-09-11, the first phone logs): where would a spawn see you?
// Around one enemy's spawn on a fixture, every floor cell within a radius is
// marked: `k` the enemy king sees the player's KING standing there (the old
// rule), `a` some piece of the enemy's army sees some piece of the kit stood
// there with its king on the cell, facing the enemy (the rule since
// 2026-09-11), `.` nothing sees anything; `#` wall, `^` crate or door, `O`
// hole, the enemy's own letters, `E` its king. Usage (from phase0/):
//   node harness/sight-map.mjs [--world vaults-4] [--enemy 3] [--radius 13]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as A from '../../play/js/army.mjs';
import { loadWorld, FLOOR, HOLE, FURNITURE } from '../../play/js/world.mjs';
import { spawnEnemies, lineOfSight, facingToward } from '../../play/js/enemy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const WORLD = arg('world', 'vaults-4');
const N = parseInt(arg('enemy', '1'), 10);
const RAD = parseInt(arg('radius', '13'), 10);

const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/worlds', `${WORLD}.json`), 'utf8'));
const world = loadWorld(json);
const enemies = spawnEnemies(world, 1);
const e = enemies.find((x) => x.id === N);
if (!e) { console.error(`no enemy ${N} on ${WORLD} (${enemies.length} spawned)`); process.exit(1); }
for (const other of enemies) if (other !== e) other.army.lift(world);
const ek = e.army.king;
const pattern = A.makePattern(A.OPENING_KIT);
let kCount = 0, aCount = 0, floorCount = 0;
const rows = [];
for (let r = ek.r + RAD; r >= ek.r - RAD; r--) {
  let line = '';
  for (let f = ek.f - RAD; f <= ek.f + RAD; f++) {
    if (!world.inBounds(f, r)) { line += ' '; continue; }
    const t = world.at(f, r);
    const pc = world.pieces[world.idx(f, r)];
    if (pc && e.army.owns(pc)) { line += f === ek.f && r === ek.r ? 'E' : pc; continue; }
    if (t !== FLOOR) { line += t === FURNITURE ? '^' : t === HOLE ? 'O' : '#'; continue; }
    floorCount++;
    const kingSees = lineOfSight(world, ek, { f, r });
    let anySees = kingSees;
    if (!anySees) {
      // The kit stood with its king on this cell, facing the enemy: its formation shifted so the king lands here, off-floor slots dropped.
      let kit = null;
      try { kit = A.spawnArmy(world, pattern, { f, r }, facingToward(world, { f, r }, ek), 'w', { stamp: false }); } catch { kit = null; }
      if (kit) {
        const pieces = kit.pieces.filter((p) => world.inBounds(p.f, p.r) && world.at(p.f, p.r) === FLOOR);
        anySees = e.army.pieces.some((ep) => pieces.some((pp) => lineOfSight(world, ep, pp)));
      }
    }
    if (kingSees) kCount++; else if (anySees) aCount++;
    line += kingSees ? 'k' : anySees ? 'a' : '.';
  }
  rows.push(line);
}
console.log(`${WORLD} enemy ${e.id} at (${ek.f}, ${ek.r}), ${e.army.pieces.map((p) => p.ch).join('')}: of ${floorCount} floor cells within ${RAD}, its king sees the player's king on ${kCount}; any of its pieces sees some kit piece on ${kCount + aCount} (+${aCount})`);
console.log(rows.join('\n'));
