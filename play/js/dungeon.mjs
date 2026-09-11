// THE DUNGEON GENERATOR — Phase 2 milestone 5 (2026-09-08). Pure and
// seeded: a floor from a seed, the same floor in the game and in the
// harness (phase0/harness/gen-worlds.mjs writes the fixtures, test-dungeon.mjs
// is the gate).
//
// WHY IT EXISTS (the trigger conversation, 2026-09-08): the designer
// retired both hand-built maps on a measurement — "just completely big
// blocks of boring empty featureless rectangles" — and ruled "randomized
// dungeons are a requirement. Not just one alg either, I need different
// floors to have unique styles and features and themes". THE BED IS THE
// SPEC: per 10×10 the 36 wave-6 arenas carry 3 / 7 / 13 separate wall-or-
// crate features (min / median / max), 31 / 43 / 58 floor cells touching
// terrain and a largest empty block of 12 / 19 / 40 cells; a room is an
// empty block by definition, so no rooms-and-corridors dungeon crops to it.
//
// THE LINTS, measured off the bed rather than guessed (the constants below
// are the bed's own envelope — test-dungeon.mjs asserts every arena passes
// them and a plain room fails):
//   • NO BOX IS BORING — for every floor cell, each of the four 10×10 boxes
//     the trigger would drop (barrier.mjs boxPlacement, the game's own
//     placement rule) that holds enough floor to fight on has a largest
//     empty block within the bed's, at least the bed's fewest features, and
//     the bed's least share of its floor touching something.
//   • NO LONG NARROW WAYS — the designer: "WHY NOT JUST NOT USE 2 WIDE
//     HALLWAYS". A floor cell is WIDE when no stone stands in its 3×3;
//     passable cells that are neither wide nor a king step from a wide
//     cell are NARROW, and a narrow pocket may not stretch farther than
//     one arena's width in either axis. The bed itself is full of SHORT
//     2-wide passages (the junction's sliced hallway, the guard post's
//     corridors, the cell block), so short is the bed's own measure; what
//     the rule forbids is the crawlspace — two arenas' passages chaining
//     into a twenty-cell hallway across a seam.
//   • REACHABLE — every passable cell from the start, furniture passable
//     (an army smashes through, brief §4.6).
//   • DUELABLE GROUND — from a sample of floor cells at least one box
//     deals legally for the kit, checked by THE TRIGGER FUNCTION ITSELF
//     (barrier.mjs planBarrier), so the lint, the live check and the
//     threat display stay one piece of code (brief §5.3). Costly; the
//     harness runs it, the game does not.
//   Nothing symmetric is by construction with the prefab skeleton (every
//   arena is asymmetric and used once); the recipe skeletons will need it
//   as a rule of their own.
//
// THE BUILD: a SKELETON lays the bones, FIX-UPS make the lints true
// (carve a seam that sealed a region off, widen a passage that came out
// narrow, drop a pillar or a crate cluster into a block that came out
// empty), then the start and the enemy spawns are placed. The first
// skeleton is the PREFAB GRID — the 36 arenas themselves as pieces, each
// used once, turned by seed, laid so their edge exits meet (every arena
// was written as a plausible crop of a bigger dungeon with corridors
// leaving by the edges), in eight orientations and WEATHERED by seed so no
// floor carries an arena verbatim, a one-cell wall ring around the whole.
// It is a style of its own (THE VAULTS) and the fallback that always
// passes — the designer's first verdict on it (2026-09-09): "this might
// work. A little incoherent, plus I'm sure on replays people will start to
// notice the repeating patterns" — coherence is the recipe skeletons'; the
// recipe skeletons (packed rooms, a wide maze, cellular caves) come next,
// style by style, each a batch for the designer's eye.
import { WALL, FURNITURE } from './fen.mjs';
import { THEMES } from './stage.mjs';
import { mulberry32, childSeed, randInt, shuffle } from './prng.mjs';
import { boxPlacement, BOX, planBarrier } from './barrier.mjs';
import { loadWorld } from './world.mjs';
import { makePattern, spawnArmy, OPENING_KIT } from './army.mjs';

/** The bed's envelope per 10×10 box (see the header; test-dungeon.mjs re-measures it). */
export const LINT = {
  denseFloor: 60, // a box with fewer floor cells is cramped, not boring — the deal judges it (the bed's least is 68)
  openMax: 40, // the bed's largest empty block
  featsMin: 3, // the bed's fewest separate wall-or-crate features
  ifaceMin: 0.38, // the bed's least share of floor touching terrain (reported, not enforced: the bed's boxes straddle it)
  narrowExtent: 10, // a narrow pocket may not stretch beyond one arena's width — the bed is full of SHORT 2-wide passages
  spawnMinDist: 14, // an enemy stands at least this many steps from the start
  spawnSpacing: 8, // and this far (Chebyshev) from every other spawn
};

