#!/usr/bin/env node
// THE BOX + THE DUEL START (Phase 2 milestone 5, 2026-09-08 — the trigger
// conversation; 2026-09-10 — the enemies session, brief §5.1 rulings 3, 9,
// 16) — the Node gate for play/js/barrier.mjs: the arena is always 10×10 on
// the player's king (his rank row 0, the axis arena-north), placed by THE
// WALK'S OWN RULE (army.mjs boxOf: slid along his rank to hold every piece,
// centred on the formation when there is slack; a lone king gets the
// centred box), THE PIECES WHERE THEY STAND (nothing summoned), the enemy
// king on the far row — the king's own file first, else the nearest that
// deals — the kings nine apart, THE GAP BETWEEN THE CAMP LINES with a floor
// of 2 and a piece pre-moved ahead of the pawns inside it, the enemy molded
// around the player's pieces on ground connected to its king (never through
// a thin wall into the next room), an axis other than the facing refused
// until the army pivots, a crop hanging off the map walled, the run's duel
// entry, and THE WALK-OUT: survivors where they stood, the captured back
// beside the body, promotions reverted, a sealed king's whole army moved.
import { loadWorld, arenaToWorld, worldToArena, cropTransform, HOLE, FLOOR, WALL } from '../../play/js/world.mjs';
import { makePattern, spawnArmy, walkOutArmy, nearestHold, rotateBody, bagOfPattern, patternOf, planTurn, applyTurn, boxOf, OPENING_KIT } from '../../play/js/army.mjs';
import { planBarrier, planBox, boxPlacement, boxAt, reachOf, standingCells, farRowTargets, BOX, GAP_MIN } from '../../play/js/barrier.mjs';
import { layoutArmy, buildMatchup } from '../../play/js/armygen.mjs';
import { newRun, recordDuel, inputsOf, runEnded, updateRun, openRun } from '../../play/js/run.mjs';
import { parseBoard, splitFen } from '../../play/js/fen.mjs';

const KIT = OPENING_KIT; // 4 wide: K R N B + four pawns
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
/** Every white letter of a FEN with its arena cell. */
const whitesOf = (fen) => {
  const b = boardOf(fen);
  const ranks = b.length;
  const out = [];
  for (let r = 0; r < ranks; r++) for (let f = 0; f < b[r].length; f++) { const c = b[r][f]; if (c && c !== '*' && c !== '^' && c === c.toUpperCase()) out.push({ f, r: ranks - 1 - r, ch: c }); }
  return out;
};
const blacksOf = (fen) => {
  const b = boardOf(fen);
  const ranks = b.length;
  const out = [];
  for (let r = 0; r < ranks; r++) for (let f = 0; f < b[r].length; f++) { const c = b[r][f]; if (c && c !== '*' && c !== '^' && c === c.toLowerCase()) out.push({ f, r: ranks - 1 - r, ch: c }); }
  return out;
};
/** Does the deal read every piece of the army where it stands (the same letter on the same world cell)? */
const standsAsDealt = (plan, army) => {
  const ws = whitesOf(plan.deal.fen);
  if (ws.length !== army.pieces.length) return false;
  return army.pieces.every((p) => { const a = worldToArena(plan.crop, p.f, p.r); return a && ws.some((w) => w.f === a.f && w.r === a.r && w.ch === p.ch.toUpperCase()); });
};
/** Move a piece by hand (a test's "pre-moved" piece): the world's letters follow. */
const put = (world, army, p, f, r) => { world.setPiece(p.f, p.r, null); p.f = f; p.r = r; world.setPiece(f, r, army.letter(p.ch)); };

