#!/usr/bin/env node
// THE BARRIER BY HAND (Phase 2 milestone 4c) — the Node gate for
// play/js/barrier.mjs: where the barrier drops on an army as it stands and
// the deal it stamps. On the walk-around fixture at every facing and on
// synthetic floors: the king anchors row 0 on his own file, the enemy king
// stands on that file on the last row, the gap is exactly 4, the crop reads
// north-up under the army's facing, the depth is computed (a 2-deep kit vs
// a 2-deep enemy is 8 ranks; terrain deepens it; past 10 refuses), the
// width is the room's capped at 12 and centred on the king, a crawlspace
// refuses, a crop hanging off the map is walled, the carried pattern keeps
// its marching order, the run records a duel as its result, and a sealed
// king walks out whole.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadWorld, World, arenaToWorld, worldToArena, cropTransform, HOLE, FLOOR, WALL } from '../../play/js/world.mjs';
import { makePattern, spawnArmy, rotateBody, bagOfPattern, patternOf, Army } from '../../play/js/army.mjs';
import { planBarrier, barrierWindow, cropAt, GAP, MAX_FILES } from '../../play/js/barrier.mjs';
import { layoutArmy } from '../../play/js/armygen.mjs';
import { newRun, recordDuel, inputsOf, runEnded, updateRun, openRun } from '../../play/js/run.mjs';
import { parseBoard, splitFen } from '../../play/js/fen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const W01 = JSON.parse(readFileSync(path.join(here, '..', '..', 'play', 'worlds', 'w01-the-undercroft.json'), 'utf8'));
const KIT = { width: 3, royal: 'K', pieces: ['R', 'N'] };
const ENEMY = { spec: { width: 6, budget: 24 }, archetype: 'heavies-deep' };

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

// ---- 1. the fixture at every facing: geometry, the gap, the pin, the order
{
  const results = {};
  for (const facing of [0, 1, 2, 3]) {
    const world = loadWorld(W01);
    const pattern = makePattern(KIT, { archetype: 'heavies-deep', seed: 1 });
    const at = world.start;
    const army = spawnArmy(world, pattern, { f: at.f, r: at.r }, facing, 'w');
    const king = army.king;
    const win = barrierWindow(world, king, facing);
    check(win && win.files >= 3 && win.files <= MAX_FILES, `facing ${facing}: a window across the king (${JSON.stringify(win)})`);
    if (win) {
      const tx = cropAt(world, king, facing, win.files, win.kingFile, 8);
      const ahead = rotateBody(0, 1, facing), right = rotateBody(1, 0, facing);
      const c0 = arenaToWorld(tx, win.kingFile, 0), c1 = arenaToWorld(tx, win.kingFile, 1), c2 = arenaToWorld(tx, win.kingFile + 1, 0);
      check(c0.f === king.f && c0.r === king.r, `facing ${facing}: arena (kingFile, 0) is the king's cell`);
      check(c1.f === king.f + ahead.df && c1.r === king.r + ahead.dr, `facing ${facing}: arena-north is the facing`);
      check(c2.f === king.f + right.df && c2.r === king.r + right.dr, `facing ${facing}: arena-east is the army's right`);
      const back = worldToArena(tx, king.f, king.r);
      check(back && back.f === win.kingFile && back.r === 0, `facing ${facing}: the king's cell reads back as (kingFile, 0)`);
    }
    const plan = planBarrier(world, army, { enemy: ENEMY, seed: 7, turn: 'w' });
    results[facing] = plan;
    if (!plan.ok) continue;
    const { K, k } = kingsOf(plan.deal.fen);
    check(K && K.r === 0 && K.f === plan.kingFile, `facing ${facing}: the player's king on row 0 of his file (${JSON.stringify(K)})`);
    check(k && k.r === plan.stage.ranks - 1 && k.f === plan.kingFile, `facing ${facing}: the enemy king on the last row of the same file (${JSON.stringify(k)})`);
    check(gapOf(plan.deal.fen) === GAP && plan.deal.gap === GAP, `facing ${facing}: the gap is exactly ${GAP} (${gapOf(plan.deal.fen)})`);
    check(plan.stage.ranks >= 8 && plan.stage.ranks <= 10 && plan.stage.files === plan.crop.files, `facing ${facing}: ${plan.stage.files}×${plan.stage.ranks}, the depth computed`);
    check(plan.deal.variantName.startsWith(`duel_${plan.stage.files}x${plan.stage.ranks}__`) && plan.deal.variantIni.includes(plan.deal.variantName), `facing ${facing}: the deal's camp-line variant (${plan.deal.variantName})`);
    // The crop's terrain is the world's: every wall in the FEN is a wall / hole / off-map cell in the world.
    const b = boardOf(plan.deal.fen);
    let terrainOk = true;
    for (let r = 0; r < plan.stage.ranks; r++) for (let f = 0; f < plan.stage.files; f++) {
      const ch = b[plan.stage.ranks - 1 - r][f];
      const c = arenaToWorld(plan.crop, f, r);
      const t = c && world.inBounds(c.f, c.r) ? world.at(c.f, c.r) : undefined;
      const wantWall = t === undefined || t === WALL || t === HOLE;
      if ((ch === '*') !== wantWall) terrainOk = false;
      if ((ch === '^') !== (t === '^')) terrainOk = false;
    }
    check(terrainOk, `facing ${facing}: the stamped FEN's terrain is the world's through the crop`);
    // The stamp keeps the marching order: the kit's back row R then N reads R, N left to right around the king? The pattern's slots order R before N; the molding puts them centre-out: N (first) nearest the centre... assert the letters present and the pawns in front per file.
    const wCells = plan.deal.white.layout.cells;
    check(wCells.filter((c) => c.piece === 'P').length === 3 && wCells.some((c) => c.piece === 'R') && wCells.some((c) => c.piece === 'N') && wCells.length === 6, `facing ${facing}: the whole kit materializes (${wCells.length} pieces)`);
  }
  check(results[1].ok, `facing east (the corridor): the barrier drops (${results[1].ok ? `${results[1].stage.files}×${results[1].stage.ranks}` : results[1].error})`);
  check(!results[0].ok && /no room/.test(results[0].error), `facing north in the antechamber: refused with one line (${results[0].error})`);
}

