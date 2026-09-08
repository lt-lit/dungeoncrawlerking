#!/usr/bin/env node
// THE BOX (Phase 2 milestone 5, 2026-09-08 — the trigger conversation) —
// the Node gate for play/js/barrier.mjs: the arena is always 10×10 on the
// player's king (his rank row 0, his facing arena-north), the placement
// across him is one rule (a run that fits sits centred, a wider one centres
// the king), the enemy king stands on the far row — the king's own file
// first, else the nearest that deals — the kings nine apart, the gap an
// output with a floor of 2, the summoning on ground connected to its king
// (never through a thin wall into the next room), a crop hanging off the map
// walled, the carried pattern in marching order, the run's duel entry, and
// the lenient walk-out of a sealed king.
import { loadWorld, arenaToWorld, worldToArena, cropTransform, HOLE, FLOOR, WALL } from '../../play/js/world.mjs';
import { makePattern, spawnArmy, rotateBody, bagOfPattern, patternOf } from '../../play/js/army.mjs';
import { planBarrier, planBox, boxPlacement, boxAt, reachOf, BOX, GAP_MIN } from '../../play/js/barrier.mjs';
import { layoutArmy } from '../../play/js/armygen.mjs';
import { newRun, recordDuel, inputsOf, runEnded, updateRun, openRun } from '../../play/js/run.mjs';
import { parseBoard, splitFen } from '../../play/js/fen.mjs';

const KIT = { width: 3, royal: 'K', pieces: ['R', 'N'] };
const KIT_ENEMY = { spec: { width: 3, pieces: ['R', 'N'] } };

let ok = 0, bad = 0;
const check = (cond, msg) => { if (cond) ok++; else { bad++; console.log('FAIL', msg); } };

/** The board field of a FEN as [rankFromTop][file]. */
const boardOf = (fen) => parseBoard(splitFen(fen).board);
const kingsOf = (fen) => {
  const b = boardOf(fen);
  const ranks = b.length;
  let K = null, k = null;
  for (let r = 0; r < ranks; r++) for (let f = 0; f < b[r].length; f++) {
    if (b[r][f] === 'K') K = { f, r: ranks - 1 - r };
    if (b[r][f] === 'k') k = { f, r: ranks - 1 - r };
  }
  return { K, k };
};
const gapOf = (fen) => {
  const b = boardOf(fen);
  const ranks = b.length;
  let wTop = -1, bBottom = ranks;
  for (let r = 0; r < ranks; r++) for (const c of b[r]) {
    if (!c || c === '*' || c === '^') continue;
    const rank = ranks - 1 - r;
    if (c === c.toUpperCase()) wTop = Math.max(wTop, rank);
    else bBottom = Math.min(bBottom, rank);
  }
  return bBottom - wTop - 1;
};

// A world from rows (top-down), '#' wall '.' floor '^' furniture 'O' hole '@' start.
function worldOf(rows, { id = 'lab' } = {}) {
  const map = rows.map((s) => s.replace(/O/g, '.'));
  const w = loadWorld({ schema: 2, id, map });
  rows.forEach((row, i) => { for (let f = 0; f < row.length; f++) if (row[f] === 'O') w.setTerrain(f, rows.length - 1 - i, HOLE); });
  return w;
}
const openFloor = (w, h) => worldOf(['#'.repeat(w), ...Array.from({ length: h - 2 }, () => '#' + '.'.repeat(w - 2) + '#'), '#'.repeat(w)]);

// ---- 1. the placement rule
{
  const run = (left, right) => (f, r) => r === 0 && f >= -left && f <= right;
  const king = { f: 0, r: 0 };
  check(boxPlacement(run(20, 20), king, 0).kingFile === 4, 'a wide hall: the king in the middle of the box (file 4)');
  check(boxPlacement(run(1, 20), king, 0).kingFile === 1, 'the king one cell off the west wall of a wide hall: the box slides to stay in the room (file 1)');
  check(boxPlacement(run(20, 1), king, 0).kingFile === 8, 'one cell off the east wall: file 8');
  check(boxPlacement(run(1, 2), king, 0).kingFile === 4, 'a 4-wide run: centred in the box, the king at file 4');
  check(boxPlacement(run(0, 2), king, 0).kingFile === 3, 'a 3-wide run with the king at its west cell: the run at files 3–5');
  check(boxPlacement(run(0, 0), king, 0).kingFile === 4, 'a lone cell sits in the middle');
  check(boxPlacement(run(9, 0), king, 0).kingFile === 9, 'a run of exactly ten with the king at its east end: file 9');
  const p = boxPlacement(run(3, 3), king, 0);
  check(p.width === 7 && p.left === 3 && p.right === 3 && p.kingFile === 4, `the run is reported (${JSON.stringify(p)})`);
}