// A world from rows (top-down), '#' wall '.' floor '^' furniture 'O' hole '@' start.
function worldOf(rows, { id = 'lab' } = {}) {
  const map = rows.map((s) => s.replace(/O/g, '.'));
  const w = loadWorld({ schema: 2, id, map });
  rows.forEach((row, i) => { for (let f = 0; f < row.length; f++) if (row[f] === 'O') w.setTerrain(f, rows.length - 1 - i, HOLE); });
  return w;
}
const openFloor = (w, h) => worldOf(['#'.repeat(w), ...Array.from({ length: h - 2 }, () => '#' + '.'.repeat(w - 2) + '#'), '#'.repeat(w)]);

// ---- 1. the placement rule: a lone king gets the centred box; an army's box is the walk's (slid to hold every piece)
{
  const run = (left, right) => (f, r) => r === 0 && f >= -left && f <= right;
  const king = { f: 0, r: 0 };
  for (const [left, right, why] of [[20, 20, 'a wide hall'], [1, 20, 'one cell off the west wall of a wide hall'], [20, 1, 'one cell off the east wall'], [1, 2, 'a 4-wide run'], [0, 2, 'a 3-wide run with the king at its west cell'], [0, 0, 'a lone cell'], [9, 0, 'a run of ten with the king at its east end']]) {
    const p = boxPlacement(run(left, right), king, 0);
    check(p.kingFile === 4 && p.left === left && p.right === right && p.width === left + 1 + right, `${why}: a lone king at file 4, the run ${left} / ${right} reported`);
  }
  const w = openFloor(30, 30);
  const army = spawnArmy(w, makePattern(KIT, { seed: 1 }), { f: 14, r: 14 }, 0, 'w');
  const b0 = boxAt(w, army, 0);
  check(b0.ok && b0.kingFile === 4 && b0.box.minDx === -1 && b0.box.maxDx === 2, `the kit as it stands (N K R B, the king second from the left): the box holds it at file 4 (${JSON.stringify(b0.box)})`);
  const bishop = army.pieces.find((p) => p.ch === 'B');
  put(w, army, bishop, 14 + 7, 14); // seven files right of the king, on his rank
  const b1 = boxAt(w, army, 0);
  check(b1.ok && b1.box.maxDx === 7 && b1.kingFile === 1, `a bishop seven files right: the box SLIDES to hold him, the king at file ${b1.kingFile} (spread ${b1.box.spread})`);
  check(boxOf(army).kingFile === b1.kingFile, 'barrier.mjs boxAt and army.mjs boxOf are one rule');
  put(w, army, bishop, 14 + 8, 14);
  check(boxAt(w, army, 0).ok && boxAt(w, army, 0).kingFile === 1 && boxAt(w, army, 0).box.spread === 10, 'eight files right: the formation spans the whole box, the knight on its first file');
  put(w, army, bishop, 14 + 9, 14);
  check(!boxAt(w, army, 0).ok && boxAt(w, army, 0).crop === null, 'nine files right: no box holds the army (the knight a file left of the king), no crop');
  put(w, army, bishop, 14 + 1, 14 - 1);
  check(!boxAt(w, army, 0).ok && boxAt(w, army, 2).ok === false, 'a piece behind the king: the box does not hold the army along his facing');
  check(!planBox(w, army, { enemy: KIT_ENEMY, seed: 1 }).ok && /fit the box/.test(planBox(w, army, { enemy: KIT_ENEMY, seed: 1 }).error), 'planBox refuses an army the box does not hold');
}