// ---- 2. the order of the carried pattern survives the stamp (as-given)
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

// ---- 3. synthetic floors: open ground 8 ranks / kings 7 apart; a crawlspace; a hall wider than 12; terrain deepening the crop; past 10 refused
{
  const open = worldOf(['#'.repeat(14), ...Array.from({ length: 14 }, () => '#' + '.'.repeat(12) + '#'), '#'.repeat(14)]);
  const pattern = makePattern(KIT, { seed: 1 });
  const army = spawnArmy(open, pattern, { f: 6, r: 2 }, 0, 'w');
  const plan = planBarrier(open, army, { enemy: { spec: { width: 3, pieces: ['R', 'N'] } }, seed: 1 });
  check(plan.ok && plan.stage.ranks === 8 && gapOf(plan.deal.fen) === 4, `open ground, kit vs kit: 8 ranks, gap 4 (${plan.ok ? plan.stage.ranks : plan.error})`);
  const { K, k } = kingsOf(plan.deal.fen);
  check(plan.ok && k.r - K.r === 7, `open ground: the kings 7 apart (${k.r - K.r})`);
  check(plan.ok && plan.stage.files === 10 && plan.kingFile === 4 && arenaToWorld(plan.crop, 4, 0).f === 6, `a 12-wide room: the ARENA cap of 10 files, the king centred (file ${plan.kingFile})`);

  const wide = worldOf(['#'.repeat(24), ...Array.from({ length: 14 }, () => '#' + '.'.repeat(22) + '#'), '#'.repeat(24)]);
  const armyEdge = spawnArmy(wide, pattern, { f: 2, r: 2 }, 0, 'w');
  const planEdge = planBarrier(wide, armyEdge, { enemy: { spec: { width: 3, pieces: ['R', 'N'] } }, seed: 1 });
  check(planEdge.ok && planEdge.stage.files === 10 && planEdge.kingFile === 1, `a hall wider than 10, the king one cell off the wall: the 10-file window slides whole to stay in the room (king file ${planEdge.ok ? planEdge.kingFile : planEdge.error})`);
  const armyMid = spawnArmy(wide, makePattern(KIT, { seed: 1 }), { f: 11, r: 2 }, 0, 'w');
  const planMid = planBarrier(wide, armyMid, { enemy: { spec: { width: 3, pieces: ['R', 'N'] } }, seed: 1 });
  check(planMid.ok && planMid.stage.files === 10 && planMid.kingFile === 4 && arenaToWorld(planMid.crop, 4, 0).f === 11, `mid-hall: the 10-file window centred on the king (king file ${planMid.ok ? planMid.kingFile : planMid.error})`);

  const narrow = worldOf(['#'.repeat(6), ...Array.from({ length: 14 }, () => '##..##'), '#'.repeat(6)]);
  const armyN = spawnArmy(narrow, makePattern(KIT, { seed: 1 }), { f: 2, r: 2 }, 0, 'w');
  const planN = planBarrier(narrow, armyN, { enemy: { spec: { width: 3, pieces: ['R', 'N'] } }, seed: 1 });
  check(!planN.ok && /under 3 wide/.test(planN.error), `a 2-wide crawlspace refuses (${planN.error})`);

  // Terrain in the enemy's rows deepens the molding: a pillar row 8 ahead makes the enemy 3 deep → 9 ranks.
  const pillars = worldOf(['#'.repeat(14), ...Array.from({ length: 14 }, (_, i) => (i === 4 ? '#..#..#..#..##' : '#' + '.'.repeat(12) + '#')), '#'.repeat(14)]);
  // rows are top-down: i=4 is rank 15-1-4 = 10 from the bottom; the king at r 2 → arena row 8 = the enemy's rank when ranks 9
  const armyP = spawnArmy(pillars, makePattern(KIT, { seed: 1 }), { f: 6, r: 2 }, 0, 'w');
  const planP = planBarrier(pillars, armyP, { enemy: { spec: { width: 6, pieces: ['Q', 'R', 'N', 'B', 'N'] } }, seed: 1 });
  check(planP.ok && gapOf(planP.deal.fen) === 4 && planP.stage.ranks >= 8, `terrain ahead: still gap 4, the depth follows the molding (${planP.ok ? `${planP.stage.files}×${planP.stage.ranks}` : planP.error})`);

  // Two deep armies in a 3-wide corridor overflow the engine's 10 ranks → refused.
  const corridor = worldOf(['#'.repeat(7), ...Array.from({ length: 16 }, () => '##...##'), '#'.repeat(7)]);
  const armyC = spawnArmy(corridor, makePattern({ width: 6, pieces: ['Q', 'R', 'R', 'N', 'B'] }, { seed: 1 }), { f: 3, r: 1 }, 0, 'w');
  const planC = planBarrier(corridor, armyC, { enemy: { spec: { width: 6, pieces: ['Q', 'R', 'N', 'B', 'N'] } }, seed: 1 });
  check(!planC.ok && /no room/.test(planC.error), `two 6-wide armies in a 3-wide corridor: past 10 ranks, refused (${planC.error})`);
}

