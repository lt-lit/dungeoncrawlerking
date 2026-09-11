#!/usr/bin/env node
// THE ENEMIES (Phase 2 milestone 6, 2026-09-10 — the enemies session) —
// the Node gate for play/js/enemy.mjs: the spawns from the digits (two
// armies of the same letters on one floor, neither erasing the other),
// sight king to king (walls, doors and crates block, holes do not, the
// corner rule), the state machine (sentry → hunt → search → sentry), the
// hunter's goals (the far rows of the four boxes where the deal is legal,
// a pillar's cell excluded, the axes behind the player through the pivot),
// the hunt converging on a standing player and the trigger firing with the
// enemy's initiative, the player's ambush with his, a closed door a wall to
// a hunter, the bystander lifted and set back, and the save round trip.
import { loadWorld, HOLE, FLOOR, FURNITURE, worldToArena } from '../../play/js/world.mjs';
import { makePattern, spawnArmy, planTurn, applyTurn, OPENING_KIT, Army } from '../../play/js/army.mjs';
import { spawnEnemies, lineOfSight, updateSight, enemyTurn, hunterGoals, triggerFor, threatCells, armyAlong, liftInside, settleBack, serializeEnemy, loadEnemy, enemyBudget, describeEnemy, facingToward } from '../../play/js/enemy.mjs';
import { boxAt, BOX } from '../../play/js/barrier.mjs';
import { newRun, updateRun, openRun, RUN_SCHEMA } from '../../play/js/run.mjs';
import { makeArmy } from '../../play/js/armygen.mjs';
import { mulberry32 } from '../../play/js/prng.mjs';

let ok = 0, bad = 0;
const check = (cond, msg) => { if (cond) ok++; else { bad++; console.log('FAIL', msg); } };

// A world from rows (top-down): '#' wall '.' floor '^' furniture 'O' hole '@' start '1'-'9' spawns.
function worldOf(rows, { id = 'lab', facing = 0 } = {}) {
  const map = rows.map((s) => s.replace(/O/g, '.'));
  const w = loadWorld({ schema: 2, id, map, facing });
  rows.forEach((row, i) => { for (let f = 0; f < row.length; f++) if (row[f] === 'O') w.setTerrain(f, rows.length - 1 - i, HOLE); });
  return w;
}
const openFloor = (w, h) => worldOf(['#'.repeat(w), ...Array.from({ length: h - 2 }, () => '#' + '.'.repeat(w - 2) + '#'), '#'.repeat(w)]);
const kit = () => makePattern(OPENING_KIT, { seed: 1 });
const lower = (world) => world.rows().join('').replace(/[^a-z]/g, '').length;
const upper = (world) => world.rows().join('').replace(/[^A-Z]/g, '').length;