// ---- 2. open ground at every facing: the box, the pieces where they stand, the gap, the crop's orientation, the terrain
{
  for (const facing of [0, 1, 2, 3]) {
    const w = openFloor(30, 30);
    const army = spawnArmy(w, makePattern(KIT, { seed: 1 }), { f: 14, r: 14 }, facing, 'w');
    const king = army.king;
    const box = boxAt(w, army, facing);
    check(box.crop.files === BOX && box.crop.ranks === BOX && box.kingFile === 4 && box.ok, `facing ${facing}: a 10×10 box, the king at file 4`);
    const tx = box.crop;
    const ahead = rotateBody(0, 1, facing), right = rotateBody(1, 0, facing);
    const c0 = arenaToWorld(tx, box.kingFile, 0), c1 = arenaToWorld(tx, box.kingFile, 1), c2 = arenaToWorld(tx, box.kingFile + 1, 0);
    check(c0.f === king.f && c0.r === king.r, `facing ${facing}: arena (kingFile, 0) is the king's cell`);
    check(c1.f === king.f + ahead.df && c1.r === king.r + ahead.dr, `facing ${facing}: arena-north is the facing`);
    check(c2.f === king.f + right.df && c2.r === king.r + right.dr, `facing ${facing}: arena-east is the army's right`);
    const back = worldToArena(tx, king.f, king.r);
    check(back && back.f === box.kingFile && back.r === 0, `facing ${facing}: the king's cell reads back as (kingFile, 0)`);
    const cells = standingCells(army, tx, w.arenaStage(tx));
    check(cells && cells.length === 8 && cells[0].piece === 'K' && cells[0].f === 4 && cells[0].r === 0 && cells.filter((c) => c.piece === 'P').every((c) => c.r === 1), `facing ${facing}: the standing cells are the kit's, the king on (4, 0), the pawns on row 1`);
    const plan = planBarrier(w, army, { enemy: KIT_ENEMY, seed: 7, turn: 'w' });
    check(plan.ok, `facing ${facing}: the barrier drops (${plan.ok ? '' : plan.error})`);
    if (!plan.ok) continue;
    const { K, k } = kingsOf(plan.deal.fen);
    check(K && K.r === 0 && K.f === plan.kingFile, `facing ${facing}: the player's king on row 0 of his file (${JSON.stringify(K)})`);
    check(k && k.r === BOX - 1 && k.f === plan.kingFile && plan.enemyFile === plan.kingFile, `facing ${facing}: the enemy king on the far row of the same file (${JSON.stringify(k)})`);
    check(k.r - K.r === 9, `facing ${facing}: the kings nine apart`);
    check(plan.axis === facing && plan.deal.world.axis === facing, `facing ${facing}: the axis is the facing`);
    check(plan.stage.files === BOX && plan.stage.ranks === BOX && plan.deal.files === BOX && plan.deal.ranks === BOX, `facing ${facing}: the deal is 10×10`);
    check(gapOf(plan.deal.fen) === 6 && plan.deal.gap === 6 && plan.deal.gapFront === 6, `facing ${facing}: the kit vs a 3-wide enemy on open ground leaves gap 6 between the camp lines (${plan.deal.gap})`);
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
    check(terrainOk, `facing ${facing}: the dealt FEN's terrain is the world's through the crop`);
    check(standsAsDealt(plan, army), `facing ${facing}: THE PIECES STAND WHERE THEY STAND — every letter on the walk's own cell, nothing summoned`);
    check(plan.deal.white.layout.standing === true && plan.deal.white.layout.cells.length === 8 && plan.deal.white.army.width === 4, `facing ${facing}: the deal's white side is the standing kit (width ${plan.deal.white.army.width})`);
  }
}

// ---- 3. the band: the far-row cell on the king's file is a pillar → the nearest file that deals; farRowTargets
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
  const targets = farRowTargets(w, army, { enemy: KIT_ENEMY, seed: 1 });
  check(targets.ok && targets.cells.length === 9 && !targets.cells.some((c) => c.f === 4) && targets.cells.every((c) => c.r === 9 && c.plan.ok && w.at(c.world.f, c.world.r) === FLOOR), `farRowTargets: nine far-row cells deal, the pillar's does not (${targets.cells.map((c) => c.f).join(',')})`);
  const open = openFloor(30, 30);
  const a2 = spawnArmy(open, makePattern(KIT, { seed: 1 }), { f: 14, r: 10 }, 0, 'w');
  check(farRowTargets(open, a2, { enemy: KIT_ENEMY, seed: 1 }).cells.length === 10, 'on open ground every far-row cell deals');
}