/** The styles: name → { title, skeleton, theme, enemies, notes }. One so far. */
export const STYLES = {
  vaults: { title: 'The Vaults', skeleton: 'prefab', theme: 'crypt', enemies: 4, cols: 6, rows: 4, notes: 'THE PROVING GROUNDS LAID AS ONE FLOOR: the wave-6 arenas as pieces, each used once, turned by seed, their edge exits joined.' },
};
export const STYLE_NAMES = Object.keys(STYLES);
/** The widths the enemy spawns get, nearest the start first (brief §8: the level telegraph is the army).
 *  ALL THREES FOR NOW (designer 2026-09-10: "Enemies will be 3 wide for now"); the ladder 3, 3, 4, 5, 5, 6, 6, 7, 8 waits for §8. */
export const SPAWN_WIDTHS = [3, 3, 3, 3, 3, 3, 3, 3, 3];

const NAME_TO_SKIN = { door: 'D', barrel: 'B', crate: 'K', chest: 'X', masonry: 'R', wreckage: 'W' };
const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIRS4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
// Map coordinates: x right, y DOWN (the file's rows). A facing's `ahead`
// and `right` as map deltas: north is up the rows.
const AHEAD = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const RIGHT = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// ------------------------------------------------------------ pieces

/** A loaded stage (stage.mjs loadStageV2) as a piece: char rows top-down and skin letters. */
export function pieceOf(stage) {
  const rows = [];
  const skins = [];
  for (let i = 0; i < stage.ranks; i++) {
    const r = stage.ranks - 1 - i;
    const row = [];
    const sk = [];
    for (let f = 0; f < stage.files; f++) {
      const t = stage.grid[r][f];
      row.push(t === WALL ? '#' : t === FURNITURE ? '^' : '.');
      const name = stage.skin?.[r]?.[f] ?? null;
      sk.push(t === FURNITURE && name && NAME_TO_SKIN[name] ? NAME_TO_SKIN[name] : '.');
    }
    rows.push(row);
    skins.push(sk);
  }
  return { id: stage.id, size: stage.files, cells: rows, skins, theme: stage.theme ?? null };
}

/** A grid mirrored left to right. */
export function mirrored(grid) {
  return grid.map((row) => row.slice().reverse());
}

/** One of a piece's eight orientations: `o` & 3 quarter turns, mirrored first when `o` ≥ 4. */
export function oriented(grid, o) {
  return rotated(o >= 4 ? mirrored(grid) : grid, o & 3);
}

/** A square grid turned a quarter clockwise `k` times. */
export function rotated(grid, k) {
  let g = grid;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) {
    const n = g.length;
    g = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => g[n - 1 - x][y]));
  }
  return g;
}

// ------------------------------------------------------------ the floor

/** The working floor: char rows (`#` `.` `^`) and skin letters, y down. */
class Floor {
  constructor(files, ranks) {
    this.files = files;
    this.ranks = ranks;
    this.g = Array.from({ length: ranks }, () => Array(files).fill('#'));
    this.sk = Array.from({ length: ranks }, () => Array(files).fill('.'));
  }
  in(x, y) {
    return x >= 0 && x < this.files && y >= 0 && y < this.ranks;
  }
  at(x, y) {
    return this.in(x, y) ? this.g[y][x] : '#';
  }
  /** Passable to a walking army: floor, or furniture it can smash. */
  passable(x, y) {
    const c = this.at(x, y);
    return c === '.' || c === '^';
  }
  border(x, y) {
    return x === 0 || y === 0 || x === this.files - 1 || y === this.ranks - 1;
  }
  set(x, y, ch, skin = '.') {
    this.g[y][x] = ch;
    this.sk[y][x] = ch === '^' ? skin : '.';
  }
  rows() {
    return this.g.map((r) => r.join(''));
  }
  skinRows() {
    return this.sk.map((r) => r.join(''));
  }
}

/** A floor from map rows (a world file, a fixture, a test). */
export function floorOf(rows, skinRows = null) {
  const F = new Floor(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      F.g[y][x] = ch === '#' || ch === '*' ? '#' : ch === '^' ? '^' : '.';
      F.sk[y][x] = ch === '^' ? skinRows?.[y]?.[x] ?? '.' : '.';
    }
  });
  return F;
}

// ------------------------------------------------------------ the lints

/** Connected components of passable cells (8-connected — king steps), as an index → component id array; -1 off. */
function components(F) {
  const { files, ranks } = F;
  const comp = new Int32Array(files * ranks).fill(-1);
  let n = 0;
  const sizes = [];
  for (let y = 0; y < ranks; y++) {
    for (let x = 0; x < files; x++) {
      if (!F.passable(x, y) || comp[y * files + x] >= 0) continue;
      const id = n++;
      let size = 0;
      const stack = [[x, y]];
      comp[y * files + x] = id;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        size++;
        for (const [dx, dy] of DIRS8) {
          const nx = cx + dx, ny = cy + dy;
          if (!F.in(nx, ny) || !F.passable(nx, ny) || comp[ny * files + nx] >= 0) continue;
          comp[ny * files + nx] = id;
          stack.push([nx, ny]);
        }
      }
      sizes.push(size);
    }
  }
  return { comp, n, sizes };
}

/**
 * THE NARROW RULE. A cell is WIDE when no stone stands in its 3×3
 * (furniture does not narrow — a barrel aisle is not a hallway; `outside`
 * is what lies off the grid: '#' on a floor, '.' when a lone arena is
 * judged, since its edges continue off-frame). Narrow cells are passable
 * cells that are neither wide nor a king step from a wide cell; their
 * 8-connected pockets are returned largest first.
 */
