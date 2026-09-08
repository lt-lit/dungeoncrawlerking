// THE WORLD's Node gate (Phase 2 milestone 4, 2026-09-08): play/js/world.mjs —
// the crop transform against brute force at every facing (a square lands
// in one cell, round-trips, its pixels turn with it, the crop agrees with
// the camera: a crop under a facing painted with the same facing up puts
// the arena's squares on the screen at a constant offset), the identity is
// the Phase 1 page's old behaviour, and the world's read / write paths
// (a stage becomes a world, an arena writes into a crop and reads back as
// the same FEN, a world file loads with its start, a save round-trips).
// No browser, no engine. Usage (from phase0/): node harness/test-world.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as W from '../../play/js/world.mjs';
import { toScreen, pxToScreen, FACINGS } from '../../play/js/camera.mjs';
import { loadStageV2 } from '../../play/js/stage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let ok = 0;
const bad = [];
const expect = (cond, what) => { if (cond) ok++; else bad.push(what); };
const T = W.T;
const sqName = (f, r) => String.fromCharCode(97 + f) + (r + 1);

// --- the crop: every arena square lands in one world cell inside the rectangle and round-trips
for (const [files, ranks] of [[10, 10], [7, 5], [3, 10], [12, 6]]) {
  for (let facing = 0; facing < FACINGS; facing++) {
    const tx = W.cropTransform({ wf: 4, wr: 3, facing, files, ranks, worldFiles: 40, worldRanks: 30 });
    const seen = new Set();
    let inside = true, round = true, px = true;
    for (let f = 0; f < files; f++) for (let r = 0; r < ranks; r++) {
      const c = W.arenaToWorld(tx, f, r);
      if (!c || c.f < tx.wf || c.f >= tx.wf + tx.w || c.r < tx.wr || c.r >= tx.wr + tx.h) inside = false;
      seen.add(`${c.f},${c.r}`);
      const a = W.worldToArena(tx, c.f, c.r);
      if (!a || a.f !== f || a.r !== r) round = false;
      const sq = sqName(f, r);
      const e = W.toEnvCell(tx, sq);
      if (e.ef !== c.f || e.er !== c.r || W.fromEnvCell(tx, c.f, c.r) !== sq) round = false;
      // Pixels: a point in the square lands in the square's cell, and comes back.
      const p = W.toEnvPx(tx, sq, 3, 5);
      const cell = W.cellOfPx(tx, p.x, p.y);
      if (cell.ef !== c.f || cell.er !== c.r) px = false;
      const back = W.toArenaPx(tx, p.x, p.y);
      if (!back || back.sq !== sq || back.x !== f * T + 3 || back.y !== (ranks - 1 - r) * T + 5) px = false;
    }
    expect(inside && round && seen.size === files * ranks, `${files}×${ranks} f${facing}: every square lands inside the rectangle once and round-trips`);
    expect(px, `${files}×${ranks} f${facing}: a pixel inside a square round-trips through the env`);
    expect(tx.w * tx.h === files * ranks && (facing & 1 ? tx.w === ranks : tx.w === files), `${files}×${ranks} f${facing}: the rectangle is ${tx.w}×${tx.h} in world axes`);
    // Outside the rectangle is null, not a wrong square.
    expect(W.worldToArena(tx, tx.wf - 1, tx.wr) === null && W.worldToArena(tx, tx.wf + tx.w, tx.wr) === null && W.fromEnvCell(tx, tx.wf, tx.wr + tx.h) === null, `${files}×${ranks} f${facing}: outside the crop is null`);
    expect(W.toArenaPx(tx, tx.wf * T - 1, (30 - tx.wr - tx.h) * T) === null, `${files}×${ranks} f${facing}: a pixel outside the crop is null`);
  }
}