// ---- 4. the summoning lands only on ground connected to its king, and never on a player's piece
{
  // A 3-wide corridor (files 3–5) with a 1-thick wall at file 6 and a room beyond (files 7–12).
  const rows = Array.from({ length: 24 }, (_, i) => (i === 0 || i === 23 ? '#'.repeat(20) : '###...#......#######'));
  const w = worldOf(rows);
  const wide = { width: 6, pieces: ['Q', 'R', 'R', 'N', 'B'] };
  const army = spawnArmy(w, makePattern(wide, { seed: 1 }), { f: 4, r: 4 }, 0, 'w');
  check(army.pieces.every((p) => p.f >= 3 && p.f <= 5), `a 6-wide army spawned in a 3-wide corridor molds into it (files ${[...new Set(army.pieces.map((p) => p.f))].sort().join(',')})`);
  const plan = planBarrier(w, army, { enemy: KIT_ENEMY, seed: 1 });
  check(plan.ok, `a 6-wide army in a 3-wide corridor beside a room: the box deals (${plan.ok ? `gap ${plan.deal.gap}` : plan.error})`);
  if (plan.ok) {
    check(standsAsDealt(plan, army), 'the corridor army is dealt where it stands');
    const blacks = blacksOf(plan.deal.fen).map((c) => arenaToWorld(plan.crop, c.f, c.r));
    check(blacks.every((c) => c.f >= 3 && c.f <= 5), `every black piece stands in the corridor, none through the wall (files ${[...new Set(blacks.map((c) => c.f))].sort().join(',')})`);
    const b = boardOf(plan.deal.fen);
    // The room beyond the wall is still in the arena as floor (a knight may hop in).
    let roomFloor = 0;
    for (let r = 0; r < BOX; r++) for (let f = 0; f < BOX; f++) { const c = arenaToWorld(plan.crop, f, r); if (c.f >= 7 && b[BOX - 1 - r][f] === null) roomFloor++; }
    check(roomFloor > 0, `the room beyond the wall stays in the arena as floor (${roomFloor} cells)`);
  }
  // reachOf directly: the wall line with no gap seals; a door in it passes.
  const stage = w.arenaStage(boxAt(w, army, 0).crop);
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
  // THE ENEMY MOLDS AROUND THE PLAYER'S PIECES (ruling 16): a rook pre-moved deep into the enemy's rows.
  const open = openFloor(30, 30);
  const a2 = spawnArmy(open, makePattern(KIT, { seed: 1 }), { f: 14, r: 10 }, 0, 'w');
  const rook = a2.pieces.find((p) => p.ch === 'R');
  put(open, a2, rook, 12, 10 + 8); // arena (2, 8): inside black's rows, off the enemy king's file
  const p2 = planBarrier(open, a2, { enemy: KIT_ENEMY, seed: 1 });
  check(p2.ok && standsAsDealt(p2, a2), `a rook pre-moved into the enemy's rows is dealt where it stands (${p2.ok ? '' : p2.error})`);
  if (p2.ok) {
    const bl = blacksOf(p2.deal.fen);
    const rk = worldToArena(p2.crop, rook.f, rook.r);
    check(!bl.some((c) => c.f === rk.f && c.r === rk.r) && bl.length === 6, `the enemy molds AROUND it: no black piece on (${rk.f}, ${rk.r}), six black pieces dealt`);
    check(p2.deal.gap === 6 && p2.deal.gapFront < p2.deal.gap, `THE GAP IS BETWEEN THE CAMP LINES (${p2.deal.gap}), the pre-moved rook inside it (front gap ${p2.deal.gapFront})`);
  }
  // A pawn pushed ahead of the wall does not move the camp line (the wall of three holds it).
  const a3 = spawnArmy(openFloor(30, 30), makePattern(KIT, { seed: 1 }), { f: 14, r: 10 }, 0, 'w');
  const w3 = openFloor(30, 30);
  a3.stamp(w3);
  const pawn = a3.pieces.find((p) => p.ch === 'P');
  put(w3, a3, pawn, pawn.f, pawn.r + 3);
  const p3 = planBarrier(w3, a3, { enemy: KIT_ENEMY, seed: 1 });
  check(p3.ok && p3.deal.gap === 6 && p3.deal.gapFront === 3 && standsAsDealt(p3, a3), `a pawn three ahead of its wall: the camp line stays at the wall, gap ${p3.ok ? p3.deal.gap : p3.error} (front ${p3.ok ? p3.deal.gapFront : '?'})`);
  // buildMatchup refuses an overlap even when the caller's reach does not exclude the white cells: a rook standing on (4, 8), where the enemy's pawns mold.
  const stage3 = w3.arenaStage(boxAt(w3, a3, 0).crop);
  const cells = standingCells(a3, boxAt(w3, a3, 0).crop, stage3).map((c) => (c.piece === 'R' ? { ...c, f: 4, r: 8 } : c));
  const m = buildMatchup({ stage: stage3, white: { army: bagOfPattern(a3.pattern), cells }, black: { spec: KIT_ENEMY.spec, royalAt: { f: 4, row: 0 }, reach: () => true }, seed: 1, gapMin: GAP_MIN, gapAt: 'camp' });
  check(m.error && /white piece/.test(m.error), `buildMatchup refuses black molded onto white (${m.error})`);
  const m2 = buildMatchup({ stage: stage3, white: { army: bagOfPattern(a3.pattern), cells }, black: { spec: KIT_ENEMY.spec, royalAt: { f: 4, row: 0 }, reach: (f, r) => !(f === 4 && r === 8) }, seed: 1, gapMin: GAP_MIN, gapAt: 'camp' });
  check(!m2.error && blacksOf(m2.fen).length === 6 && !blacksOf(m2.fen).some((c) => c.f === 4 && c.r === 8), `with the rook's cell out of reach the enemy molds around it (gap ${m2.gap})`);
}