export function narrowPockets(F, { outside = '#' } = {}) {
  const { files, ranks } = F;
  const stone = (x, y) => (F.in(x, y) ? F.g[y][x] === '#' : outside === '#');
  const wide = new Uint8Array(files * ranks);
  for (let y = 0; y < ranks; y++) for (let x = 0; x < files; x++) {
    if (F.g[y][x] !== '.') continue;
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (stone(x + dx, y + dy)) { ok = false; break; }
    if (ok) wide[y * files + x] = 1;
  }
  const near = new Uint8Array(files * ranks);
  for (let y = 0; y < ranks; y++) for (let x = 0; x < files; x++) {
    if (!wide[y * files + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (F.in(x + dx, y + dy)) near[(y + dy) * files + x + dx] = 1;
  }
  const narrow = (x, y) => F.passable(x, y) && !near[y * files + x];
  const seen = new Uint8Array(files * ranks);
  const pockets = [];
  for (let y = 0; y < ranks; y++) for (let x = 0; x < files; x++) {
    if (!narrow(x, y) || seen[y * files + x]) continue;
    const cells = [];
    const stack = [[x, y]];
    seen[y * files + x] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      cells.push({ x: cx, y: cy });
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx, ny = cy + dy;
        if (!F.in(nx, ny) || !narrow(nx, ny) || seen[ny * files + nx]) continue;
        seen[ny * files + nx] = 1;
        stack.push([nx, ny]);
      }
    }
    pockets.push(cells);
  }
  pockets.sort((a, b) => b.length - a.length);
  return pockets;
}

/** The stats of one rectangle of a floor (off-grid cells are stone): the bed's measures. */
export function rectStats(F, x0, y0, w, h) {
  let floor = 0;
  const cell = (x, y) => F.at(x0 + x, y0 + y);
  // 4-connected components of stone-or-furniture inside the rectangle
  const seen = new Uint8Array(w * h);
  let feats = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (cell(x, y) === '.') { floor++; continue; }
    if (seen[y * w + x]) continue;
    feats++;
    const stack = [[x, y]];
    seen[y * w + x] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      for (const [dx, dy] of DIRS4) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || cell(nx, ny) === '.' || seen[ny * w + nx]) continue;
        seen[ny * w + nx] = 1;
        stack.push([nx, ny]);
      }
    }
  }
  // floor cells touching stone or furniture (inside the rectangle)
  let iface = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (cell(x, y) !== '.') continue;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (cell(nx, ny) !== '.') { iface++; break; }
    }
  }
  // the largest all-floor rectangle, and where it is
  let open = 0;
  let openRect = null;
  const hist = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) hist[x] = cell(x, y) === '.' ? hist[x] + 1 : 0;
    const stack = [];
    for (let x = 0; x <= w; x++) {
      const cur = x < w ? hist[x] : 0;
      let start = x;
      while (stack.length && stack[stack.length - 1][1] >= cur) {
        const [s, hh] = stack.pop();
        const area = hh * (x - s);
        if (area > open) { open = area; openRect = { x: x0 + s, y: y0 + y - hh + 1, w: x - s, h: hh }; }
        start = s;
      }
      stack.push([start, cur]);
    }
  }
  return { floor, feats, iface, open, openRect };
}

/** The rectangle of the 10×10 box the trigger drops on a king at (x, y) facing `d` (map coordinates, y down). */
export function boxRect(F, x, y, d) {
  // THE ONE PLACEMENT RULE (barrier.mjs boxPlacement) thinks in world
  // coordinates, r up: hand it the floor through that lens.
  const p = boxPlacement((f, r) => F.at(f, F.ranks - 1 - r) === '.', { f: x, r: F.ranks - 1 - y }, d, BOX);
  const ahead = AHEAD[d], right = RIGHT[d];
  const xs = [], ys = [];
  for (const [r, f] of [[0, 0], [0, BOX - 1], [BOX - 1, 0], [BOX - 1, BOX - 1]]) {
    xs.push(x + ahead[0] * r + right[0] * (f - p.kingFile));
    ys.push(y + ahead[1] * r + right[1] * (f - p.kingFile));
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), w: BOX, h: BOX, kingFile: p.kingFile };
}

/** Is a box boring? null when it passes, else the reason (the empty block and the feature count — the two measures that mean "empty featureless rectangle"). */
function boringWhy(s) {
  if (s.floor < LINT.denseFloor) return null;
  if (s.open > LINT.openMax) return 'open';
  if (s.feats < LINT.featsMin) return 'feats';
  return null;
}

/** How far a pocket stretches: the larger side of its bounding box. */
export function pocketExtent(cells) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of cells) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); }
  return Math.max(x1 - x0 + 1, y1 - y0 + 1);
}

/**
 * NO BOX IS BORING, over a floor: every floor cell × four facings. Returns
 * the violations (cell, facing, stats, reason) and the census.
 */