// ---- 1. the band and the spawns: two enemies of the same letters on one floor
{
  const b = enemyBudget(3);
  check(b.budget === 11 && b.budgetTol === 2, `the band at width 3 is 11 ± 2 (${b.budget} ± ${b.budgetTol})`);
  let queens = 0, values = new Set();
  for (let s = 1; s <= 200; s++) { const a = makeArmy({ width: 3, royal: 'K', ...b }, mulberry32(s)); if (a.back.includes('Q')) queens++; values.add(a.value); }
  check(queens === 0 && [...values].every((v) => v >= 9 && v <= 13), `200 draws at width 3: no queen, values ${[...values].sort((x, y) => x - y).join(',')}`);
  const rows = [
    '####################',
    '#..................#',
    '#......1...........#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#........2.........#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#........@.........#',
    '#..................#',
    '####################',
  ];
  const w = worldOf(rows);
  check(w.spawns.length === 2 && w.spawns[0].n === 1 && w.spawns[1].n === 2, 'two spawns read from the digits');
  const player = spawnArmy(w, kit(), { f: w.start.f, r: w.start.r }, 0, 'w');
  const enemies = spawnEnemies(w, 7);
  check(enemies.length === 2 && enemies.every((e) => e.width === 3 && e.army.pieces.length === 6 && e.state === 'sentry' && e.army.side === 'b'), `two 3-wide enemies spawned as sentries (${enemies.map((e) => e.army.pieces.length).join(',')} pieces)`);
  check(lower(w) === 12 && upper(w) === 8, `both armies stand on the floor: ${lower(w)} lowercase letters, ${upper(w)} uppercase — neither erased the other`);
  check(enemies[0].seed !== enemies[1].seed && enemies.every((e) => e.army.king.f === e.spawn.f && e.army.king.r === e.spawn.r), 'each enemy has its own seed and its king on its spawn');
  check(enemies.every((e) => e.army.facing === 2), `the sentries look the way you come — south, toward the start (${enemies.map((e) => e.army.facing).join(',')})`);
  check(/3 wide · [NBR] [NBR] \+ 3 pawns/.test(describeEnemy(enemies[0])), `describeEnemy: ${describeEnemy(enemies[0])}`);
  // The stamp clears only its own cells: step one enemy and the other keeps every letter.
  const before = lower(w);
  const p = planTurn(w, enemies[0].army, { kind: 'step', df: 0, dr: -1 });
  applyTurn(w, enemies[0].army, p);
  check(p.ok && lower(w) === before, `one enemy steps: ${lower(w)} lowercase letters stay (${before} before)`);
  check(enemies[1].army.pieces.every((q) => w.pieceAt(q.f, q.r) === enemies[1].army.letter(q.ch)), 'the other army\'s letters are all still where its pieces stand');
  // A saved enemy loads, walks, and clears its old cells on its first turn.
  const saved = serializeEnemy(enemies[1]);
  const loaded = loadEnemy(JSON.parse(JSON.stringify(saved)));
  check(loaded.army instanceof Army && loaded.state === 'sentry' && loaded.army.pieces.length === 6 && loaded.id === 2, 'an enemy round-trips through its save');
  const p2 = planTurn(w, loaded.army, { kind: 'step', df: 0, dr: -1 });
  applyTurn(w, loaded.army, p2);
  check(p2.ok && lower(w) === before, `a loaded enemy's first turn clears its old cells (${lower(w)} letters)`);
  // The run save carries the enemies.
  const run = newRun({ seed: 7, worldId: w.id, world: w, army: player, enemies });
  check(RUN_SCHEMA === 'dck-run/3' && run.floors[w.id].enemies.length === 2 && run.start.enemies.length === 2, `the run save (${RUN_SCHEMA}) carries the enemies`);
  enemies[0].state = 'hunt';
  enemies[0].lastSeen = { f: 3, r: 3 };
  updateRun(run, { world: w, army: player, enemies, turn: 1 });
  const opened = openRun(run);
  check(opened.enemies.length === 2 && opened.enemies[0].state === 'hunt' && opened.enemies[0].lastSeen.f === 3 && opened.enemies[0].army.king.f === enemies[0].army.king.f, 'openRun brings the enemies back with their state and last-seen cell');
  updateRun(run, { world: w, army: player, turn: 2 });
  check(run.floors[w.id].enemies.length === 2, 'a save without enemies keeps the ones it had');
}

// ---- 2. sight: king to king; walls, doors and crates block; holes do not; the corner rule
{
  const w = worldOf([
    '##########',
    '#........#',
    '#..#.....#',
    '#........#',
    '#....^...#',
    '#........#',
    '#..O.....#',
    '#........#',
    '##########',
  ]);
  check(lineOfSight(w, { f: 1, r: 1 }, { f: 8, r: 1 }), 'a clear rank is seen');
  check(lineOfSight(w, { f: 1, r: 7 }, { f: 8, r: 7 }), 'a clear rank at the top is seen');
  check(!lineOfSight(w, { f: 1, r: 6 }, { f: 8, r: 6 }), 'a wall on the rank blocks (r 6 holds the wall at f 3)');
  check(!lineOfSight(w, { f: 1, r: 4 }, { f: 8, r: 4 }), 'a crate on the rank blocks');
  check(lineOfSight(w, { f: 1, r: 2 }, { f: 8, r: 2 }), 'a hole on the rank does not block');
  check(lineOfSight(w, { f: 1, r: 1 }, { f: 12, r: 12 }) === false, 'off the map is not seen');
  check(lineOfSight(w, { f: 1, r: 1 }, { f: 7, r: 7 }), 'a clear diagonal is seen');
  check(!lineOfSight(w, { f: 1, r: 4 }, { f: 4, r: 7 }) && lineOfSight(w, { f: 1, r: 3 }, { f: 5, r: 7 }), 'a wall on the diagonal blocks (the wall at (3, 6)), the diagonal beside it is clear');
  check(lineOfSight(w, { f: 4, r: 4 }, { f: 4, r: 4 }) && lineOfSight(w, { f: 2, r: 2 }, { f: 3, r: 3 }), 'a cell sees itself and its neighbour');
  // The corner rule: a ray through the corner between two cells passes when either is see-through.
  const c = worldOf(['#####', '#...#', '#.#.#', '#...#', '#####']);
  check(lineOfSight(c, { f: 1, r: 1 }, { f: 3, r: 3 }) === false, 'a pillar on the diagonal blocks');
  const c2 = openFloor(7, 7);
  c2.setTerrain(2, 1, '*');
  c2.setTerrain(1, 2, '*');
  check(lineOfSight(c2, { f: 1, r: 1 }, { f: 3, r: 3 }) === false, 'two walls meeting at the corner the diagonal passes through block');
  const c3 = openFloor(7, 7);
  c3.setTerrain(2, 1, '*');
  check(lineOfSight(c3, { f: 1, r: 1 }, { f: 3, r: 3 }), 'one wall at that corner does not block');
  // Sight is symmetric on these.
  check(lineOfSight(w, { f: 8, r: 6 }, { f: 1, r: 6 }) === false && lineOfSight(w, { f: 8, r: 2 }, { f: 1, r: 2 }), 'sight reads the same from either end');
}