// ---- 5. the gap is an output with a floor of 2; a depth past the box refuses
{
  const eight = { width: 8, pieces: ['Q', 'R', 'R', 'B', 'B', 'N', 'N'] };
  const eightEnemy = { spec: { width: 8, pieces: ['Q', 'R', 'R', 'B', 'B', 'N', 'N'] } };
  const corridor = (width) => worldOf(['#'.repeat(width + 2), ...Array.from({ length: 30 }, () => '#' + '.'.repeat(width) + '#'), '#'.repeat(width + 2)]);
  const c5 = corridor(5);
  const a5 = spawnArmy(c5, makePattern(eight, { seed: 1 }), { f: 3, r: 4 }, 0, 'w');
  const p5 = planBarrier(c5, a5, { enemy: eightEnemy, seed: 1 });
  check(p5.ok && p5.deal.gap >= GAP_MIN && p5.deal.gapFront <= p5.deal.gap && kingsOf(p5.deal.fen).k.r === 9, `two 8-wide armies in a 5-wide corridor: the enemy four deep, the gap ${p5.ok ? p5.deal.gap : p5.error} between the camp lines (front ${p5.ok ? p5.deal.gapFront : '?'}), the kings nine apart`);
  const c3 = corridor(3);
  const a3 = spawnArmy(c3, makePattern(eight, { seed: 1 }), { f: 2, r: 4 }, 0, 'w');
  const p3 = planBarrier(c3, a3, { enemy: eightEnemy, seed: 1 });
  check(!p3.ok, `two 8-wide armies in a 3-wide corridor: past the box, refused (${p3.error})`);
  const c4 = corridor(4);
  const a4 = spawnArmy(c4, makePattern({ width: 6, pieces: ['Q', 'R', 'R', 'N', 'B'] }, { seed: 1 }), { f: 2, r: 4 }, 0, 'w');
  const p4 = planBarrier(c4, a4, { enemy: { spec: { width: 6, pieces: ['Q', 'R', 'N', 'B', 'N'] } }, seed: 1 });
  check(p4.ok && p4.deal.gap >= GAP_MIN && kingsOf(p4.deal.fen).k.r === 9 && standsAsDealt(p4, a4), `two 6-wide armies in a 4-wide corridor: dealt where they stand, gap ${p4.ok ? p4.deal.gap : p4.error}, the kings nine apart`);
  check(GAP_MIN === 2 && BOX === 10, 'the constants: a 10×10 box, a gap floor of 2');
}