export function densityLint(F, { limit = Infinity } = {}) {
  const out = { boxes: 0, dense: 0, violations: [] };
  for (let y = 0; y < F.ranks; y++) {
    for (let x = 0; x < F.files; x++) {
      if (F.g[y][x] !== '.') continue;
      for (let d = 0; d < 4; d++) {
        const rect = boxRect(F, x, y, d);
        const s = rectStats(F, rect.x0, rect.y0, rect.w, rect.h);
        out.boxes++;
        if (s.floor >= LINT.denseFloor) out.dense++;
        const why = boringWhy(s);
        if (why) {
          out.violations.push({ x, y, d, why, stats: s, rect });
          if (out.violations.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

/** REACHABLE: passable cells from a cell (8-connected, furniture passable); the distance field too. */
export function reachLint(F, from) {
  const { files, ranks } = F;
  const dist = new Int32Array(files * ranks).fill(-1);
  let passable = 0;
  for (let y = 0; y < ranks; y++) for (let x = 0; x < files; x++) if (F.passable(x, y)) passable++;
  if (!from || !F.passable(from.x, from.y)) return { passable, reached: 0, dist };
  const q = [from];
  dist[from.y * files + from.x] = 0;
  let reached = 0;
  for (let i = 0; i < q.length; i++) {
    const { x, y } = q[i];
    reached++;
    const d = dist[y * files + x];
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!F.in(nx, ny) || !F.passable(nx, ny) || dist[ny * files + nx] >= 0) continue;
      dist[ny * files + nx] = d + 1;
      q.push({ x: nx, y: ny });
    }
  }
  return { passable, reached, dist };
}

/**
 * The lints on a world file (or its map rows): reach, narrow, density —
 * and, with `duel: true`, DUELABLE GROUND through planBarrier on a sample
 * of floor cells (the harness's check; slow). `ok` is the three cheap lints.
 */
export function lintWorld(json, { duel = false, samples = 120, seed = 1 } = {}) {
  const rows = Array.isArray(json) ? json : json.map;
  const F = floorOf(rows);
  let start = null;
  rows.forEach((row, y) => { const x = row.indexOf('@'); if (x >= 0) start = { x, y }; });
  const reach = reachLint(F, start);
  const pockets = narrowPockets(F);
  const density = densityLint(F);
  const out = {
    reach: { start, passable: reach.passable, reached: reach.reached, unreachable: reach.passable - reach.reached },
    narrow: { max: pockets[0]?.length ?? 0, maxExtent: Math.max(0, ...pockets.map(pocketExtent)), pockets: pockets.filter((p) => pocketExtent(p) > LINT.narrowExtent).map((p) => ({ size: p.length, extent: pocketExtent(p), at: p[0] })) },
    density: { boxes: density.boxes, dense: density.dense, violations: density.violations.length, worst: density.violations.slice(0, 5).map((v) => ({ x: v.x, y: v.y, d: v.d, why: v.why, open: v.stats.open, feats: v.stats.feats, iface: v.stats.iface, floor: v.stats.floor })) },
  };
  out.ok = !!start && out.reach.unreachable === 0 && out.narrow.pockets.length === 0 && out.density.violations === 0;
  if (duel) out.coverage = duelCoverage(json, { samples, seed });
  return out;
}

/**
 * DUELABLE GROUND: from a seeded sample of floor cells, does at least one
 * of the four boxes deal legally for the kit against a kit? Checked by the
 * trigger function itself (barrier.mjs planBarrier). Per-tile counts let
 * the harness see a dead region.
 */
export function duelCoverage(json, { samples = 120, seed = 1 } = {}) {
  const world = loadWorld(Array.isArray(json) ? { schema: 2, id: 'lint', map: json } : json);
  const rng = mulberry32(childSeed(seed, 'coverage'));
  const cells = [];
  for (let r = 0; r < world.ranks; r++) for (let f = 0; f < world.files; f++) if (world.at(f, r) === '.') cells.push({ f, r });
  const picked = shuffle(rng, cells).slice(0, samples);
  const pattern = makePattern(OPENING_KIT, { seed: 1 });
  const enemy = { spec: { width: 3, pieces: ['R', 'N'] } };
  let legal = 0;
  const tiles = new Map();
  for (const c of picked) {
    let ok = false;
    for (let d = 0; d < 4 && !ok; d++) {
      // The kit as it would STAND there (the deal reads the pieces where they stand, 2026-09-10): a hypothetical spawn, the world's piece grid untouched.
      let army = null;
      try { army = spawnArmy(world, pattern, c, d, 'w', { stamp: false }); } catch { continue; }
      ok = planBarrier(world, army, { enemy, seed: 1 }).ok;
    }
    if (ok) legal++;
    const key = `${Math.floor(c.f / BOX)},${Math.floor(c.r / BOX)}`;
    const t = tiles.get(key) ?? { sampled: 0, legal: 0 };
    t.sampled++;
    if (ok) t.legal++;
    tiles.set(key, t);
  }
  const dead = [...tiles.entries()].filter(([, t]) => t.sampled >= 3 && t.legal === 0).map(([k]) => k);
  return { sampled: picked.length, legal, ratio: picked.length ? legal / picked.length : 0, tiles: tiles.size, dead };
}

// ------------------------------------------------------------ fix-ups

/** Carve every wall on a path (and its two flanks, so the way is three wide), never the border. */
function carvePath(F, path, { widen = true } = {}) {
  let carved = 0;
  for (let i = 0; i < path.length; i++) {
    const { x, y } = path[i];
    const cells = [[x, y]];
    if (widen) {
      const prev = path[i - 1] ?? path[i], next = path[i + 1] ?? path[i];
      const dx = Math.sign(next.x - prev.x), dy = Math.sign(next.y - prev.y);
      if (dx !== 0 && dy !== 0) { cells.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
      else if (dx !== 0) cells.push([x, y + 1], [x, y - 1]);
      else cells.push([x + 1, y], [x - 1, y]);
    }
    for (const [cx, cy] of cells) {
      if (!F.in(cx, cy) || F.border(cx, cy) || F.g[cy][cx] !== '#') continue;
      F.set(cx, cy, '.');
      carved++;
    }
  }
  return carved;
}

/**
 * CONNECT: while the passable cells form more than one region, tunnel
 * from the smallest region to the nearest other through the fewest walls
 * (a 0-1 BFS: a passable cell costs nothing, a wall one), three wide.
 */
function connectRegions(F, { maxRounds = 64 } = {}) {
  let carved = 0, rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    const { comp, n, sizes } = components(F);
    if (n <= 1) break;
    let small = 0;
    for (let i = 1; i < n; i++) if (sizes[i] < sizes[small]) small = i;
    const { files, ranks } = F;
    const dist = new Int32Array(files * ranks).fill(-1);
    const from = new Int32Array(files * ranks).fill(-1);
    const dq = [];
    for (let y = 0; y < ranks; y++) for (let x = 0; x < files; x++) if (comp[y * files + x] === small) { dist[y * files + x] = 0; dq.push(y * files + x); }
    let goal = -1;
    let head = 0;
    while (head < dq.length) {
      const i = dq[head++];
      const x = i % files, y = (i - x) / files;
      const c = comp[i];
      if (c >= 0 && c !== small) { goal = i; break; }
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!F.in(nx, ny) || F.border(nx, ny)) continue;
        const j = ny * files + nx;
        const cost = F.passable(nx, ny) ? 0 : 1;
        const nd = dist[i] + cost;
        if (dist[j] >= 0 && dist[j] <= nd) continue;
        dist[j] = nd;
        from[j] = i;
        if (cost === 0) dq.splice(head, 0, j); else dq.push(j);
      }
    }
    if (goal < 0) break; // sealed by the border itself: nothing to do
    const path = [];
    for (let i = goal; i >= 0 && dist[i] > 0; i = from[i]) { const x = i % files; path.push({ x, y: (i - x) / files }); }
    path.reverse();
    carved += carvePath(F, path);
  }
  return { carved, rounds };
}

/**
 * WIDEN: a narrow pocket that stretches too far is broken at its middle —
 * the stone in the 3×3 around its central cell goes, an alcove that makes
 * the middle wide and splits the pocket in two — until none stretches
 * over the line. The least cut that ends a crawlspace.
 */
function widenNarrow(F, { maxRounds = 12 } = {}) {
  let widened = 0, rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    const pockets = narrowPockets(F).filter((p) => pocketExtent(p) > LINT.narrowExtent);
    if (!pockets.length) break;
    let cut = 0;
    for (const p of pockets) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of p) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); }
      const alongX = x1 - x0 >= y1 - y0;
      const sorted = p.slice().sort((a, b) => (alongX ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
      const m = sorted[sorted.length >> 1];
      // The cut's centre stays a cell in from the border ring, so the 3×3 it opens is whole.
      const mid = { x: Math.max(2, Math.min(F.files - 3, m.x)), y: Math.max(2, Math.min(F.ranks - 3, m.y)) };
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = mid.x + dx, ny = mid.y + dy;
        if (!F.in(nx, ny) || F.border(nx, ny) || F.g[ny][nx] !== '#') continue;
        F.set(nx, ny, '.');
        widened++;
        cut++;
      }
    }
    if (!cut) break; // hemmed in by the border alone
  }
  return { widened, rounds };
}