// ---- 2. open ground at every facing: the box, the pin, the gap, the crop's orientation, the terrain
{
  const world = openFloor(30, 30);
  for (const facing of [0, 1, 2, 3]) {
    const w = openFloor(30, 30);
    const army = spawnArmy(w, makePattern(KIT, { seed: 1 }), { f: 14, r: 14 }, facing, 'w');
    const king = army.king;
    const box = boxAt(w, king, facing);
    check(box.crop.files === BOX && box.crop.ranks === BOX && box.kingFile === 4, `facing ${facing}: a 10×10 box, the king at file 4`);
    const tx = box.crop;
    const ahead = rotateBody(0, 1, facing), right = rotateBody(1, 0, facing);
    const c0 = arenaToWorld(tx, box.kingFile, 0), c1 = arenaToWorld(tx, box.kingFile, 1), c2 = arenaToWorld(tx, box.kingFile + 1, 0);
    check(c0.f === king.f && c0.r === king.r, `facing ${facing}: arena (kingFile, 0) is the king's cell`);
    check(c1.f === king.f + ahead.df && c1.r === king.r + ahead.dr, `facing ${facing}: arena-north is the facing`);
    check(c2.f === king.f + right.df && c2.r === king.r + right.dr, `facing ${facing}: arena-east is the army's right`);
    const back = worldToArena(tx, king.f, king.r);
    check(back && back.f === box.kingFile && back.r === 0, `facing ${facing}: the king's cell reads back as (kingFile, 0)`);
    const plan = planBarrier(w, army, { enemy: KIT_ENEMY, seed: 7, turn: 'w' });
    check(plan.ok, `facing ${facing}: the barrier drops (${plan.ok ? '' : plan.error})`);
    if (!plan.ok) continue;
    const { K, k } = kingsOf(plan.deal.fen);
    check(K && K.r === 0 && K.f === plan.kingFile, `facing ${facing}: the player's king on row 0 of his file (${JSON.stringify(K)})`);
    check(k && k.r === BOX - 1 && k.f === plan.kingFile && plan.enemyFile === plan.kingFile, `facing ${facing}: the enemy king on the far row of the same file (${JSON.stringify(k)})`);
    check(k.r - K.r === 9, `facing ${facing}: the kings nine apart`);
    check(plan.stage.files === BOX && plan.stage.ranks === BOX && plan.deal.files === BOX && plan.deal.ranks === BOX, `facing ${facing}: the deal is 10×10`);
    check(gapOf(plan.deal.fen) === 6 && plan.deal.gap === 6, `facing ${facing}: kit vs kit on open ground leaves gap 6 (${gapOf(plan.deal.fen)})`);
    check(plan.deal.variantName.startsWith('duel_10x10__') && plan.deal.variantIni.includes(plan.deal.variantName), `facing ${facing}: the deal's camp-line variant (${plan.deal.variantName})`);
    check(plan.deal.world.kingSquare === 'e1' && plan.deal.world.enemyKingSquare === 'e10' && plan.deal.world.enemyFile === 4, `facing ${facing}: the provenance names e1 and e10`);
    // The crop's terrain is the world's: every wall in the FEN is a wall / hole / off-map cell in the world.
    const b = boardOf(plan.deal.fen);
    let terrainOk = true;
    for (let r = 0; r < BOX; r++) for (let f = 0; f < BOX; f++) {
      const ch = b[BOX - 1 - r][f];
      const c = arenaToWorld(plan.crop, f, r);
      const t = c && w.inBounds(c.f, c.r) ? w.at(c.f, c.r) : undefined;
      const wantWall = t === undefined || t === WALL || t === HOLE;
      if ((ch === '*') !== wantWall) terrainOk = false;
      if ((ch === '^') !== (t === '^')) terrainOk = false;
    }
    check(terrainOk, `facing ${facing}: the stamped FEN's terrain is the world's through the crop`);
    const wCells = plan.deal.white.layout.cells;
    check(wCells.filter((c) => c.piece === 'P').length === 3 && wCells.some((c) => c.piece === 'R') && wCells.some((c) => c.piece === 'N') && wCells.length === 6, `facing ${facing}: the whole kit materializes`);
  }
  void world;
}