// ---- 3. the state machine and the hunt on open ground: a sentry sees, hunts to the far row, the barrier falls with its initiative
{
  const w = openFloor(30, 44);
  const player = spawnArmy(w, kit(), { f: 14, r: 20 }, 0, 'w');
  const enemyPat = makePattern({ width: 3, royal: 'K', pieces: ['R', 'N'] }, { seed: 1 });
  const army = spawnArmy(w, enemyPat, { f: 20, r: 38 }, 2, 'b');
  const e = { id: 1, n: 1, width: 3, seed: 1, spawn: { f: 20, r: 38 }, army, state: 'sentry', lastSeen: null, seen: false };
  const saw = updateSight(w, player, e);
  check(saw && e.state === 'hunt' && e.lastSeen.f === 14 && e.lastSeen.r === 20, 'a sentry that sees the king hunts, the last-seen cell his');
  const g = hunterGoals(w, player, e, { seed: 1 });
  check(g.axes.length === 4 && g.axes.every((a) => a.pivot === (a.axis !== 0)), `the goals span four axes, three of them through the drop's pivot (${g.axes.map((a) => a.axis + (a.pivot ? 'p' : '')).join(' ')})`);
  check(g.goals.length === 40 && g.goals.every((c) => w.at(c.f, c.r) === FLOOR), `on open ground every far-row cell of every axis is a goal (${g.goals.length})`);
  const north = g.goals.filter((c) => c.axis === 0);
  check(north.every((c) => c.r === 20 + 9) && new Set(north.map((c) => c.f)).size === 10, 'the north box\'s far row is nine ranks ahead of the king, ten files wide');
  // The hunt: turns until the trigger fires, the player standing still.
  let fired = null, turns = 0, moved = 0;
  for (; turns < 60 && !fired; turns++) {
    const r = enemyTurn(w, player, e, { seed: 1 });
    if (r.plan) moved++;
    fired = triggerFor(w, player, e, { seed: 1, turn: 'b' });
  }
  check(fired && turns >= 3 && turns <= 30, `the hunter reaches a far row and the trigger fires in ${turns} turns (${moved} moves)`);
  if (fired) {
    check(fired.turn === 'b' && fired.plan.ok && fired.plan.deal.turn === 'b', 'the enemy completed the alignment: it moves first');
    const k = e.army.king;
    const a = worldToArena(fired.plan.crop, k.f, k.r);
    check(a && a.r === 9 && a.f === fired.file, `its king stands on the far row of the box, file ${fired.file}`);
    check(fired.axis === 0 && !fired.pivot, `it came down the player's facing (axis ${fired.axis}), no pivot needed`);
    check(fired.plan.deal.black.army.back.join('') === 'RN' && fired.plan.deal.fen.split(' ')[0].replace(/[^a-z]/g, '').length === 6, 'the deal molds the hunter\'s own bag into the box');
    check(lower(w) === 6 && upper(w) === 8, 'on the map the armies still stand (the drop is the page\'s)');
  }
  // The threat display: the far-row cells of the hunter's goals.
  const t = threatCells(w, player, [e], { seed: 1 });
  check(t.length === 40, `the threat display lights ${t.length} cells while the enemy hunts`);
  e.state = 'sentry';
  check(threatCells(w, player, [e], { seed: 1 }).length === 0, 'and none when it does not');
}