/**
 * DRESS: while a box is boring, drop a feature into its largest empty
 * block — a pillar, or a two-crate cluster — a cell in from the block's
 * edge so no new slot hugs a wall. Seeded.
 */
function dressBoring(F, rng, { maxRounds = 8 } = {}) {
  let dropped = 0, rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    const { violations } = densityLint(F);
    if (!violations.length) break;
    const done = new Set();
    for (const v of violations) {
      const R = v.stats.openRect;
      if (!R || R.w < 3 || R.h < 3) continue;
      const key = `${R.x},${R.y},${R.w},${R.h}`;
      if (done.has(key)) continue;
      done.add(key);
      const x = R.x + 1 + randInt(rng, R.w - 2);
      const y = R.y + 1 + randInt(rng, R.h - 2);
      if (!F.in(x, y) || F.border(x, y) || F.g[y][x] !== '.') continue;
      if (rng() < 0.6) F.set(x, y, '#');
      else {
        F.set(x, y, '^', 'K');
        const [dx, dy] = DIRS4[randInt(rng, 4)];
        if (F.in(x + dx, y + dy) && !F.border(x + dx, y + dy) && F.g[y + dy][x + dx] === '.') F.set(x + dx, y + dy, '^', 'K');
      }
      dropped++;
    }
    if (!done.size) break;
  }
  return { dropped, rounds };
}

