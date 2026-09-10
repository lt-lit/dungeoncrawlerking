#!/usr/bin/env node
// THE DUNGEON GENERATOR (Phase 2 milestone 5, 2026-09-08) — the Node gate
// for play/js/dungeon.mjs. The bed is the spec: every wave-6 arena passes
// the box rule and the lint constants ARE the bed's envelope; a plain room
// fails it; a seed makes the same floor twice; every generated floor
// passes the lints (reachable, no long narrow way, no boring box), lays
// every piece once with a wall ring around, places a start with a legal
// box ahead and spawns spread by distance with rising widths; the lint's
// box rectangle is the game's own box (barrier.mjs); the duelable-ground
// coverage is checked by the trigger function itself.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadStageV2 } from '../../play/js/stage.mjs';
import { loadWorld, arenaToWorld } from '../../play/js/world.mjs';
import { generateWorld, lintWorld, rectStats, narrowPockets, pocketExtent, rotated, mirrored, oriented, pieceOf, floorOf, boxRect, duelCoverage, LINT, STYLES, STYLE_NAMES, SPAWN_WIDTHS } from '../../play/js/dungeon.mjs';
import { planBarrier, boxAt, BOX } from '../../play/js/barrier.mjs';
import { makePattern, spawnArmy, OPENING_KIT } from '../../play/js/army.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, '..', '..', 'play', 'stages', 'manifest.json'), 'utf8'));
const stages = manifest.stages.map((j) => loadStageV2(j));
const pieces = stages.map(pieceOf);
const KIT = makePattern(OPENING_KIT, { seed: 1 }); // THE OPENING KIT: the start must deal for the real kit
const KIT_ENEMY = { spec: { width: 3, pieces: ['R', 'N'] } };

let ok = 0, bad = 0;
const check = (cond, msg) => { if (cond) ok++; else { bad++; console.log('FAIL', msg); } };

// ---- 1. the bed's envelope is the lint
{
  let minFeats = Infinity, maxOpen = 0, minRatio = 1, maxExtent = 0, minFloor = Infinity;
  for (const p of pieces) {
    const F = floorOf(p.cells.map((r) => r.join('')));
    const s = rectStats(F, 0, 0, BOX, BOX);
    minFeats = Math.min(minFeats, s.feats);
    maxOpen = Math.max(maxOpen, s.open);
    minRatio = Math.min(minRatio, s.iface / s.floor);
    minFloor = Math.min(minFloor, s.floor);
    maxExtent = Math.max(maxExtent, ...narrowPockets(F, { outside: '.' }).map(pocketExtent));
    check(s.floor >= LINT.denseFloor && s.open <= LINT.openMax && s.feats >= LINT.featsMin, `${p.id} passes the box rule (floor ${s.floor}, open ${s.open}, feats ${s.feats})`);
  }
  check(pieces.length === 36, `the bed is 36 arenas (${pieces.length})`);
  check(minFeats === LINT.featsMin && maxOpen === LINT.openMax, `the constants are the bed's own: feats ≥ ${minFeats}, open ≤ ${maxOpen}`);
  check(minRatio >= LINT.ifaceMin && minFloor >= LINT.denseFloor, `the bed's least touching share ${minRatio.toFixed(3)} ≥ ${LINT.ifaceMin}, least floor ${minFloor} ≥ ${LINT.denseFloor}`);
  check(maxExtent <= LINT.narrowExtent, `no arena's narrow pocket stretches past ${LINT.narrowExtent} (${maxExtent})`);
  const room = floorOf(['#'.repeat(12), ...Array.from({ length: 10 }, () => '#' + '.'.repeat(10) + '#'), '#'.repeat(12)]);
  const s = rectStats(room, 1, 1, BOX, BOX);
  check(s.floor === 100 && s.open === 100 && s.feats === 0 && s.iface === 0, 'a 10×10 empty room: one empty block of 100 and no feature');
  const hall = Array.from({ length: 32 }, (_, i) => (i === 0 || i === 31 ? '#'.repeat(32) : i === 15 ? '#' + '.'.repeat(14) + '@' + '.'.repeat(15) + '#' : '#' + '.'.repeat(30) + '#'));
  const L = lintWorld(hall);
  check(!L.ok && L.density.violations > 0 && L.reach.unreachable === 0 && L.narrow.pockets.length === 0, `an empty hall fails the density lint alone (${L.density.violations} boring boxes)`);
  const crawl = Array.from({ length: 8 }, (_, i) => (i === 3 || i === 4 ? '#' + '.'.repeat(30) + '#' : '#'.repeat(32)));
  crawl[3] = '#@' + '.'.repeat(29) + '#';
  const LC = lintWorld(crawl);
  check(LC.narrow.pockets.length === 1 && LC.narrow.maxExtent === 30, `a 2-wide passage thirty long is one narrow pocket of extent 30 (${LC.narrow.maxExtent})`);
  const pocketed = ['#'.repeat(12), '#....#.....#', '#.@..#.....#', '#....#.....#', '#'.repeat(12)];
  const LP = lintWorld(pocketed);
  check(LP.reach.unreachable === 15 && !LP.ok, `a sealed room is reported unreachable (${LP.reach.unreachable} cells)`);
}