// ---- 3. the band: the far-row cell on the king's file is a pillar → the nearest file that deals
{
  const rows = Array.from({ length: 30 }, (_, i) => (i === 0 || i === 29 ? '#'.repeat(30) : '#' + '.'.repeat(28) + '#'));
  // the king at (14, 10) facing north: the far row is r 19 → top-down row 29 - 19 = 10; a pillar at f 14
  rows[10] = rows[10].slice(0, 14) + '#' + rows[10].slice(15);
  const w = worldOf(rows);
  const army = spawnArmy(w, makePattern(KIT, { seed: 1 }), { f: 14, r: 10 }, 0, 'w');
  const onFile = planBox(w, army, { enemy: KIT_ENEMY, seed: 1 });
  check(!onFile.ok && /far row/.test(onFile.error), `planBox on the king's file refuses when the far-row cell is stone (${onFile.error})`);
  const plan = planBarrier(w, army, { enemy: KIT_ENEMY, seed: 1 });
  check(plan.ok && plan.enemyFile !== plan.kingFile && Math.abs(plan.enemyFile - plan.kingFile) === 1, `the button walks to the nearest far-row file that deals (file ${plan.ok ? plan.enemyFile : plan.error})`);
  const { K, k } = kingsOf(plan.deal.fen);
  check(plan.ok && K.f === 4 && K.r === 0 && k.r === 9 && k.f === plan.enemyFile, 'the kings on their rows, the enemy on the band');
  const wide = planBox(w, army, { enemy: KIT_ENEMY, seed: 1, enemyFile: 0 });
  check(wide.ok && kingsOf(wide.deal.fen).k.f === 0, 'planBox deals the enemy king on file 0 of the far row when asked');
  check(!planBox(w, army, { enemy: KIT_ENEMY, seed: 1, enemyFile: 10 }).ok, 'a file outside the box refuses');
}

// ---- 4. the summoning lands only on ground connected to its king
{
  // A 3-wide corridor (files 3–5) with a 1-thick wall at file 6 and a room beyond (files 7–12).
  const rows = Array.from({ length: 24 }, (_, i) => (i === 0 || i === 23 ? '#'.repeat(20) : '###...#......#######'));
  const w = worldOf(rows);
  const wide = { width: 6, pieces: ['Q', 'R', 'R', 'N', 'B'] };
  const army = spawnArmy(w, makePattern(wide, { seed: 1 }), { f: 4, r: 4 }, 0, 'w');
  const plan = planBarrier(w, army, { enemy: KIT_ENEMY, seed: 1 });
  check(plan.ok, `a 6-wide army in a 3-wide corridor beside a room: the box deals (${plan.ok ? `gap ${plan.deal.gap}` : plan.error})`);
  if (plan.ok) {
    const cells = plan.deal.white.layout.cells.map((c) => arenaToWorld(plan.crop, c.f, c.r));
    check(cells.every((c) => c.f >= 3 && c.f <= 5), `every white piece stands in the corridor, none through the wall (files ${[...new Set(cells.map((c) => c.f))].sort().join(',')})`);
    check(plan.deal.white.layout.depthRows === 4, `the 6-wide army molds four deep in three files (${plan.deal.white.layout.depthRows})`);
    const b = boardOf(plan.deal.fen);
    // The room beyond the wall is still in the arena as floor (a knight may hop in).
    let roomFloor = 0;
    for (let r = 0; r < BOX; r++) for (let f = 0; f < BOX; f++) { const c = arenaToWorld(plan.crop, f, r); if (c.f >= 7 && b[BOX - 1 - r][f] === null) roomFloor++; }
    check(roomFloor > 0, `the room beyond the wall stays in the arena as floor (${roomFloor} cells)`);
  }
  // reachOf directly: the wall line with no gap seals; a door in it passes.
  const stage = w.arenaStage(boxAt(w, army.king, 0).crop);
  const reach = reachOf(stage, { f: plan.ok ? plan.kingFile : 4, r: 0 });
  check(reach.count > 0 && !reach(9, 0) && reach(plan.ok ? plan.kingFile : 4, 5), `reachOf: the corridor is reached, the room beyond the wall is not (${reach.count} cells)`);
  // A wall across the box between the armies refuses; a door in it deals (furniture is passable).
  const sealedRows = Array.from({ length: 24 }, (_, i) => (i === 0 || i === 23 ? '#'.repeat(20) : i === 12 ? '#'.repeat(20) : '#' + '.'.repeat(18) + '#'));
  const sealed = worldOf(sealedRows);
  const armyS = spawnArmy(sealed, makePattern(KIT, { seed: 1 }), { f: 9, r: 5 }, 0, 'w');
  const planS = planBarrier(sealed, armyS, { enemy: KIT_ENEMY, seed: 1 });
  check(!planS.ok && /seal/.test(planS.error), `a wall line across the box with no door: refused (${planS.error})`);
  const doorRows = sealedRows.slice();
  doorRows[12] = '#'.repeat(9) + '^' + '#'.repeat(10);
  const doored = worldOf(doorRows);
  const armyD = spawnArmy(doored, makePattern(KIT, { seed: 1 }), { f: 9, r: 5 }, 0, 'w');
  const planD = planBarrier(doored, armyD, { enemy: KIT_ENEMY, seed: 1 });
  check(planD.ok, `the same line with a door in it: the deal passes through the door (${planD.ok ? `gap ${planD.deal.gap}` : planD.error})`);
  // layoutArmy's reach on its own: a 10-wide grid where only files 0–3 are reachable.
  const grid = Array.from({ length: 10 }, () => Array(10).fill(null));
  const laid = layoutArmy({ grid, files: 10, ranks: 10, side: 'white', army: { width: 6, royal: 'K', back: ['Q', 'R', 'R', 'N', 'B'], value: 0 }, royalAt: { f: 2, row: 0 }, reach: (f) => f <= 3 });
  check(laid && laid.cells.every((c) => c.f <= 3) && laid.cells.length === 12, `layoutArmy with a reach mask fills only the reachable files (${laid ? laid.depthRows : 'null'} rows)`);
}