// ------------------------------------------------------------ the skeletons

/** The seam between two edges (10 chars each): how well two pieces meet. */
function seamScore(a, b) {
  let score = 0, run = 0, any = false;
  const flush = () => {
    if (!run) return;
    any = true;
    score += run >= 3 && run <= 6 ? 3 : run === 2 ? 1 : run === 1 ? 0.5 : 1; // a 3–6 opening is best; a whole-edge merge makes empty blocks
    run = 0;
  };
  for (let i = 0; i < a.length; i++) {
    const open = (a[i] === '.' || a[i] === '^') && (b[i] === '.' || b[i] === '^');
    if (open && (a[i] === '.' || b[i] === '.')) run++;
    else flush();
  }
  flush();
  return any ? score : -2;
}

/**
 * WEAR on a piece (the designer, 2026-09-09, on the first vaults log: "on
 * replays people will start to notice the repeating patterns"): a few
 * seeded edits in the ruin vocabulary so no floor carries an arena
 * verbatim — a wall segment cracks into masonry or opens into a gap, a
 * crate appears against a wall, a crate goes. Zero to three edits, never on
 * a door, never on the piece's edge (the seams are scored on the edges).
 * The lints and the fix-ups run after, so what wear breaks gets repaired.
 */
function weathered(cells, skins, rng) {
  const g = cells.map((r) => r.slice());
  const sk = skins.map((r) => r.slice());
  const n = g.length;
  const at = (x, y) => (x < 0 || y < 0 || x >= n || y >= n ? '#' : g[y][x]);
  const isDoorNear = (x, y) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => sk[y + dy]?.[x + dx] === 'D');
  let edits = 0;
  // A: a wall segment (floor on two opposite sides) cracks or opens.
  if (rng() < 0.6) {
    const segs = [];
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      if (g[y][x] !== '#' || isDoorNear(x, y)) continue;
      if ((at(x - 1, y) === '.' && at(x + 1, y) === '.') || (at(x, y - 1) === '.' && at(x, y + 1) === '.')) segs.push([x, y]);
    }
    if (segs.length) {
      const [x, y] = segs[randInt(rng, segs.length)];
      if (rng() < 0.7) { g[y][x] = '^'; sk[y][x] = 'R'; } else { g[y][x] = '.'; sk[y][x] = '.'; }
      edits++;
    }
  }
  // B: a crate against a wall, in the open.
  if (rng() < 0.5) {
    const spots = [];
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      if (g[y][x] !== '.' || isDoorNear(x, y)) continue;
      let walls = 0, floor = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const c = at(x + dx, y + dy); if (c === '#') walls++; else if (c === '.') floor++; }
      if (floor >= 5 && walls >= 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy) === '#')) spots.push([x, y]);
    }
    if (spots.length) { const [x, y] = spots[randInt(rng, spots.length)]; g[y][x] = '^'; sk[y][x] = 'K'; edits++; }
  }
  // C: a crate or a barrel goes.
  if (rng() < 0.3) {
    const crates = [];
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) if (g[y][x] === '^' && (sk[y][x] === 'K' || sk[y][x] === 'B' || sk[y][x] === '.')) crates.push([x, y]);
    if (crates.length) { const [x, y] = crates[randInt(rng, crates.length)]; g[y][x] = '.'; sk[y][x] = '.'; edits++; }
  }
  return { cells: g, skins: sk, edits };
}

/**
 * THE PREFAB GRID: `cols` × `rows` pieces, each used once until the deck
 * runs dry (then reshuffled), in one of EIGHT orientations by seed (four
 * turns, mirrored or not), laid in reading order with the piece and
 * orientation that meet the west and north neighbours best, WEATHERED so
 * no floor carries an arena verbatim; a one-cell wall ring around the
 * whole.
 */
function prefabSkeleton(pieces, { cols, rows, rng }) {
  if (!pieces.length) throw new Error('prefab: no pieces');
  let deck = shuffle(rng, pieces);
  const laid = [];
  const F = new Floor(cols * BOX + 2, rows * BOX + 2);
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (!deck.length) deck = shuffle(rng, pieces);
      const west = tx > 0 ? grid[ty][tx - 1] : null;
      const north = ty > 0 ? grid[ty - 1][tx] : null;
      const K = Math.min(8, deck.length);
      let best = null;
      for (let i = 0; i < K; i++) {
        const piece = deck[i];
        for (let o = 0; o < 8; o++) {
          const cells = oriented(piece.cells, o);
          let score = 0;
          if (west) score += seamScore(west.cells.map((r) => r[BOX - 1]), cells.map((r) => r[0]));
          if (north) score += seamScore(north.cells[BOX - 1], cells[0]);
          if (!best || score > best.score) best = { i, o, cells, score };
        }
      }
      const piece = deck[best.i];
      deck.splice(best.i, 1);
      const worn = weathered(best.cells, oriented(piece.skins, best.o), rng);
      const tile = { id: piece.id, rot: best.o & 3, mirror: best.o >= 4, wear: worn.edits, tx, ty, cells: worn.cells, skins: worn.skins, score: best.score };
      grid[ty][tx] = tile;
      laid.push(tile);
      for (let y = 0; y < BOX; y++) for (let x = 0; x < BOX; x++) F.set(1 + tx * BOX + x, 1 + ty * BOX + y, tile.cells[y][x], tile.skins[y][x]);
    }
  }
  return { F, laid };
}