// ---- 4. the player's ambush: his step completes the alignment — his initiative; the axis behind him through the pivot
{
  const w = openFloor(30, 40);
  const player = spawnArmy(w, kit(), { f: 14, r: 10 }, 0, 'w');
  const enemyPat = makePattern({ width: 3, royal: 'K', pieces: ['N', 'N'] }, { seed: 1 });
  // The enemy king ten ranks north: one step of the player's closes it to nine.
  const army = spawnArmy(w, enemyPat, { f: 14, r: 20 }, 2, 'b');
  const e = { id: 1, n: 1, width: 3, seed: 1, spawn: { f: 14, r: 20 }, army, state: 'sentry', lastSeen: null, seen: false };
  updateSight(w, player, e);
  check(e.state === 'hunt' && !triggerFor(w, player, e, { seed: 1, turn: 'w' }), 'ten apart: the enemy hunts, no duel yet');
  const step = planTurn(w, player, { kind: 'step', df: 0, dr: 1 });
  applyTurn(w, player, step);
  const c = triggerFor(w, player, e, { seed: 1, turn: 'w' });
  check(c && c.turn === 'w' && c.plan.deal.turn === 'w' && c.axis === 0, 'the player steps into the line at nine: the duel is his ambush, he moves first');
  // An enemy BEHIND the player: the axis south, reached through the pivot.
  const w2 = openFloor(30, 40);
  const p2 = spawnArmy(w2, kit(), { f: 14, r: 20 }, 0, 'w');
  const a2 = spawnArmy(w2, enemyPat, { f: 14, r: 20 - 9 }, 0, 'b');
  const e2 = { id: 1, n: 1, width: 3, seed: 1, spawn: { f: 14, r: 11 }, army: a2, state: 'hunt', lastSeen: null, seen: true };
  const along = armyAlong(w2, p2, 2);
  check(along && along !== p2 && along.facing === 2 && along.pieces.every((q) => q.r <= p2.king.r) && boxAt(w2, along, 2).ok, 'the player\'s army along the axis behind him is its pivot: every piece level with the king or south of him');
  const c2 = triggerFor(w2, p2, e2, { seed: 1, turn: 'b' });
  check(c2 && c2.axis === 2 && c2.pivot && c2.plan.ok && c2.plan.crop.facing === 2, `an enemy nine ranks behind the king triggers on the south axis through the pivot (${c2 ? 'ok' : 'no candidate'})`);
  check(p2.facing === 0 && p2.pieces.every((q) => q.r >= p2.king.r), 'the real army has not turned — the drop does that');
}

