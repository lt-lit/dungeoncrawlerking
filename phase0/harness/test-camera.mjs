// THE CAMERA's Node gate (Phase 2, the camera PR, 2026-09-08): the pure
// geometry in play/js/camera.mjs against brute force — every square round-
// trips at every facing on non-square boards, the pixel map agrees with the
// square map and with the tile rotation, the mask permutations agree with
// rotating a real neighbourhood, four quarter turns are the identity and
// two are the old 180° flip, the door halves and the edge-on rule read as
// the brief says. No browser, no atlas.
//
// Usage (from phase0/): node harness/test-camera.mjs
import { FACINGS, normFacing, screenDims, toScreen, toWorld, pxToScreen, rotMask8, rotMask4, rotTile, doorHalf, edgeOn, coordEdges, facingName } from '../../play/js/camera.mjs';
import { canonicalMask } from '../../play/js/board-ui.mjs';

let ok = 0;
const bad = [];
const expect = (cond, what) => { if (cond) ok++; else bad.push(what); };

// --- squares round-trip, the grid swaps, every screen cell is hit exactly once
for (const [files, ranks] of [[10, 10], [7, 5], [3, 10], [12, 6]]) {
  for (let facing = 0; facing < FACINGS; facing++) {
    const { cols, rows } = screenDims(files, ranks, facing);
    expect(cols * rows === files * ranks && (facing & 1 ? cols === ranks : cols === files), `${files}×${ranks} f${facing}: screen ${cols}×${rows}`);
    const seen = new Set();
    let round = true, inside = true;
    for (let f = 0; f < files; f++) for (let rank = 1; rank <= ranks; rank++) {
      const s = toScreen(f, rank, files, ranks, facing);
      if (s.col < 0 || s.col >= cols || s.row < 0 || s.row >= rows) inside = false;
      seen.add(`${s.col},${s.row}`);
      const w = toWorld(s.col, s.row, files, ranks, facing);
      if (!w || w.f !== f || w.rank !== rank) round = false;
    }
    expect(inside && round && seen.size === files * ranks, `${files}×${ranks} f${facing}: every square lands inside once and round-trips`);
    expect(toWorld(-1, 0, files, ranks, facing) === null && toWorld(cols, 0, files, ranks, facing) === null && toWorld(0, rows, files, ranks, facing) === null, `${files}×${ranks} f${facing}: off-grid is null`);
  }
}
// The named facings: a1 sits bottom-left north-up, top-right south-up (the
// old flipped board), bottom-right east-up, top-left west-up.
{
  const at = (facing) => toScreen(0, 1, 6, 6, facing);
  expect(at(0).col === 0 && at(0).row === 5, 'north up: a1 bottom-left');
  expect(at(2).col === 5 && at(2).row === 0, 'south up: a1 top-right (the flipped board)');
  expect(at(1).col === 5 && at(1).row === 5, 'east up: a1 bottom-right');
  expect(at(3).col === 0 && at(3).row === 0, 'west up: a1 top-left');
  // East up: the square ahead (screen-north) of a1 is b1 — the world's east.
  const ahead = toWorld(5, 4, 6, 6, 1);
  expect(ahead && ahead.f === 1 && ahead.rank === 1, `east up: the square above a1 is b1 (${JSON.stringify(ahead)})`);
}

// --- pixels: the pixel map agrees with the square map, tile by tile
for (const [files, ranks] of [[10, 10], [5, 7]]) {
  const W = files * 16, H = ranks * 16;
  for (let facing = 0; facing < FACINGS; facing++) {
    let agree = true;
    for (let f = 0; f < files && agree; f++) for (let rank = 1; rank <= ranks && agree; rank++) {
      const s = toScreen(f, rank, files, ranks, facing);
      for (const [u, v] of [[0, 0], [15, 0], [0, 15], [15, 15], [7, 3]]) {
        const p = pxToScreen(f * 16 + u, (ranks - rank) * 16 + v, W, H, facing);
        if (Math.floor(p.x / 16) !== s.col || Math.floor(p.y / 16) !== s.row) agree = false;
      }
    }
    expect(agree, `${files}×${ranks} f${facing}: every pixel lands in its square's screen tile`);
  }
}
// The in-tile offset of the pixel map is the tile rotation.
{
  const buf = new Uint8ClampedArray(16 * 16 * 4);
  const put = (u, v, r) => { const o = (v * 16 + u) * 4; buf[o] = r; buf[o + 3] = 255; };
  put(2, 5, 10); put(15, 0, 20); put(0, 15, 30);
  for (let facing = 0; facing < FACINGS; facing++) {
    const out = rotTile(buf, facing);
    let agree = true;
    for (const [u, v, r] of [[2, 5, 10], [15, 0, 20], [0, 15, 30]]) {
      const p = pxToScreen(u, v, 16, 16, facing);
      if (out[(p.y * 16 + p.x) * 4] !== r || out[(p.y * 16 + p.x) * 4 + 3] !== 255) agree = false;
    }
    let count = 0;
    for (let i = 3; i < out.length; i += 4) if (out[i]) count++;
    expect(agree && count === 3, `rotTile f${facing}: the three marked pixels land where pxToScreen says, nothing else`);
  }
  expect(rotTile(buf, 0) === buf, 'rotTile facing 0 is the input');
  // Four quarter turns are the identity; two are the 180° flip.
  const r1 = rotTile(rotTile(rotTile(rotTile(buf, 1), 1), 1), 1);
  const r2 = rotTile(rotTile(buf, 1), 1);
  const flip = rotTile(buf, 2);
  expect(r1.every((x, i) => x === buf[i]), 'four quarter turns are the identity');
  expect(r2.every((x, i) => x === flip[i]), 'two quarter turns are the 180° turn');
}