// ---- 5. the gap is an output with a floor of 2; a depth past the box refuses
{
  const eight = { width: 8, pieces: ['Q', 'R', 'R', 'B', 'B', 'N', 'N'] };
  const eightEnemy = { spec: { width: 8, pieces: ['Q', 'R', 'R', 'B', 'B', 'N', 'N'] } };
  const corridor = (width) => worldOf(['#'.repeat(width + 2), ...Array.from({ length: 30 }, () => '#' + '.'.repeat(width) + '#'), '#'.repeat(width + 2)]);
  const c5 = corridor(5);
  const a5 = spawnArmy(c5, makePattern(eight, { seed: 1 }), { f: 3, r: 4 }, 0, 'w');
  const p5 = planBarrier(c5, a5, { enemy: eightEnemy, seed: 1 });
  check(p5.ok && p5.deal.gap === GAP_MIN, `two 8-wide armies in a 5-wide corridor: four deep each, gap exactly ${GAP_MIN} (${p5.ok ? p5.deal.gap : p5.error})`);
  const c3 = corridor(3);
  const a3 = spawnArmy(c3, makePattern(eight, { seed: 1 }), { f: 2, r: 4 }, 0, 'w');
  const p3 = planBarrier(c3, a3, { enemy: eightEnemy, seed: 1 });
  check(!p3.ok && /no room/.test(p3.error), `two 8-wide armies in a 3-wide corridor: past the box, refused (${p3.error})`);
  const c4 = corridor(4);
  const a4 = spawnArmy(c4, makePattern({ width: 6, pieces: ['Q', 'R', 'R', 'N', 'B'] }, { seed: 1 }), { f: 2, r: 4 }, 0, 'w');
  const p4 = planBarrier(c4, a4, { enemy: { spec: { width: 6, pieces: ['Q', 'R', 'N', 'B', 'N'] } }, seed: 1 });
  check(p4.ok && p4.deal.gap === 4 && kingsOf(p4.deal.fen).k.r === 9, `two 6-wide armies in a 4-wide corridor: three deep each, gap 4, the kings nine apart (${p4.ok ? p4.deal.gap : p4.error})`);
  check(GAP_MIN === 2 && BOX === 10, 'the constants: a 10×10 box, a gap floor of 2');
}