// ---- 5. search and the sentry: sight lost sends the hunter to the last-seen cell, where it stands; a door is a wall to it
{
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(i === 0 || i === 29 ? '#'.repeat(30) : '#' + '.'.repeat(28) + '#');
  // A wall across the hall at top-down row 14 with a DOOR at file 14 and floor beyond.
  rows[14] = '#'.repeat(14) + '^' + '#'.repeat(15);
  const w = worldOf(rows);
  const player = spawnArmy(w, kit(), { f: 14, r: 5 }, 0, 'w');
  const enemyPat = makePattern({ width: 3, royal: 'K', pieces: ['R', 'B'] }, { seed: 1 });
  const army = spawnArmy(w, enemyPat, { f: 14, r: 24 }, 2, 'b');
  const e = { id: 1, n: 1, width: 3, seed: 1, spawn: { f: 14, r: 24 }, army, state: 'sentry', lastSeen: null, seen: false };
  check(!updateSight(w, player, e) && e.state === 'sentry', 'a door blocks sight: the sentry stands');
  const r0 = enemyTurn(w, player, e, { seed: 1 });
  check(!r0.plan && e.army.king.f === 14 && e.army.king.r === 24, 'a sentry does not move');
  // Give it sight by hand, then take it away: it walks to the last-seen cell as far as the door lets it.
  e.state = 'hunt';
  e.lastSeen = { f: 14, r: 5 };
  let turnsHunting = 0;
  for (let i = 0; i < 12; i++) { const r = enemyTurn(w, player, e, { seed: 1 }); if (r.plan) turnsHunting++; }
  check(e.state === 'search' && e.army.king.r > 15 && e.army.king.r < 24, `without sight it searches toward the last-seen cell and the door stops it (king at r ${e.army.king.r}, ${turnsHunting} moves)`);
  const kr = e.army.king.r;
  for (let i = 0; i < 6; i++) enemyTurn(w, player, e, { seed: 1 });
  check(e.army.king.r === kr || e.army.king.r === kr - 1 || e.army.king.r === kr + 1, 'it parks at the door (a closed door is a wall to a hunter)');
  // Open the door: the search leads through it, sight returns, the hunt resumes.
  w.setTerrain(14, 15, FLOOR);
  let sawAgain = 0;
  for (let i = 0; i < 10 && e.state !== 'hunt'; i++) { enemyTurn(w, player, e, { seed: 1 }); sawAgain++; }
  check(e.state === 'hunt' && e.army.king.r < kr + 1, `with the door open the search leads through it and it sees the king again within ${sawAgain} turns (king at r ${e.army.king.r})`);
  let fired = null;
  for (let i = 0; i < 40 && !fired; i++) { enemyTurn(w, player, e, { seed: 1 }); fired = triggerFor(w, player, e, { seed: 1, turn: 'b' }); }
  check(!!fired, 'the hunt through the doorway reaches a far row');
  // A searcher that arrives at the last-seen cell becomes a sentry again.
  const w2 = openFloor(20, 30);
  const p2 = spawnArmy(w2, kit(), { f: 10, r: 3 }, 0, 'w');
  const a2 = spawnArmy(w2, makePattern({ width: 3, royal: 'K', pieces: ['N', 'B'] }, { seed: 1 }), { f: 10, r: 20 }, 2, 'b');
  const e2 = { id: 1, n: 1, width: 3, seed: 1, spawn: { f: 10, r: 20 }, army: a2, state: 'search', lastSeen: { f: 10, r: 18 }, seen: true };
  // No sight: wall the king in.
  for (const [f, r] of [[9, 4], [10, 4], [11, 4], [9, 3], [11, 3]]) w2.setTerrain(f, r, '*');
  let arrived = false;
  for (let i = 0; i < 6 && !arrived; i++) { const r = enemyTurn(w2, p2, e2, { seed: 1 }); arrived = r.arrived; }
  check(arrived && e2.state === 'sentry' && e2.lastSeen === null && e2.army.king.r === 18, `arrived at the last-seen cell with nobody there: a sentry again (r ${e2.army.king.r})`);
}

// ---- 6. the hunter walks round a cell the deal refuses; no legal cell reachable → it walks at the king
{
  // The far row of the north box: the cell on the king's file is a pillar → not a goal; the others are.
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(i === 0 || i === 39 ? '#'.repeat(30) : '#' + '.'.repeat(28) + '#');
  const w = worldOf(rows);
  const player = spawnArmy(w, kit(), { f: 14, r: 5 }, 0, 'w');
  w.setTerrain(14, 14, '*'); // the far-row cell on the king's file
  const enemyPat = makePattern({ width: 3, royal: 'K', pieces: ['R', 'N'] }, { seed: 1 });
  const army = spawnArmy(w, enemyPat, { f: 14, r: 30 }, 2, 'b');
  const e = { id: 1, n: 1, width: 3, seed: 1, spawn: { f: 14, r: 30 }, army, state: 'hunt', lastSeen: { f: 14, r: 5 }, seen: true };
  const g = hunterGoals(w, player, e, { seed: 1 });
  const north = g.goals.filter((c) => c.axis === 0);
  check(north.length === 9 && !north.some((c) => c.f === 14 && c.r === 14), `the pillar's cell is no goal (${north.length} of the north far row)`);
  let fired = null;
  for (let i = 0; i < 40 && !fired; i++) { enemyTurn(w, player, e, { seed: 1 }); fired = triggerFor(w, player, e, { seed: 1, turn: 'b' }); }
  check(fired && fired.file !== 4, `the hunter takes a neighbouring far-row file (${fired?.file})`);
  // No legal cell at all: the player boxed in a closet the enemy cannot enter — the hunter walks at the king and parks.
  const w2 = worldOf([
    '####################',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#........###.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '#........#.#.......#',
    '####################',
  ]);
  // A one-wide slot: the kit cannot even stand in it, so stand the player in the open with the enemy sealed behind a wall line instead.
  void w2;
  const rows3 = [];
  for (let i = 0; i < 30; i++) rows3.push(i === 0 || i === 29 ? '#'.repeat(30) : i === 20 ? '#'.repeat(29) + '#' : '#' + '.'.repeat(28) + '#');
  const w3 = worldOf(rows3);
  const p3 = spawnArmy(w3, kit(), { f: 14, r: 3 }, 0, 'w');
  const a3 = spawnArmy(w3, enemyPat, { f: 14, r: 25 }, 2, 'b');
  const e3 = { id: 1, n: 1, width: 3, seed: 1, spawn: { f: 14, r: 25 }, army: a3, state: 'hunt', lastSeen: { f: 14, r: 3 }, seen: true };
  const g3 = hunterGoals(w3, p3, e3, { seed: 1 });
  const beyond = g3.goals.filter((c) => c.r > 9);
  check(g3.goals.length > 0 && beyond.length === 0, `every goal lies on the player's side of the wall line — the north box is sealed off and refused (${g3.goals.length} goals, none on the enemy's side)`);
  let last = null;
  for (let i = 0; i < 30; i++) last = enemyTurn(w3, p3, e3, { seed: 1 });
  check(e3.army.king.r === 10 || e3.army.king.r === 11, `with no goal reachable it walks at the king and parks at the wall (r ${e3.army.king.r}; ${last.blocked ? 'blocked' : last.arrived ? 'arrived' : 'moved'})`);
}