// ------------------------------------------------------------ placement

/** The straight floor run ahead of a cell in a facing (map coordinates). */
function runAhead(F, x, y, d) {
  let n = 0;
  for (let k = 1; F.at(x + AHEAD[d][0] * k, y + AHEAD[d][1] * k) === '.'; k++) n++;
  return n;
}

/** Is the staging area clear: floor `wide` cells to either side and `back` behind to `ahead` in front of (x, y) facing d? */
function clearAround(F, x, y, d, { wide = 1, back = 1, ahead = 1 } = {}) {
  const A = AHEAD[d], R = RIGHT[d];
  for (let dy = -back; dy <= ahead; dy++) for (let dx = -wide; dx <= wide; dx++) if (F.at(x + A[0] * dy + R[0] * dx, y + A[1] * dy + R[1] * dx) !== '.') return false;
  return true;
}

/** THE STAGING AREA of a pattern: its own slots (body offsets from the
 *  king) plus `ahead` full rows in front of its front row and one behind
 *  the king, so a kit of any width stands on its slots and its first
 *  steps move it as one. */
function stagingOf(pattern, ahead = 4) {
  const dxs = pattern.slots.map((s) => s.dx), dys = pattern.slots.map((s) => s.dy);
  const x0 = Math.min(...dxs), x1 = Math.max(...dxs), front = Math.max(...dys);
  const cells = [];
  for (let dy = -1; dy <= front + ahead; dy++) for (let dx = x0; dx <= x1; dx++) cells.push({ dx, dy });
  return cells;
}

/** Is every cell of a staging area floor around (x, y) facing d? */
function stagingClear(F, x, y, d, cells) {
  const A = AHEAD[d], R = RIGHT[d];
  for (const { dx, dy } of cells) if (F.at(x + A[0] * dy + R[0] * dx, y + A[1] * dy + R[1] * dx) !== '.') return false;
  return true;
}

/**
 * THE START: a STAGING AREA — floor under every slot of THE OPENING KIT
 * (army.mjs OPENING_KIT: four wide, two deep since 2026-09-10), one row
 * behind the king and four rows ahead of its front, so the kit stands
 * molded on its slots and its first steps move it as one — with a legal
 * box that way for the kit (the first drop on a fresh floor must deal),
 * drawn by seed; a floor with no such area falls back to any wide cell
 * with four cells of run ahead. Returns { x, y, d } or null.
 */
function placeStart(F, rng, { id }) {
  const cells = [];
  for (let y = 1; y < F.ranks - 1; y++) for (let x = 1; x < F.files - 1; x++) if (F.g[y][x] === '.' && clearAround(F, x, y, 0)) cells.push({ x, y });
  const order = shuffle(rng, cells);
  const pattern = makePattern(OPENING_KIT, { seed: 1 });
  const staging = stagingOf(pattern, 4);
  const enemy = { spec: { width: 3, pieces: ['R', 'N'] } };
  const world = loadWorld({ schema: 2, id, map: F.rows() });
  const deals = (c, d) => { // map y down → world r up; the kit as it would stand there (an unstamped spawn), the deal on its cells
    let army = null;
    try { army = spawnArmy(world, pattern, { f: c.x, r: F.ranks - 1 - c.y }, d, 'w', { stamp: false }); } catch { return false; }
    return planBarrier(world, army, { enemy, seed: 1 }).ok;
  };
  for (const staged of [true, false]) {
    for (const c of order.slice(0, staged ? order.length : 200)) {
      const facings = [0, 1, 2, 3].filter((d) => (staged ? stagingClear(F, c.x, c.y, d, staging) : runAhead(F, c.x, c.y, d) >= 4));
      for (const d of facings) if (deals(c, d)) return { x: c.x, y: c.y, d };
    }
  }
  return null;
}

/**
 * THE SPAWNS: `count` wide floor cells at least `spawnMinDist` steps from
 * the start and `spawnSpacing` apart, the nearest first with the smallest
 * army (SPAWN_WIDTHS). Returns [{ x, y, width }].
 */
function placeSpawns(F, rng, start, count) {
  const { dist } = reachLint(F, start);
  const cands = [];
  for (let y = 1; y < F.ranks - 1; y++) for (let x = 1; x < F.files - 1; x++) {
    if (F.g[y][x] !== '.') continue;
    const d = dist[y * F.files + x];
    if (d < LINT.spawnMinDist) continue;
    let wide = true;
    for (let dy = -1; dy <= 1 && wide; dy++) for (let dx = -1; dx <= 1; dx++) if (F.g[y + dy][x + dx] !== '.') { wide = false; break; }
    if (wide) cands.push({ x, y, d });
  }
  const order = shuffle(rng, cands);
  const chosen = [];
  // Spread them over the distance range: bands of equal width, one pick per band, nearest first.
  const maxD = Math.max(...cands.map((c) => c.d), LINT.spawnMinDist);
  const bandW = Math.max(1, (maxD - LINT.spawnMinDist + 1) / count);
  for (let i = 0; i < count; i++) {
    const lo = LINT.spawnMinDist + i * bandW, hi = lo + bandW;
    const far = (c) => chosen.every((s) => Math.max(Math.abs(s.x - c.x), Math.abs(s.y - c.y)) >= LINT.spawnSpacing);
    const pick = order.find((c) => c.d >= lo && c.d < hi && far(c)) ?? order.find((c) => far(c) && !chosen.includes(c));
    if (pick) chosen.push(pick);
  }
  chosen.sort((a, b) => a.d - b.d);
  return chosen.map((c, i) => ({ x: c.x, y: c.y, d: c.d, width: SPAWN_WIDTHS[Math.min(i, SPAWN_WIDTHS.length - 1)] }));
}