// ---- 4. a crop that hangs off the map is walled; the stage and the layers of a scarred crop
{
  const edge = worldOf(['.'.repeat(8), '.'.repeat(8), '.'.repeat(8), '.'.repeat(8), '..O.....', '.'.repeat(8), '.'.repeat(8), '.'.repeat(8)]);
  edge.godCrates.add(edge.idx(5, 5));
  edge.setTerrain(5, 5, '^');
  edge.opened.add(edge.idx(1, 1));
  // The window is the room's floor run and the enemy king must stand on
  // floor, so a planned crop never hangs off the map — the wall fallback
  // is a safety net, exercised here on a hand-built crop two files off
  // the west edge and two ranks off the north.
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
  const army = spawnArmy(edge, makePattern(KIT, { seed: 1 }), { f: 3, r: 0 }, 0, 'w');
  const plan = planBarrier(edge, army, { enemy: { spec: { width: 3, pieces: ['R', 'N'] } }, seed: 1 });
  check(plan.ok, `a crop on the map's south edge drops (${plan.ok ? `${plan.stage.files}×${plan.stage.ranks}` : plan.error})`);
  if (plan.ok) {
    const tx = plan.crop;
    const layers = edge.cropLayers(tx);

    const holeSq = worldToArena(tx, 2, 3);
    check(holeSq && layers.holes.includes(`${String.fromCharCode(97 + holeSq.f)}${holeSq.r + 1}`), `the floor's pit is in the crop's holes (${layers.holes.join(',')})`);
    const crateSq = worldToArena(tx, 5, 5);
    check(!crateSq || layers.godCrates.includes(`${String.fromCharCode(97 + crateSq.f)}${crateSq.r + 1}`), `the floor's god crate is in the crop's godCrates`);
    const stage = edge.arenaStage(tx);
    check(stage.files === tx.files && stage.ranks === tx.ranks && stage.grid[3 - 0]?.length === tx.files && stage.id.startsWith('lab@'), `arenaStage: a ${stage.files}×${stage.ranks} stage named ${stage.id}`);
    check(stage.grid[holeSq.r][holeSq.f] === '*', 'arenaStage: the pit is a wall to the deal');
  }
}