// ---- 2. pieces and turns
{
  const p = pieces[0];
  const same = (a, b) => a.map((r) => r.join('')).join('/') === b.map((r) => r.join('')).join('/');
  check(same(rotated(p.cells, 4), p.cells) && same(rotated(rotated(p.cells, 1), 3), p.cells), 'four quarter turns are the identity');
  const r1 = rotated(p.cells, 1);
  check(r1[0][BOX - 1] === p.cells[0][0] && r1[BOX - 1][BOX - 1] === p.cells[0][BOX - 1], 'a quarter turn is clockwise');
  const F0 = floorOf(p.cells.map((r) => r.join(''))), F1 = floorOf(r1.map((r) => r.join('')));
  const s0 = rectStats(F0, 0, 0, BOX, BOX), s1 = rectStats(F1, 0, 0, BOX, BOX);
  check(s0.floor === s1.floor && s0.feats === s1.feats && s0.open === s1.open && s0.iface === s1.iface, 'the box measures are turn-invariant');
  check(same(mirrored(mirrored(p.cells)), p.cells) && mirrored(p.cells)[0][0] === p.cells[0][BOX - 1] && same(oriented(p.cells, 0), p.cells) && same(oriented(p.cells, 5), rotated(mirrored(p.cells), 1)), 'a mirror is its own inverse; the eight orientations are the four turns of the piece and of its mirror');
  const rows = manifest.stages[0].map.map((r) => r.replace(/\*/g, '#'));
  check(p.cells.map((r) => r.join('')).join('\n') === rows.join('\n'), 'pieceOf reads a stage back as its map rows');
  let skinsKept = true;
  manifest.stages[0].skin.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.' && p.skins[y][x] === '.') skinsKept = false; });
  check(skinsKept, 'every authored skin survives into the piece');
}