// ------------------------------------------------------------ the generator

/**
 * A floor from a seed. `pieces` are loaded stages (loadStageV2) or pieces
 * (pieceOf); `style` names STYLES; `cols` / `rows` count 10×10 tiles;
 * `enemies` the spawn count; `theme` overrides the style's. Returns a world
 * file (stage schema 2, world.mjs loadWorld) with a `gen` block: the
 * pieces laid, the fix-ups, the lint.
 */
export function generateWorld({ seed = 1, style = 'vaults', pieces, cols = null, rows = null, enemies = null, theme = null, id = null, title = null } = {}) {
  const S = STYLES[style];
  if (!S) throw new Error(`generateWorld: unknown style "${style}" (${STYLE_NAMES.join('/')})`);
  const th = theme ?? S.theme;
  if (th && !THEMES.includes(th)) throw new Error(`generateWorld: unknown theme "${th}"`);
  const C = cols ?? S.cols, R = rows ?? S.rows, N = enemies ?? S.enemies;
  const rng = mulberry32(childSeed(seed >>> 0, `dungeon:${style}`));
  const ps = (pieces ?? []).map((p) => (p.cells ? p : pieceOf(p))).filter((p) => p.size === BOX);
  const fixes = {};
  let F, laid = [];
  if (S.skeleton === 'prefab') ({ F, laid } = prefabSkeleton(ps, { cols: C, rows: R, rng }));
  else throw new Error(`generateWorld: skeleton "${S.skeleton}" is not built yet`);
  // THE FIX-UPS, until the cheap lints hold: connect (the lints need one
  // region), widen (an alcove can remove a feature), dress (a pillar can
  // make a slot), and round again — three rounds settle every seed tried.
  fixes.connect = { carved: 0 };
  fixes.widen = { widened: 0 };
  fixes.dress = { dropped: 0 };
  const dressRng = mulberry32(childSeed(seed >>> 0, 'dress'));
  for (let round = 0; round < 4; round++) {
    fixes.connect.carved += connectRegions(F).carved;
    fixes.widen.widened += widenNarrow(F).widened;
    fixes.dress.dropped += dressBoring(F, dressRng).dropped;
    fixes.rounds = round + 1;
    if (components(F).n <= 1 && !narrowPockets(F).some((pk) => pocketExtent(pk) > LINT.narrowExtent) && !densityLint(F, { limit: 1 }).violations.length) break;
  }
  const wid = id ?? `${style}-${seed >>> 0}`;
  const start = placeStart(F, mulberry32(childSeed(seed >>> 0, 'start')), { id: wid });
  if (!start) throw new Error(`generateWorld: no start on ${wid} (no wide cell with a legal box ahead)`);
  const spawns = placeSpawns(F, mulberry32(childSeed(seed >>> 0, 'spawns')), start, N);
  const rowsOut = F.rows().map((r) => r.split(''));
  rowsOut[start.y][start.x] = '@';
  for (const s of spawns) rowsOut[s.y][s.x] = String(s.width);
  const map = rowsOut.map((r) => r.join(''));
  const json = {
    schema: 2,
    id: wid,
    title: title ?? `${S.title} ${seed >>> 0}`,
    notes: `${S.notes} Seed ${seed >>> 0}: ${laid.length} pieces on ${C}×${R} (${laid.filter((t) => t.mirror).length} mirrored, ${laid.reduce((a, t) => a + t.wear, 0)} cells of wear), ${fixes.connect.carved} cells carved to join the regions, ${fixes.widen.widened} widened, ${fixes.dress.dropped} features dropped into empty blocks; ${spawns.length} enemy spawns (widths ${spawns.map((s) => s.width).join(', ')}).`,
    theme: th,
    facing: ['n', 'e', 's', 'w'][start.d],
    map,
    skin: F.skinRows(),
    gen: { style, seed: seed >>> 0, cols: C, rows: R, pieces: laid.map((t) => ({ id: t.id, rot: t.rot, mirror: t.mirror, wear: t.wear, tx: t.tx, ty: t.ty })), fixes: { carved: fixes.connect.carved, widened: fixes.widen.widened, dropped: fixes.dress.dropped, rounds: fixes.rounds }, spawns: spawns.map((s) => ({ x: s.x, y: s.y, width: s.width, dist: s.d })) },
  };
  json.gen.lint = lintWorld(json);
  loadWorld(json); // throws on anything the world loader refuses
  return json;
}
