#!/usr/bin/env node
// THE WORLDS (Phase 2 milestone 4b, 2026-09-08): the walk-around fixtures
// in play/worlds/ and their manifest.
//
//   node harness/gen-worlds.mjs            (from phase0/)
//
// w01 THE UNDERCROFT is the hand-built walk-around fixture — a 60×40 floor
// carved from a written plan (rooms, doors, furniture, a 2-wide crawlspace,
// a 3-wide hall, wall stubs, a cave, nothing symmetric) — for the designer's
// gallery approval (world-shots.mjs renders it). w02 is a SEEDED 100×100
// stress floor (rooms and corridors, no design) for the frame budget.
// Every world is validated through loadWorld before it is written; the
// manifest bundles the files the way the stage manifest does.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorld } from '../../play/js/world.mjs';
import { mulberry32 } from '../../play/js/prng.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'play', 'worlds');
mkdirSync(DIR, { recursive: true });

/** A grid of walls to carve. */
class Carver {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.map = Array.from({ length: h }, () => Array(w).fill('#'));
    this.skin = Array.from({ length: h }, () => Array(w).fill('.'));
  }
  set(x, y, ch, sk = null) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.map[y][x] = ch;
    this.skin[y][x] = ch === '^' ? sk ?? this.skin[y][x] : '.'; // a carved-over crate loses its skin
  }
  get(x, y) {
    return this.map[y]?.[x];
  }
  /** Floor a rectangle (x0, y0 inclusive … x1, y1 inclusive). */
  room(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, '.');
  }
  wall(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, '#');
  }
  /** A corridor: horizontal or vertical, `width` cells thick. */
  hall(x0, y0, x1, y1, width = 1) {
    if (y0 === y1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let k = 0; k < width; k++) this.set(x, y0 + k, '.');
    else for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let k = 0; k < width; k++) this.set(x0 + k, y, '.');
  }
  door(x, y) { this.set(x, y, '^', 'D'); }
  crate(x, y) { this.set(x, y, '^', 'K'); }
  chest(x, y) { this.set(x, y, '^', 'X'); }
  barrel(x, y) { this.set(x, y, '^', 'B'); }
  masonry(x, y) { this.set(x, y, '^', 'R'); }
  wreck(x, y) { this.set(x, y, '^', 'W'); }
  rows() { return this.map.map((r) => r.join('')); }
  skins() { return this.skin.map((r) => r.join('')); }
}

// ----------------------------------------------------------------- w01

function undercroft() {
  const c = new Carver(60, 40);
  // THE ANTECHAMBER (west): where the walk begins, facing east.
  c.room(2, 30, 8, 37);
  c.set(4, 34, '@');
  c.barrel(2, 30); c.barrel(3, 30); c.crate(8, 37);
  c.door(9, 33);
  // THE LONG CORRIDOR (3 wide) east from the antechamber, with two pillars
  // and a wall stub the crop of an older passage left.
  c.hall(10, 32, 40, 32, 3);
  c.set(18, 33, '#'); c.set(30, 33, '#');
  c.set(24, 31, '#'); c.set(24, 30, '#'); // a stub reaching down from the north
  // THE GREAT HALL: 19 × 15, four pillars off-centre, entered from the south
  // through double doors and a 3-wide passage; a crate cluster in a corner.
  c.room(20, 9, 38, 23);
  c.set(24, 13, '#'); c.set(24, 19, '#'); c.set(33, 12, '#'); c.set(33, 20, '#');
  c.hall(27, 25, 27, 31, 3);
  c.set(27, 24, '#'); c.door(28, 24); c.door(29, 24); c.set(30, 24, '#');
  c.crate(36, 22); c.crate(37, 22); c.crate(37, 21); c.chest(21, 9);
  // A row of pillars along the hall's north wall, with gaps (a colonnade).
  for (let x = 22; x <= 36; x += 4) c.set(x, 8, '#');
  // THE NORTH-WEST STORE: crates, a door east into a corridor to the hall.
  c.room(3, 3, 11, 10);
  c.crate(3, 3); c.crate(4, 3); c.crate(3, 4); c.crate(10, 9); c.crate(11, 10); c.chest(11, 3);
  c.door(12, 6);
  c.hall(13, 6, 19, 6, 1);
  c.door(19, 6); c.set(19, 5, '#'); c.set(19, 7, '#');
  c.room(20, 5, 21, 7); // a short vestibule into the hall
  // THE CRAWLSPACE (2 wide): from the store's floor south to the corridor.
  c.hall(5, 11, 5, 31, 2);
  c.set(6, 20, '#'); c.set(5, 21, '#'); // a kink: it narrows to one for two cells
  // THE NORTH-EAST CHAPEL: barrels and chests, a door south, a wall stub
  // inside (the choir screen), a masonry weak spot in its west wall.
  c.room(43, 3, 56, 13);
  c.set(49, 6, '#'); c.set(49, 7, '#'); c.set(49, 8, '#');
  c.barrel(43, 3); c.barrel(44, 3); c.barrel(43, 4); c.chest(56, 3); c.chest(55, 3); c.barrel(56, 13);
  c.masonry(42, 10);
  c.door(48, 14);
  // THE EAST CORRIDOR (3 wide) from the chapel's door down to the long corridor.
  c.hall(47, 15, 47, 31, 3);
  c.set(48, 22, '#');
  // The hall's east door onto the east corridor by a bent passage.
  c.door(39, 16);
  c.hall(40, 16, 46, 16, 1);
  // THE SOUTH-EAST QUARTERS: two rooms with a door between, a door west.
  c.room(51, 19, 57, 24);
  c.room(51, 26, 57, 30);
  c.door(54, 25);
  c.door(50, 21);
  c.chest(57, 19); c.crate(51, 30); c.crate(52, 30); c.wreck(57, 30);
  // THE SOUTH-WEST CAVE: an irregular pocket off the corridor, a dead end.
  c.room(11, 22, 17, 29);
  c.set(11, 22, '#'); c.set(12, 22, '#'); c.set(17, 22, '#'); c.set(11, 29, '#');
  c.set(14, 25, '#'); c.set(15, 25, '#');
  c.hall(14, 30, 14, 31, 1);
  c.wreck(16, 23);
  // A dead-end passage east of the long corridor's end.
  c.hall(41, 33, 45, 33, 1);
  // A back way: the antechamber's south-east corner to the cave, 1 wide.
  c.hall(9, 36, 13, 36, 1); c.hall(13, 30, 13, 36, 1);
  c.set(13, 30, '#');
  // The corridor's north side: a shallow alcove with a chest.
  c.room(35, 29, 37, 31);
  c.chest(37, 29);
  return c;
}