// ---- 3. generation: determinism, the lints, the pieces, the ring, the start, the spawns
const floors = {};
for (const seed of [1, 2, 3]) {
  const a = generateWorld({ seed, pieces: stages });
  const b = generateWorld({ seed, pieces });
  floors[seed] = a;
  check(JSON.stringify(a) === JSON.stringify(b), `seed ${seed}: the same floor twice, from stages or pieces alike`);
  check(a.gen.lint.ok, `seed ${seed}: every lint holds (${JSON.stringify({ reach: a.gen.lint.reach.unreachable, narrow: a.gen.lint.narrow.maxExtent, boring: a.gen.lint.density.violations })})`);
  check(a.map.length === 42 && a.map[0].length === 62 && a.skin.length === 42, `seed ${seed}: 6×4 tiles in a ring is 62×42`);
  const ring = a.map[0] === '#'.repeat(62) && a.map[41] === '#'.repeat(62) && a.map.every((r) => r[0] === '#' && r[61] === '#');
  check(ring, `seed ${seed}: the ring is wall`);
  check(a.gen.pieces.length === 24 && new Set(a.gen.pieces.map((t) => t.id)).size === 24, `seed ${seed}: 24 pieces, each once`);
  check(a.gen.pieces.some((t) => t.mirror) && a.gen.pieces.some((t) => !t.mirror) && a.gen.pieces.reduce((n, t) => n + t.wear, 0) >= 8, `seed ${seed}: some pieces mirrored, ${a.gen.pieces.reduce((n, t) => n + t.wear, 0)} cells of wear`);
  const world = loadWorld(a);
  check(world.start && world.spawns.length === STYLES.vaults.enemies, `seed ${seed}: a start facing ${a.facing} and ${world.spawns.length} spawns`);
  const widths = a.gen.spawns.map((s) => s.width);
  const dists = a.gen.spawns.map((s) => s.dist);
  check(widths.join(',') === SPAWN_WIDTHS.slice(0, widths.length).join(',') && dists.every((d, i) => i === 0 || d >= dists[i - 1]), `seed ${seed}: widths ${widths.join(',')} rise with distance ${dists.join(',')}`);
  check(dists.every((d) => d >= LINT.spawnMinDist), `seed ${seed}: every spawn at least ${LINT.spawnMinDist} steps from the start`);
  let spaced = true;
  for (let i = 0; i < a.gen.spawns.length; i++) for (let j = i + 1; j < a.gen.spawns.length; j++) { const p = a.gen.spawns[i], q = a.gen.spawns[j]; if (Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) < LINT.spawnSpacing) spaced = false; }
  check(spaced, `seed ${seed}: spawns ${LINT.spawnSpacing} apart`);
  check(world.spawns.every((s) => world.at(s.f, s.r) === '.') && String(world.spawns.map((s) => s.n)) === String(widths), 'the digits on the map are the widths, on floor');
  const army = spawnArmy(world, KIT, { f: world.start.f, r: world.start.r }, world.start.facing, 'w', { stamp: false });
  const plan = planBarrier(world, army, { enemy: KIT_ENEMY, seed: 1 });
  check(plan.ok && plan.deal.gap >= 2, `seed ${seed}: a legal box ahead of the start (gap ${plan.ok ? plan.deal.gap : plan.error})`);
  const AH = [[0, 1], [1, 0], [0, -1], [-1, 0]][world.start.facing];
  let run = 0;
  for (let k = 1; world.at(world.start.f + AH[0] * k, world.start.r + AH[1] * k) === '.'; k++) run++;
  check(run >= 4, `seed ${seed}: at least four cells of floor ahead of the start (${run})`);
}
{
  const cov = duelCoverage(floors[1], { samples: 40, seed: 1 });
  check(cov.ratio >= 0.8 && cov.dead.length === 0, `seed 1: duelable ground on ${Math.round(cov.ratio * 100)}% of a sample of ${cov.sampled}, no dead tile`);
  check(generateWorld({ seed: 1, pieces, theme: 'hall' }).theme === 'hall', 'a theme override');
  let threw = 0;
  try { generateWorld({ seed: 1, pieces, style: 'nope' }); } catch { threw++; }
  try { generateWorld({ seed: 1, pieces, theme: 'nope' }); } catch { threw++; }
  check(threw === 2, 'an unknown style or theme refuses');
  check(STYLE_NAMES.includes('vaults') && STYLES.vaults.skeleton === 'prefab', 'the vaults style is the prefab grid');
  const small = generateWorld({ seed: 9, pieces, cols: 3, rows: 3 });
  check(small.map.length === 32 && small.map[0].length === 32 && small.gen.lint.ok, `a 3×3 grid: 32×32, lints ${small.gen.lint.ok ? 'hold' : 'FAIL'}`);
  const big = generateWorld({ seed: 4, pieces, cols: 7, rows: 6, enemies: 6 });
  check(big.gen.pieces.length === 42 && new Set(big.gen.pieces.map((t) => t.id)).size === 36 && big.gen.lint.ok && loadWorld(big).spawns.length === 6, `7×6 tiles: the deck runs dry and reshuffles (36 distinct of 42), six spawns, lints ${big.gen.lint.ok ? 'hold' : 'FAIL'}`);
}

// ---- 4. the lint's box is the game's box
{
  const a = floors[2];
  const world = loadWorld(a);
  const F = floorOf(a.map);
  let agree = 0, tried = 0;
  for (let y = 5; y < a.map.length - 5; y += 7) for (let x = 5; x < a.map[0].length - 5; x += 9) {
    if (F.at(x, y) !== '.') continue;
    for (let d = 0; d < 4; d++) {
      tried++;
      const rect = boxRect(F, x, y, d);
      const box = boxAt(world, { king: { id: 1, f: x, r: world.ranks - 1 - y }, pieces: [{ id: 1, f: x, r: world.ranks - 1 - y }], facing: d }, d); // a lone king: the centred box
      let inside = 0;
      for (let r = 0; r < BOX; r++) for (let f = 0; f < BOX; f++) {
        const c = arenaToWorld(box.crop, f, r);
        const my = world.ranks - 1 - c.r;
        if (c.f >= rect.x0 && c.f < rect.x0 + BOX && my >= rect.y0 && my < rect.y0 + BOX) inside++;
      }
      if (inside === BOX * BOX && rect.kingFile === box.kingFile) agree++;
    }
  }
  check(tried > 20 && agree === tried, `boxRect and boxAt agree on ${agree}/${tried} boxes`);
}

console.log(`test-dungeon: ${ok}/${ok + bad} checks passed`);
process.exit(bad ? 1 : 0);