// ---- 6. the order of the carried pattern survives the stamp (as-given)
{
  const pat = patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'N', dx: -1, dy: 0 }, { ch: 'R', dx: 1, dy: 0 }, { ch: 'P', dx: -1, dy: 1 }, { ch: 'P', dx: 0, dy: 1 }, { ch: 'P', dx: 1, dy: 1 }]);
  const bag = bagOfPattern(pat);
  check(bag.width === 3 && bag.back.join('') === 'NR' && bag.royal === 'K', `bagOfPattern: width ${bag.width}, back ${bag.back.join('')} in slot order`);
  const grid = Array.from({ length: 6 }, () => Array(5).fill(null));
  const asGiven = layoutArmy({ grid, files: 5, ranks: 6, side: 'white', army: bag, order: 'as-given', royalAt: { f: 2, row: 0 } });
  const sorted = layoutArmy({ grid, files: 5, ranks: 6, side: 'white', army: { ...bag, back: ['R', 'N'] }, order: 'as-given', royalAt: { f: 2, row: 0 } });
  const at = (l, p) => l.cells.find((c) => c.piece === p);
  check(at(asGiven, 'K').f === 2 && at(asGiven, 'K').r === 0, 'the pin: the royal on (2, 0)');
  check(at(asGiven, 'N').f !== at(sorted, 'N').f, `as-given: N-R and R-N stamp differently (N at file ${at(asGiven, 'N').f} vs ${at(sorted, 'N').f})`);
  const pinnedEdge = layoutArmy({ grid, files: 5, ranks: 6, side: 'white', army: bag, order: 'as-given', royalAt: { f: 0, row: 0 } });
  check(pinnedEdge && at(pinnedEdge, 'K').f === 0, 'the pin at file 0 keeps the royal on file 0 (the window slides, the king does not)');
  const blocked = layoutArmy({ grid: grid.map((row, r) => (r === 0 ? row.map((_, f) => (f === 2 ? '*' : null)) : row)), files: 5, ranks: 6, side: 'white', army: bag, order: 'as-given', royalAt: { f: 2, row: 0 } });
  check(blocked === null, 'a pin on a wall refuses (null)');
  const black = layoutArmy({ grid, files: 5, ranks: 6, side: 'black', army: bag, royalAt: { f: 3, row: 0 } });
  check(black && at(black, 'K').f === 3 && at(black, 'K').r === 5, 'the enemy pin: its royal on file 3 of the LAST row');
}

// ---- 7. a crop that hangs off the map is walled; the stage and the layers of a scarred crop
{
  const edge = worldOf(['.'.repeat(8), '.'.repeat(8), '.'.repeat(8), '.'.repeat(8), '..O.....', '.'.repeat(8), '.'.repeat(8), '.'.repeat(8)]);
  edge.godCrates.add(edge.idx(5, 5));
  edge.setTerrain(5, 5, '^');
  edge.opened.add(edge.idx(1, 1));
  {
    const tx = cropTransform({ wf: -2, wr: 2, facing: 0, files: 6, ranks: 8, worldFiles: 8, worldRanks: 8 });
    const b = boardOf(edge.arenaFen(tx, 'w'));
    let offMapWalls = 0, offMapTotal = 0, onMapWalls = 0;
    for (let r = 0; r < tx.ranks; r++) for (let f = 0; f < tx.files; f++) {
      const c = arenaToWorld(tx, f, r);
      const off = !c || !edge.inBounds(c.f, c.r);
      if (off) { offMapTotal++; if (b[tx.ranks - 1 - r][f] === '*') offMapWalls++; }
      else if (b[tx.ranks - 1 - r][f] === '*') onMapWalls++;
    }
    check(offMapTotal === 2 * 8 + 4 * 2 && offMapWalls === offMapTotal, `off-map squares read as walls in the crop's FEN (${offMapWalls}/${offMapTotal})`);
    check(onMapWalls === 1, `on the map only the pit is a wall (${onMapWalls})`);
    const layers = edge.cropLayers(tx);
    check(layers.holes.length === offMapTotal + 1, `every off-map square and the pit are the crop's holes (${layers.holes.length})`);
    const stage = edge.arenaStage(tx);
    check(stage.grid[0][0] === '*' && stage.grid[0][2] === null, 'arenaStage: an off-map square is a wall, floor is floor');
  }
  // A box on an 8×8 map hangs off it on three sides: the off-map squares are walls and the deal still stands.
  const army = spawnArmy(edge, makePattern(KIT, { seed: 1 }), { f: 3, r: 0 }, 0, 'w');
  const plan = planBarrier(edge, army, { enemy: KIT_ENEMY, seed: 1 });
  check(!plan.ok && /far row|no room|seal/.test(plan.error), `a box that hangs off an 8-rank map has no far row on the map: refused (${plan.ok ? 'dealt' : plan.error})`);
  const tall = worldOf(Array.from({ length: 12 }, () => '.'.repeat(8)));
  tall.setTerrain(2, 3, HOLE);
  tall.godCrates.add(tall.idx(5, 5));
  tall.setTerrain(5, 5, '^');
  const armyT = spawnArmy(tall, makePattern(KIT, { seed: 1 }), { f: 3, r: 0 }, 0, 'w');
  const planT = planBarrier(tall, armyT, { enemy: KIT_ENEMY, seed: 1 });
  check(planT.ok, `a box on an 8-file map: the files off the map are walls, the deal stands (${planT.ok ? `gap ${planT.deal.gap}` : planT.error})`);
  if (planT.ok) {
    const tx = planT.crop;
    const layers = tall.cropLayers(tx);
    const holeSq = worldToArena(tx, 2, 3);
    check(holeSq && layers.holes.includes(`${String.fromCharCode(97 + holeSq.f)}${holeSq.r + 1}`), `the floor's pit is in the crop's holes`);
    const crateSq = worldToArena(tx, 5, 5);
    check(!crateSq || layers.godCrates.includes(`${String.fromCharCode(97 + crateSq.f)}${crateSq.r + 1}`), `the floor's god crate is in the crop's godCrates`);
    check(layers.holes.length > 1, `the off-map files are holes to the gods (${layers.holes.length})`);
    const stage = tall.arenaStage(tx);
    check(stage.files === BOX && stage.ranks === BOX && stage.id.startsWith('lab@') && stage.grid[holeSq.r][holeSq.f] === '*', `arenaStage: a 10×10 stage named ${stage.id}, the pit a wall to the deal`);
  }
}