// ----------------------------------------------------------------- w02

function stress(seed = 100, W = 100, H = 100) {
  const rng = mulberry32(seed);
  const c = new Carver(W, H);
  const rooms = [];
  for (let tries = 0; tries < 400 && rooms.length < 60; tries++) {
    const w = 4 + Math.floor(rng() * 10), h = 4 + Math.floor(rng() * 8);
    const x = 1 + Math.floor(rng() * (W - w - 2)), y = 1 + Math.floor(rng() * (H - h - 2));
    if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
    rooms.push({ x, y, w, h });
    c.room(x, y, x + w - 1, y + h - 1);
    const n = Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const fx = x + Math.floor(rng() * w), fy = y + Math.floor(rng() * h);
      const k = rng();
      if (k < 0.5) c.crate(fx, fy); else if (k < 0.8) c.barrel(fx, fy); else c.chest(fx, fy);
    }
  }
  // Corridors: each room to the next by an L (2 or 3 wide by turns).
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    const ax = a.x + Math.floor(a.w / 2), ay = a.y + Math.floor(a.h / 2);
    const bx = b.x + Math.floor(b.w / 2), by = b.y + Math.floor(b.h / 2);
    const wide = 1 + Math.floor(rng() * 3);
    if (rng() < 0.5) { c.hall(ax, ay, bx, ay, wide); c.hall(bx, ay, bx, by, wide); } else { c.hall(ax, ay, ax, by, wide); c.hall(ax, by, bx, by, wide); }
  }
  // Doors where a corridor meets a room wall are beyond a generator this
  // simple; a few crates on the corridors instead.
  for (let i = 0; i < 40; i++) {
    const x = 1 + Math.floor(rng() * (W - 2)), y = 1 + Math.floor(rng() * (H - 2));
    if (c.get(x, y) === '.') c.crate(x, y);
  }
  // The border stays wall; the start is the first room's centre.
  for (let x = 0; x < W; x++) { c.set(x, 0, '#'); c.set(x, H - 1, '#'); }
  for (let y = 0; y < H; y++) { c.set(0, y, '#'); c.set(W - 1, y, '#'); }
  const s = rooms[0];
  c.set(s.x + Math.floor(s.w / 2), s.y + Math.floor(s.h / 2), '@');
  return c;
}

// ----------------------------------------------------------------- checks

/** Floor reachable from the start by king steps through floor and furniture (a crate can be smashed). */
function reachable(rows) {
  const H = rows.length, W = rows[0].length;
  let start = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rows[y][x] === '@') start = [x, y];
  const seen = new Set([start.join(',')]);
  const q = [start];
  let floor = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rows[y][x] !== '#') floor++;
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || rows[ny][nx] === '#' || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  return { reached: seen.size, floor };
}

function write(id, title, notes, theme, carver, extra = {}) {
  const json = { schema: 2, id, title, notes, theme, map: carver.rows(), skin: carver.skins(), ...extra };
  const world = loadWorld(json); // throws on a bad file
  const r = reachable(json.map);
  if (r.reached !== r.floor) throw new Error(`${id}: ${r.floor - r.reached} floor cells unreachable from the start`);
  writeFileSync(join(DIR, `${id}.json`), JSON.stringify(json, null, 1) + '\n');
  console.log(`${id}: ${world.files}×${world.ranks}, ${r.floor} floor cells, all reachable, start (${world.start.f}, ${world.start.r}) facing ${world.start.facing}`);
  return json;
}

export function buildManifest() {
  const worlds = [];
  for (const file of readdirSync(DIR).sort()) {
    if (!file.endsWith('.json') || file === 'manifest.json') continue;
    const json = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    const world = loadWorld(json);
    if (world.id !== file.replace(/\.json$/, '')) throw new Error(`${file}: id "${world.id}" does not match filename`);
    worlds.push(json);
  }
  return { schema: 2, count: worlds.length, worlds };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  write('w01-the-undercroft', 'The Undercroft', 'THE WALK-AROUND FIXTURE (milestone 4b): a 60×40 floor — an antechamber where the walk begins facing east, a 3-wide corridor with pillars and a stub, a great hall with a colonnade and four pillars entered by double doors, a north-west store and its 2-wide crawlspace south, a north-east chapel with a choir screen and a weak spot in its wall, an east corridor, two quarters with a door between, a cave off the corridor, an alcove, a dead end, a back way. Nothing symmetric.', 'crypt', undercroft(), { facing: 'e' });
  write('w02-stress-100', 'Stress 100', 'A SEEDED 100×100 floor for the frame budget, not a design: sixty rooms and their corridors, crates scattered.', 'castle', stress(100));
  const manifest = buildManifest();
  writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`manifest.json: ${manifest.count} worlds bundled`);
}