// ---- 7. bystanders: lifted out of the box for the duel and set back after
{
  const w = openFloor(30, 40);
  const player = spawnArmy(w, kit(), { f: 14, r: 5 }, 0, 'w');
  const pat = makePattern({ width: 3, royal: 'K', pieces: ['R', 'N'] }, { seed: 1 });
  const a1 = spawnArmy(w, pat, { f: 14, r: 14 }, 2, 'b');
  const a2 = spawnArmy(w, pat, { f: 18, r: 10 }, 2, 'b');
  const e1 = { id: 1, n: 1, width: 3, seed: 1, spawn: { f: 14, r: 14 }, army: a1, state: 'hunt', lastSeen: null, seen: true };
  const e2 = { id: 2, n: 2, width: 3, seed: 2, spawn: { f: 18, r: 10 }, army: a2, state: 'sentry', lastSeen: null, seen: false };
  const c = triggerFor(w, player, e1, { seed: 1, turn: 'b' });
  check(!!c, 'the first enemy triggers on the far row');
  const inside = e2.army.pieces.filter((p) => worldToArena(c.plan.crop, p.f, p.r));
  check(inside.length === 6, `the second army stands inside the box (${inside.length} pieces)`);
  const lifted = liftInside(w, e2, c.plan.crop);
  check(lifted.length === 6 && e2.army.pieces.every((p) => !w.pieceAt(p.f, p.r)) && lower(w) === 6, `liftInside takes its ${lifted.length} letters off the floor, the hunter's stay`);
  // The duel dug a pit under one of them; set back: that piece takes the nearest floor.
  const victim = e2.army.pieces[3];
  w.setTerrain(victim.f, victim.r, HOLE);
  settleBack(w, e2);
  check(lower(w) === 12 && e2.army.pieces.every((p) => w.pieceAt(p.f, p.r) === e2.army.letter(p.ch) && w.at(p.f, p.r) === FLOOR), 'settleBack puts every piece back on floor');
  check(new Set(e2.army.pieces.map((p) => `${p.f},${p.r}`)).size === 6 && !(victim.f === lifted[3].f && victim.r === lifted[3].r), 'the piece over the pit moved to a neighbouring cell, no two share a cell');
  // The whole hunter lifted for the drop.
  e1.army.lift(w);
  check(lower(w) === 6 && e1.army.pieces.length === 6, 'lift takes the hunter\'s letters off the floor, the pieces keep their cells');
}

// ---- 8. facingToward and the spawn's facing on a real fixture
{
  const w = worldOf(['#######', '#.....#', '#.....#', '#..@..#', '#.....#', '#..1..#', '#######']);
  check(facingToward(w, { f: 3, r: 1 }, w.start) === 0, 'a spawn south of the start looks north');
  check(facingToward(w, { f: 3, r: 1 }, null) === 0, 'no start: north');
  const es = spawnEnemies(w, 3);
  check(es.length === 1 && es[0].army.facing === 0 && es[0].army.pieces.length === 6, 'the enemy on the fixture faces the start');
  check(es[0].army.pieces.every((p) => w.at(p.f, p.r) === FLOOR), 'every piece on floor');
}

console.log(`test-enemy: ${ok}/${ok + bad} checks passed`);
process.exit(bad ? 1 : 0);