// ---- 6. the order of a carried pattern survives the enemy's molding (as-given)
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
  // A walking enemy carries its pattern in as `army`: the deal reads its bag as given.
  const w = openFloor(30, 30);
  const army = spawnArmy(w, makePattern(KIT, { seed: 1 }), { f: 14, r: 10 }, 0, 'w');
  const plan = planBarrier(w, army, { enemy: { army: bag, order: 'as-given' }, seed: 1 });
  check(plan.ok && blacksOf(plan.deal.fen).length === 6 && plan.deal.black.army.back.join('') === 'NR', `a carried enemy bag deals as given (${plan.ok ? plan.deal.black.army.back.join('') : plan.error})`);
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

// ---- 8. an axis other than the facing: refused as the army stands, dealt after the pivot (a catch from the side or behind)
{
  const w = openFloor(30, 30);
  const army = spawnArmy(w, makePattern(KIT, { seed: 1 }), { f: 14, r: 14 }, 0, 'w');
  for (const axis of [1, 2, 3]) {
    const asStands = planBox(w, army, { enemy: KIT_ENEMY, seed: 1, axis });
    check(!asStands.ok && /fit the box/.test(asStands.error), `axis ${axis} on a north-facing army: the pawns are behind the king along it, refused (${asStands.error})`);
  }
  for (const axis of [1, 2, 3]) {
    const w2 = openFloor(30, 30);
    const a2 = spawnArmy(w2, makePattern(KIT, { seed: 1 }), { f: 14, r: 14 }, 0, 'w');
    const pv = planTurn(w2, a2, { kind: 'face', facing: axis });
    check(pv.ok && pv.pivot, `the pivot to axis ${axis} plans`);
    applyTurn(w2, a2, pv);
    const plan = planBarrier(w2, a2, { enemy: KIT_ENEMY, seed: 1, axis });
    check(plan.ok && plan.axis === axis && plan.crop.facing === axis && standsAsDealt(plan, a2) && kingsOf(plan.deal.fen).k.r === 9, `after the pivot the box deals along axis ${axis}, the pieces where they now stand, the enemy nine ahead (${plan.ok ? `gap ${plan.deal.gap}` : plan.error})`);
    check(a2.facing === axis, 'the army faces the axis');
  }
}