// ---- 8. the run records a duel as its result; a lost run is over; the lenient spawn walks a sealed king out whole
{
  const world = openFloor(20, 20);
  const pattern = makePattern(KIT, { seed: 1 });
  const army = spawnArmy(world, pattern, { f: 5, r: 5 }, 1, 'w');
  const run = newRun({ seed: 5, worldId: world.id, world, army });
  run.turns.push({ t: 1, kind: 'step', dx: 0, dy: 1 });
  run.turn = 1;
  recordDuel(run, { crop: { wf: 1, wr: 2, facing: 1, files: 10, ranks: 10 }, seed: 9, turn: 'w', result: '1-0', winner: 'white', termination: 'checkmate', plies: 40, quakes: 2, fen: '8/8 w - - 0 1', logId: 'x' });
  check(run.turns.length === 2 && run.turns[1].kind === 'duel' && run.turns[1].t === 1 && inputsOf(run).length === 1 && run.turn === 1, 'recordDuel: a duel entry in the turn list, not a walk turn');
  check(!runEnded(run), 'a run without a loss is not over');
  run.ended = { at: 'now', turn: 1, termination: 'checkmate', result: '0-1' };
  check(runEnded(run), 'a run with `ended` is over');
  updateRun(run, { world, army, turn: 1, debris: { v: 1, id: world.id, files: world.files, ranks: world.ranks, epoch: 1, next: 1, events: [], traffic: [], trafficEpoch: [] } });
  const opened = openRun(run);
  check(opened.debris && opened.debris.epoch === 1, 'the floor\'s debris ledger rides in the run save');
  updateRun(run, { world, army, turn: 2 });
  check(run.floors[run.floor].debris?.epoch === 1, 'a save without a ledger keeps the one it had');

  const sealed = worldOf(['........', '........', '..OOOO..', '..O..O..', '..OOOO..', '........', '........', '........']);
  let threw = false;
  try { spawnArmy(sealed, pattern, { f: 3, r: 4 }, 0, 'w'); } catch { threw = true; }
  check(threw, 'a strict spawn in a sealed 2-cell pocket throws');
  const out = spawnArmy(sealed, pattern, { f: 3, r: 4 }, 0, 'w', { lenient: true });
  check(out.pieces.length === 6 && out.king.f === 3 && out.king.r === 4 && out.pieces.every((p) => sealed.at(p.f, p.r) === FLOOR), `the lenient spawn walks all ${out.pieces.length} out, the king in his pocket`);
  check(new Set(out.pieces.map((p) => `${p.f},${p.r}`)).size === 6, 'no two pieces share a cell');
}

console.log(`test-barrier: ${ok}/${ok + bad} checks passed`);
process.exit(bad ? 1 : 0);