// --- the crop agrees with the camera: the arena's squares sit on the screen at a constant offset
{
  const worldFiles = 40, worldRanks = 30;
  for (let facing = 0; facing < FACINGS; facing++) {
    const files = 10, ranks = 6;
    const tx = W.cropTransform({ wf: 7, wr: 5, facing, files, ranks, worldFiles, worldRanks });
    let constant = true;
    let off = null;
    for (let f = 0; f < files; f++) for (let r = 0; r < ranks; r++) {
      const c = W.arenaToWorld(tx, f, r);
      // The camera at the army's facing: where the world cell lands on the screen…
      const s = toScreen(c.f, c.r + 1, worldFiles, worldRanks, facing);
      // …must be the arena's own north-up position plus one offset.
      const d = { col: s.col - f, row: s.row - (ranks - 1 - r) };
      if (!off) off = d;
      else if (d.col !== off.col || d.row !== off.row) constant = false;
    }
    expect(constant, `f${facing}: through the camera at the army's facing the arena reads north-up at one offset (${off?.col},${off?.row})`);
    // The same for pixels: a pixel inside a square lands where the square's tile is, at the same in-tile place.
    let pxOk = true;
    for (const [f, r] of [[0, 0], [9, 5], [4, 2]]) for (const [u, v] of [[0, 0], [15, 0], [0, 15], [7, 3]]) {
      const sq = sqName(f, r);
      const e = W.toEnvPx(tx, sq, u, v);
      const s = pxToScreen(e.x, e.y, worldFiles * T, worldRanks * T, facing);
      const cs = toScreen(f, r + 1, worldFiles, worldRanks, facing); // (unused dims for the arena — compare relative to the square's screen tile)
      const c = W.arenaToWorld(tx, f, r);
      const tile = toScreen(c.f, c.r + 1, worldFiles, worldRanks, facing);
      if (s.x !== tile.col * T + u || s.y !== tile.row * T + v) pxOk = false;
      void cs;
    }
    expect(pxOk, `f${facing}: a pixel inside a square lands at the same in-tile place through the camera`);
  }
}

// --- the identity: the Phase 1 page's old behaviour
{
  const tx = W.identityTransform(10, 10);
  expect(W.isIdentity(tx), 'identityTransform is the identity');
  expect(W.toEnvCell(tx, 'a1').ef === 0 && W.toEnvCell(tx, 'a1').er === 0 && W.toEnvCell(tx, 'j10').er === 9, 'identity: a1 is cell (0, 0), j10 is rank 9');
  expect(W.toEnvPx(tx, 'a10', 0, 0).y === 0 && W.toEnvPx(tx, 'a1', 0, 0).y === 9 * T, 'identity: env pixel rows run from the top of the world');
  expect(W.envDir(tx, 1, 1).dx === 1 && W.envDir(tx, 1, 1).dy === 1, 'identity: a direction is itself');
  const east = W.cropTransform({ facing: 1, files: 10, ranks: 6, worldFiles: 20, worldRanks: 20 });
  const d = W.envDir(east, 0, -1); // arena-north (up the screen) is world east: +x
  expect(d.dx === 1 && d.dy === 0, `east: arena-north is env +x (${d.dx},${d.dy})`);
  const south = W.cropTransform({ facing: 2, files: 10, ranks: 6, worldFiles: 20, worldRanks: 20 });
  const ds = W.envDir(south, 0, -1);
  expect(ds.dx === 0 && ds.dy === 1, `south: arena-north is env +y (down) (${ds.dx},${ds.dy})`);
  const west = W.cropTransform({ facing: 3, files: 10, ranks: 6, worldFiles: 20, worldRanks: 20 });
  const dw = W.envDir(west, 0, -1);
  expect(dw.dx === -1 && dw.dy === 0, `west: arena-north is env −x (${dw.dx},${dw.dy})`);
  expect(!W.isIdentity(east), 'a facing is not the identity');
}