// ---- 9. the run records a duel as its result; a lost run is over; the walk-out
{
  const world = openFloor(20, 20);
  const pattern = makePattern(KIT, { seed: 1 });
  const army = spawnArmy(world, pattern, { f: 5, r: 5 }, 1, 'w');
  const run = newRun({ seed: 5, worldId: world.id, world, army });
  run.turns.push({ t: 1, kind: 'step', dx: 0, dy: 1 });
  run.turn = 1;
  recordDuel(run, { crop: { wf: 1, wr: 2, facing: 1, files: 10, ranks: 10 }, seed: 9, turn: 'w', axis: 1, pivoted: false, result: '1-0', winner: 'white', termination: 'checkmate', plies: 40, quakes: 2, fen: '8/8 w - - 0 1', logId: 'x' });
  check(run.turns.length === 2 && run.turns[1].kind === 'duel' && run.turns[1].t === 1 && inputsOf(run).length === 1 && run.turn === 1, 'recordDuel: a duel entry in the turn list, not a walk turn');
  check(!runEnded(run), 'a run without a loss is not over');
  run.ended = { at: 'now', turn: 1, termination: 'checkmate', result: '0-1' };
  check(runEnded(run), 'a run with `ended` is over');
  updateRun(run, { world, army, turn: 1, debris: { v: 1, id: world.id, files: world.files, ranks: world.ranks, epoch: 1, next: 1, events: [], traffic: [], trafficEpoch: [] } });
  const opened = openRun(run);
  check(opened.debris && opened.debris.epoch === 1, 'the floor\'s debris ledger rides in the run save');
  updateRun(run, { world, army, turn: 2 });
  check(run.floors[run.floor].debris?.epoch === 1, 'a save without a ledger keeps the one it had');

  // spawnArmy's knobs: an unstamped spawn leaves the grid clean; fixed cells are taken verbatim.
  const clean = openFloor(20, 20);
  const ghost = spawnArmy(clean, pattern, { f: 5, r: 5 }, 0, 'w', { stamp: false });
  check(ghost.pieces.length === 8 && clean.pieces.every((c) => c === null), 'an unstamped spawn writes no letter on the world');
  const fixed = new Map([[1, { f: 9, r: 9 }]]);
  const fx = spawnArmy(clean, pattern, { f: 5, r: 5 }, 0, 'w', { fixed, stamp: false });
  check(fx.pieces.find((p) => p.slot === 1).f === 9 && fx.pieces.find((p) => p.slot === 1).r === 9 && !fx.pieces.some((p) => p.slot !== 1 && p.f === 9 && p.r === 9), 'a fixed slot takes its cell and nobody else lands on it');

  // THE WALK-OUT (ruling 3's other half): the survivors where they stood, the captured back beside the body, promotions reverted.
  const w2 = openFloor(20, 20);
  const a2 = spawnArmy(w2, pattern, { f: 5, r: 5 }, 0, 'w');
  const k0 = { ...a2.king };
  // The duel's end: the king two ahead, the rook far right, one pawn gone (captured), one pawn promoted to a queen on the far row.
  const survivors = [{ ch: 'K', f: k0.f, r: k0.r + 2 }, { ch: 'N', f: k0.f - 1, r: k0.r }, { ch: 'B', f: k0.f + 2, r: k0.r + 1 }, { ch: 'R', f: k0.f + 5, r: k0.r + 4 }, { ch: 'P', f: k0.f, r: k0.r + 1 }, { ch: 'P', f: k0.f + 1, r: k0.r + 3 }, { ch: 'Q', f: k0.f - 1, r: k0.r + 9 }];
  w2.clearPieces(() => true);
  const out = walkOutArmy(w2, pattern, { f: k0.f, r: k0.r + 2 }, 0, survivors, 'w');
  check(out.pieces.length === 8 && out.king.f === k0.f && out.king.r === k0.r + 2 && out.facing === 0, `the walk-out army is whole (${out.pieces.length}), the king where the duel left him`);
  const stands = (ch, f, r) => out.pieces.some((p) => p.ch === ch && p.f === f && p.r === r);
  check(stands('R', k0.f + 5, k0.r + 4) && stands('N', k0.f - 1, k0.r) && stands('B', k0.f + 2, k0.r + 1) && stands('P', k0.f, k0.r + 1) && stands('P', k0.f + 1, k0.r + 3), 'the survivors stand where they stood');
  check(stands('P', k0.f - 1, k0.r + 9) && !out.pieces.some((p) => p.ch === 'Q'), 'the promoted queen is a pawn again at her cell');
  const returned = out.pieces.filter((p) => p.ch === 'P' && !survivors.some((s) => s.f === p.f && s.r === p.r));
  check(returned.length === 1 && w2.at(returned[0].f, returned[0].r) === FLOOR && Math.max(Math.abs(returned[0].f - out.king.f), Math.abs(returned[0].r - out.king.r)) <= 3, `the captured pawn returns beside the body (${returned[0]?.f}, ${returned[0]?.r})`);
  check(new Set(out.pieces.map((p) => `${p.f},${p.r}`)).size === 8 && out.pieces.every((p) => w2.pieceAt(p.f, p.r) === 'K' || w2.pieceAt(p.f, p.r) === p.ch), 'no two pieces share a cell; the world carries the letters');
  check(out.pieces.map((p) => p.slot).sort((a, b) => a - b).join(',') === '0,1,2,3,4,5,6,7', 'every slot is filled once');
  // A promoted rook beside the surviving rook: the nearer one keeps the rook's slot, the other is a pawn.
  const w3 = openFloor(20, 20);
  const a3 = spawnArmy(w3, pattern, { f: 5, r: 5 }, 0, 'w');
  const rSlot = a3.slotOf(a3.pieces.find((p) => p.ch === 'R'));
  w3.clearPieces(() => true);
  const out3 = walkOutArmy(w3, pattern, { f: 5, r: 5 }, 0, [{ ch: 'K', f: 5, r: 5 }, { ch: 'R', f: rSlot.f, r: rSlot.r }, { ch: 'R', f: 5, r: 14 }, { ch: 'N', f: 4, r: 5 }, { ch: 'B', f: 7, r: 5 }], 'w');
  check(out3.pieces.filter((p) => p.ch === 'R').length === 1 && out3.pieces.some((p) => p.ch === 'R' && p.f === rSlot.f && p.r === rSlot.r) && out3.pieces.some((p) => p.ch === 'P' && p.f === 5 && p.r === 14) && out3.pieces.length === 8, 'two rooks on the board: the one on the rook\'s slot keeps it, the far one reverts to a pawn, three pawns return');

  // THE SEALED KING (ruling 15): the pocket cannot hold the army → the whole army moves to the nearest floor that can.
  const sealed = worldOf(['........', '........', '..OOOO..', '..O..O..', '..OOOO..', '........', '........', '........']);
  let threw = false;
  try { spawnArmy(sealed, pattern, { f: 3, r: 4 }, 0, 'w'); } catch { threw = true; }
  check(threw, 'a strict spawn in a sealed 2-cell pocket throws');
  const hold = nearestHold(sealed, { f: 3, r: 4 }, 8);
  check(hold && sealed.at(hold.f, hold.r) === FLOOR && Math.max(Math.abs(hold.f - 3), Math.abs(hold.r - 4)) === 2, `nearestHold: the nearest cell of a region that holds eight (${hold?.f}, ${hold?.r})`);
  const out4 = walkOutArmy(sealed, pattern, { f: 3, r: 4 }, 0, [{ ch: 'K', f: 3, r: 4 }, { ch: 'R', f: 4, r: 4 }], 'w');
  check(out4.pieces.length === 8 && !(out4.king.f === 3 && out4.king.r === 4) && !(out4.king.f === 4 && out4.king.r === 4) && out4.pieces.every((p) => sealed.at(p.f, p.r) === FLOOR), `the whole army moves out of the pocket to the nearest floor that holds it (the king at ${out4.king.f}, ${out4.king.r})`);
  check(new Set(out4.pieces.map((p) => `${p.f},${p.r}`)).size === 8, 'no two pieces share a cell');
  const lenientOut = spawnArmy(sealed, pattern, { f: 3, r: 4 }, 0, 'w', { lenient: true, stamp: false });
  check(lenientOut.pieces.length === 8 && lenientOut.king.f === 3 && lenientOut.king.r === 4, `the lenient spawn still exists for a floor with no region that holds the army (the king in his pocket)`);
}

console.log(`test-barrier: ${ok}/${ok + bad} checks passed`);
process.exit(bad ? 1 : 0);