// --- masks: a turned neighbourhood reads the permuted mask
{
  // A 3×3 world around the centre square: solid neighbours by (df, dr).
  const bitOf = { '0,1': 1, '1,0': 2, '0,-1': 4, '-1,0': 8, '1,1': 16, '1,-1': 32, '-1,-1': 64, '-1,1': 128 };
  const dirs = Object.keys(bitOf).map((k) => k.split(',').map(Number));
  let agree8 = 0, agree4 = 0, tried = 0;
  for (let m = 0; m < 256; m++) {
    const solid = new Set(dirs.filter(([df, dr]) => m & bitOf[`${df},${dr}`]).map(([df, dr]) => `${df},${dr}`));
    for (let facing = 0; facing < FACINGS; facing++) {
      tried++;
      // Place the centre at b2 of a 3×3 board, its neighbours around it;
      // read the SCREEN neighbours of the centre's screen cell.
      const c = toScreen(1, 2, 3, 3, facing);
      const screenSolid = (dcol, drow) => {
        const w = toWorld(c.col + dcol, c.row + drow, 3, 3, facing);
        return !!w && solid.has(`${w.f - 1},${w.rank - 2}`);
      };
      const sm = (screenSolid(0, -1) ? 1 : 0) | (screenSolid(1, 0) ? 2 : 0) | (screenSolid(0, 1) ? 4 : 0) | (screenSolid(-1, 0) ? 8 : 0) | (screenSolid(1, -1) ? 16 : 0) | (screenSolid(1, 1) ? 32 : 0) | (screenSolid(-1, 1) ? 64 : 0) | (screenSolid(-1, -1) ? 128 : 0);
      if (rotMask8(m, facing) === sm) agree8++;
      if (rotMask4(m & 15, facing) === (sm & 15)) agree4++;
      // canonicalMask commutes with the turn.
      if (canonicalMask(rotMask8(m, facing)) !== rotMask8(canonicalMask(m), facing)) agree8 = -1e9;
    }
  }
  expect(agree8 === tried, `rotMask8 agrees with the turned neighbourhood on all 256 masks × 4 facings (${agree8}/${tried}) and commutes with canonicalMask`);
  expect(agree4 === tried, `rotMask4 agrees on all 16 masks × 4 facings (${agree4}/${tried})`);
  expect(rotMask8(-1, 1) === -1 && rotMask4(-1, 3) === -1, 'a floor square (mask −1) stays −1');
  expect(rotMask8(1, 1) === 8 && rotMask8(2, 1) === 1 && rotMask8(1, 3) === 2 && rotMask8(5, 1) === 10 && rotMask8(5, 2) === 5, 'east up: a north wall reads west; west up: north reads east; a column reads as a row');
}

// --- doors
expect(doorHalf('l', 0) === 'l' && doorHalf('r', 0) === 'r' && doorHalf('n', 0) === null, 'north up: a rank pair keeps west = left, a file pair is edge-on');
expect(doorHalf('l', 2) === 'r' && doorHalf('r', 2) === 'l', 'south up: the halves swap');
expect(doorHalf('n', 1) === 'l' && doorHalf('s', 1) === 'r' && doorHalf('l', 1) === null, 'east up: the north leaf is the left half, a rank pair is edge-on');
expect(doorHalf('n', 3) === 'r' && doorHalf('s', 3) === 'l', 'west up: the north leaf is the right half');
expect(doorHalf(null, 1) === null, 'no pair, no half');
expect(edgeOn('ns', 0) && !edgeOn('ew', 0) && !edgeOn('ns', 1) && edgeOn('ew', 1) && edgeOn('ns', 2) && edgeOn('ew', 3), 'a north–south door is edge-on north/south up, an east–west door east/west up');
expect(coordEdges(0).bottom === 'file' && coordEdges(0).left === 'rank' && coordEdges(1).bottom === 'rank' && coordEdges(3).left === 'file', 'the edge coordinates label what varies along the edge');
expect(normFacing(-1) === 3 && normFacing(5) === 1 && normFacing('x') === 0 && facingName(2) === 'south', 'facings normalise mod 4');

for (const b of bad) console.log(`FAIL ${b}`);
console.log(`test-camera: ${ok} ok, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