// --- a stage becomes a world; an arena writes into a crop and reads back
{
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/stages/manifest.json'), 'utf8'));
  const stage = loadStageV2(manifest.stages.find((s) => s.id === 's59-hall-corner'));
  const world = W.World.fromStage(stage);
  expect(world.files === 10 && world.ranks === 10 && world.at(3, 9) === W.WALL && world.at(0, 9) === W.FLOOR, 'a stage becomes a world of its size with its terrain (d10 is a wall)');
  expect(world.skinAt(3, 7) === 'door', 'the stage\'s skins ride along (d8 is a door)');
  const tx = W.identityTransform(10, 10);
  const fen = '3*6/3*1^^3/3^6/3*2*3/1*1*6/1*1***^^**/10/**^**1***1/6*3/6*2^ w - - 0 1';
  const fen2 = 'k2*6/3*1^^3/3^6/3*2*3/1*1*6/1*1***^^**/10/**^**1***1/6*3/K5*2^ w - - 0 1';
  world.writeArena(tx, fen2, { holes: new Set(['d10']), godCrates: new Set(['f9']), opened: new Set(['d8']), rubble: new Set(['b6']) });
  expect(world.pieceAt(0, 9) === 'k' && world.pieceAt(0, 0) === 'K', 'pieces land on their cells');
  expect(world.at(3, 9) === W.FLOOR || world.at(3, 9) === W.HOLE, 'a hole written as a hole');
  expect(world.arenaFen(tx, 'w') === fen2.replace('3*6', 'k2*6').replace('k2*6', 'k9') || world.arenaFen(tx, 'w').split(' ')[0] === fen2.split(' ')[0], `the crop reads back as the FEN written (${world.arenaFen(tx, 'w').split(' ')[0]})`);
  expect(world.godCrates.has(world.idx(5, 8)) && world.opened.has(world.idx(3, 7)) && world.rubble.has(world.idx(1, 5)), 'the layers land on their cells');
  expect(world.cellView(3, 9).hole === true && world.cellView(3, 9).v === '*', 'cellView: a hole is a hole and reads as * to the engine');
  expect(world.cellView(5, 8).crate === true && world.cellView(5, 8).v === '^', 'cellView: a god crate');
  expect(world.cellView(-1, 0) === undefined, 'cellView off the world is undefined');
  void fen;
  // The same arena written through a turned crop into a bigger world reads back the same.
  for (let facing = 0; facing < FACINGS; facing++) {
    const big = new W.World({ id: 'big', files: 30, ranks: 25 });
    const ctx = W.cropTransform({ wf: 5, wr: 7, facing, files: 10, ranks: 10, worldFiles: 30, worldRanks: 25 });
    big.writeArena(ctx, fen2, { holes: new Set(['d10']) });
    expect(big.arenaFen(ctx, 'w').split(' ')[0] === fen2.split(' ')[0], `f${facing}: an arena written through a turned crop reads back as the same FEN`);
    const c = W.arenaToWorld(ctx, 0, 0);
    expect(big.pieceAt(c.f, c.r) === 'K', `f${facing}: the king stands on a1's world cell`);
    // Skins for the crop come back by arena square.
    const skins = big.arenaSkins(ctx);
    expect(Object.keys(skins).length === 0, `f${facing}: no skins in an unskinned world`);
  }
}

// --- a world file loads: any size, the start, the spawns, the skins
{
  const json = {
    schema: 2, id: 'w-test', title: 'Test', theme: 'crypt', facing: 'e',
    map: [
      '####################',
      '#........#.........#',
      '#..@.....^....2....#',
      '#........#.........#',
      '#....1.............#',
      '####################',
    ],
    skin: [
      '....................',
      '....................',
      '.........D..........',
      '....................',
      '....................',
      '....................',
    ],
  };
  const w = W.loadWorld(json);
  expect(w.files === 20 && w.ranks === 6, 'a 20×6 world loads (no arena cap)');
  expect(w.start && w.start.f === 3 && w.start.r === 3 && w.start.facing === 1, `the start is at (3, 3) facing east (${JSON.stringify(w.start)})`);
  expect(w.isFloor(3, 3), 'the start stands on floor');
  expect(w.spawns.length === 2 && w.spawns[0].n === 1 && w.spawns[0].f === 5 && w.spawns[0].r === 1 && w.spawns[1].n === 2, `the spawns are recorded in order (${JSON.stringify(w.spawns)})`);
  expect(w.skinAt(9, 3) === 'door' && w.at(9, 3) === W.FURNITURE, 'a skin on furniture');
  expect((() => { try { W.loadWorld({ ...json, map: [...json.map.slice(0, 2), '#..@....@..........#', ...json.map.slice(3)] }); return false; } catch (e) { return /two starts/.test(e.message); } })(), 'two starts is a data bug');
  // Save round-trip.
  w.setPiece(3, 3, 'K');
  w.setTerrain(1, 1, W.HOLE);
  w.godCrates.add(w.idx(9, 3));
  const obj = JSON.parse(JSON.stringify(w.serialize()));
  const back = W.World.load(obj);
  expect(JSON.stringify(back.rows()) === JSON.stringify(w.rows()) && back.at(1, 1) === W.HOLE && back.skinAt(9, 3) === 'door' && back.godCrates.has(w.idx(9, 3)) && back.start.facing === 1 && back.spawns.length === 2, 'serialize → load keeps terrain, pieces, holes, skins, layers, start and spawns');
  expect(back.rows({ pieces: false })[4][1] === 'O', 'rows(): a hole prints as O');
}

for (const b of bad) console.log(`FAIL ${b}`);
console.log(`test-world: ${ok}/${ok + bad.length} checks passed`);
process.exit(bad.length ? 1 : 0);