// ---- 5. the run records a duel as its result; a lost run is over; the lenient spawn walks a sealed king out whole
{
  const world = loadWorld(W01);
  const pattern = makePattern(KIT, { seed: 1 });
  const army = spawnArmy(world, pattern, { f: world.start.f, r: world.start.r }, 1, 'w');
  const run = newRun({ seed: 5, worldId: world.id, world, army });
  run.turns.push({ t: 1, kind: 'step', dx: 0, dy: 1 });
  run.turn = 1;
  recordDuel(run, { crop: { wf: 1, wr: 2, facing: 1, files: 8, ranks: 9 }, seed: 9, turn: 'w', result: '1-0', winner: 'white', termination: 'checkmate', plies: 40, quakes: 2, fen: '8/8 w - - 0 1', logId: 'x' });
  check(run.turns.length === 2 && run.turns[1].kind === 'duel' && run.turns[1].t === 1 && inputsOf(run).length === 1 && run.turn === 1, 'recordDuel: a duel entry in the turn list, not a walk turn');
  check(!runEnded(run), 'a run without a loss is not over');
  run.ended = { at: 'now', turn: 1, termination: 'checkmate', result: '0-1' };
  check(runEnded(run), 'a run with `ended` is over');
  updateRun(run, { world, army, turn: 1, debris: { v: 1, id: world.id, files: world.files, ranks: world.ranks, epoch: 1, next: 1, events: [], traffic: [], trafficEpoch: [] } });
  const opened = openRun(run);
  check(opened.debris && opened.debris.epoch === 1, 'the floor\'s debris ledger rides in the run save');
  updateRun(run, { world, army, turn: 2 });
  check(run.floors[run.floor].debris?.epoch === 1, 'a save without a ledger keeps the one it had');

  // A sealed king: pits all round a 2-cell pocket; the lenient spawn puts the rest on the nearest floor beyond.
  const sealed = worldOf(['........', '........', '..OOOO..', '..O..O..', '..OOOO..', '........', '........', '........']);
  let threw = false;
  try { spawnArmy(sealed, pattern, { f: 3, r: 4 }, 0, 'w'); } catch { threw = true; }
  check(threw, 'a strict spawn in a sealed 2-cell pocket throws');
  const out = spawnArmy(sealed, pattern, { f: 3, r: 4 }, 0, 'w', { lenient: true });
  check(out.pieces.length === 6 && out.king.f === 3 && out.king.r === 4 && out.pieces.every((p) => sealed.at(p.f, p.r) === FLOOR), `the lenient spawn walks all ${out.pieces.length} out, the king in his pocket, the rest on the nearest floor`);
  check(new Set(out.pieces.map((p) => `${p.f},${p.r}`)).size === 6, 'no two pieces share a cell');
}

console.log(`test-barrier: ${ok}/${ok + bad} checks passed`);
process.exit(bad ? 1 : 0);
