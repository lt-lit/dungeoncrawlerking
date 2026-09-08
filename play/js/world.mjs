// THE WORLD — Phase 2 milestone 4 (2026-09-08): the floor the game is
// played on, and where an ARENA sits in it.
//
// Brief §1 read literally (decided 2026-09-07, §10 Phase 2): the duel is a
// camera view of the same world, zoomed. This module is the world's DATA —
// a grid of cells, each with its TERRAIN (floor, wall, hole, furniture),
// its PIECE and its authored SKIN — plus the layers the Director and the
// residue rule write (god-minted crates, opened doorways, ruins), the
// player's start, and THE CROP TRANSFORM: where an arena's squares land in
// the world's cells. The ENVIRONMENT the debris ledger keys on IS the world
// (its cells; its pixels run x right, y DOWN from the top rank, 16 px per
// cell — debris.mjs re-exports the transform under its old names), so a
// duel scars the floor it stands on, the cosmetic hashes key on the world
// cell (a crop or a turn never reshuffles the floor), and a turn of the
// camera never moves a scar.
//
// THE CROP: an arena is a rectangle of world cells seen under a FACING —
// the army's (camera.mjs: 0 north … 3 west): arena-north is the world
// direction the player faces, and the camera shows a duel with that
// facing up, so the arena's squares read north-up on the screen as they
// always have. `wf` / `wr` is the world cell of the rectangle's south-west
// corner IN WORLD AXES; `files` / `ranks` are the ARENA's dims (in world
// axes the rectangle is ranks wide and files tall when the facing is east
// or west). Arena square (f, r) → world cell: rotate by the facing
// (camera.mjs toWorld — the crop's rectangle read as a board whose screen
// the arena is), then translate. A pixel inside a square turns with it
// (the debris buffer of a cell is stored in WORLD orientation and turned
// for the screen by index permutation, camera.mjs rotTile). No mirror
// exists: the Phase 1 page's world IS the dealt arena (a stage flipped and
// cropped BEFORE it became a world — a flip is how a lab world is built,
// never a runtime transform), and its crop is the identity: facing north
// at (0, 0). A world duel (the barrier dropping on a walk) is a crop with
// the army's facing; the same painter, the same ledger, the same hashes.
//
// A WORLD FILE is stage schema 2 (stage.mjs), any size: `map` rows of
// '.' floor · '#' / '*' wall · '^' furniture · '@' the player's start (floor)
// · '1'…'9' enemy spawns (floor; the enemy milestone reads them), a `skin`
// grid beside it, `theme`, and optionally `facing` (the army's at the
// start, north by default). The 3–12 × 5–10 cap is the DEAL's (an arena
// must fit the engine), never the world's.
import { normFacing, toScreen, toWorld, pxToScreen, screenDims } from './camera.mjs';
import { WALL, FURNITURE, splitFen, parseBoard, serializeBoard, emptyBoard, squareName, parseSquare } from './fen.mjs';
import { SKIN_CHARS, THEMES } from './stage.mjs';

export const T = 16; // the tile grid (atlas.mjs TILE; debris.mjs T)
export const FLOOR = '.';
export const HOLE = 'O'; // a crumbled square: '*' to the engine, a pit to the eye, permanent (§4.5)
export const START = '@';
export { WALL, FURNITURE };

// ------------------------------------------------------------ the crop

/**
 * The transform from an arena's squares to the world's cells. `files` /
 * `ranks` are the ARENA's; `worldFiles` / `worldRanks` default to the
 * arena's (the identity world). The rectangle's dims in world axes are
 * `w` × `h`.
 */
export function cropTransform({ wf = 0, wr = 0, facing = 0, files, ranks, worldFiles = null, worldRanks = null } = {}) {
  const fc = normFacing(facing);
  const w = fc & 1 ? ranks : files, h = fc & 1 ? files : ranks;
  return { wf, wr, facing: fc, files, ranks, w, h, worldFiles: worldFiles ?? (wf + w), worldRanks: worldRanks ?? (wr + h), arenaFiles: files, arenaRanks: ranks };
}

/** The identity: a world that is exactly one arena, north up. */
export function identityTransform(files, ranks) {
  return cropTransform({ files, ranks });
}

/** Is this crop the identity on its world (the Phase 1 page)? */
export function isIdentity(tx) {
  return tx.wf === 0 && tx.wr === 0 && tx.facing === 0 && tx.w === tx.worldFiles && tx.h === tx.worldRanks;
}

/** Arena square (file 0-based, rank 0-based) → world cell { f, r } (0-based). */
export function arenaToWorld(tx, f, r) {
  const local = toWorld(f, tx.ranks - 1 - r, tx.w, tx.h, tx.facing);
  if (!local) return null;
  return { f: tx.wf + local.f, r: tx.wr + local.rank - 1 };
}

/** World cell → arena square { f, r } (0-based), or null outside the crop. */
export function worldToArena(tx, f, r) {
  const lf = f - tx.wf, lr = r - tx.wr;
  if (lf < 0 || lf >= tx.w || lr < 0 || lr >= tx.h) return null;
  const s = toScreen(lf, lr + 1, tx.w, tx.h, tx.facing);
  return { f: s.col, r: tx.ranks - 1 - s.row };
}

/** Screen pixel of a turned rectangle → the unturned rectangle's pixel
 *  (the inverse of camera.mjs pxToScreen; W × H the UNTURNED dims). */
export function pxToWorld(sx, sy, W, H, facing) {
  switch (normFacing(facing)) {
    case 1: return { x: W - 1 - sy, y: sx };
    case 2: return { x: W - 1 - sx, y: H - 1 - sy };
    case 3: return { x: sy, y: H - 1 - sx };
    default: return { x: sx, y: sy };
  }
}

/** Arena square name → world cell { ef, er } (the debris ledger's spelling). */
export function toEnvCell(tx, sq) {
  const { file, rankFromBottom } = parseSquare(sq);
  const c = arenaToWorld(tx, file, rankFromBottom);
  return { ef: c.f, er: c.r };
}

/** World cell → arena square name, or null when the cell lies outside the arena. */
export function fromEnvCell(tx, ef, er) {
  const a = worldToArena(tx, ef, er);
  return a ? squareName(a.f, a.r) : null;
}

/** The env pixel y of the top edge of the crop's rectangle. */
function rectTop(tx) {
  return (tx.worldRanks - tx.wr - tx.h) * T;
}

/** Env pixel of a point inside an arena square (x, y in tile pixels, y down
 *  in the arena's own screen space) — the point turns with the square. */
export function toEnvPx(tx, sq, x = T / 2, y = T / 2) {
  const { file, rankFromBottom } = parseSquare(sq);
  return arenaPxToEnv(tx, file * T + x, (tx.ranks - 1 - rankFromBottom) * T + y);
}

/** Arena pixel (x right, y down from the arena's top rank, its own screen
 *  space) → env pixel: the pixel turns with the crop. */
export function arenaPxToEnv(tx, X, Y) {
  const p = pxToWorld(X, Y, tx.w * T, tx.h * T, tx.facing);
  return { x: tx.wf * T + p.x, y: rectTop(tx) + p.y };
}

/** A direction in arena screen space (dx right, dy down) → env space. */
export function envDir(tx, dx, dy) {
  switch (tx.facing) {
    case 1: return { dx: -dy, dy: dx };
    case 2: return { dx: -dx, dy: -dy };
    case 3: return { dx: dy, dy: -dx };
    default: return { dx, dy };
  }
}

/** The env cell an env pixel falls in. */
export function cellOfPx(tx, x, y) {
  return { ef: Math.floor(x / T), er: (tx.worldRanks ?? tx.ranks) - 1 - Math.floor(y / T) };
}

/** Env pixel → arena pixel (col*16 + x, rowFromTop*16 + y in the arena's own
 *  screen space) plus the square, or null outside the arena. */
export function toArenaPx(tx, x, y) {
  const lx = x - tx.wf * T, ly = y - rectTop(tx);
  if (lx < 0 || ly < 0 || lx >= tx.w * T || ly >= tx.h * T) return null;
  const p = pxToScreen(lx, ly, tx.w * T, tx.h * T, tx.facing);
  const f = Math.floor(p.x / T), row = Math.floor(p.y / T);
  return { x: p.x, y: p.y, sq: squareName(f, tx.ranks - 1 - row) };
}

// ------------------------------------------------------------ the world

const MAP_CHARS = new Set(['.', '#', '*', '^', '@', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/**
 * A world file (stage schema 2, any size) → a World. `@` marks the
 * player's start (floor beneath), digits enemy spawns (floor beneath;
 * recorded in `spawns` for the enemy milestone). `facing` is the army's
 * at the start (0…3 or n/e/s/w), north by default.
 */
export function loadWorld(json) {
  if (json.schema !== 2) throw new Error(`world ${json.id ?? '?'}: schema ${json.schema} (want 2)`);
  if (!json.id || !Array.isArray(json.map) || !json.map.length) throw new Error(`world ${json.id ?? '?'}: missing id or map`);
  const ranks = json.map.length;
  const files = json.map[0].length;
  if (files < 1 || ranks < 1) throw new Error(`world ${json.id}: empty map`);
  if (json.theme !== undefined && json.theme !== null && !THEMES.includes(json.theme)) throw new Error(`world ${json.id}: unknown theme "${json.theme}"`);
  const world = new World({ id: json.id, files, ranks, title: json.title ?? json.id, theme: json.theme ?? null, notes: json.notes ?? '' });
  const named = { n: 0, north: 0, e: 1, east: 1, s: 2, south: 2, w: 3, west: 3 };
  const facing = json.facing === undefined ? 0 : normFacing(typeof json.facing === 'string' ? named[json.facing.toLowerCase()] ?? json.facing : json.facing);
  json.map.forEach((row, i) => {
    if (row.length !== files) throw new Error(`world ${json.id}: ragged map row ${i}`);
    const r = ranks - 1 - i;
    for (let f = 0; f < files; f++) {
      const ch = row[f];
      if (!MAP_CHARS.has(ch)) throw new Error(`world ${json.id}: bad map char "${ch}" at row ${i} file ${f}`);
      if (ch === '#' || ch === WALL) world.setTerrain(f, r, WALL);
      else if (ch === FURNITURE) world.setTerrain(f, r, FURNITURE);
      else {
        world.setTerrain(f, r, FLOOR);
        if (ch === START) {
          if (world.start) throw new Error(`world ${json.id}: two starts`);
          world.start = { f, r, facing };
        } else if (ch !== '.') world.spawns.push({ n: parseInt(ch, 10), f, r });
      }
    }
  });
  if (json.skin !== undefined) {
    if (!Array.isArray(json.skin) || json.skin.length !== ranks) throw new Error(`world ${json.id}: skin grid must have ${ranks} rows`);
    json.skin.forEach((row, i) => {
      if (row.length !== files) throw new Error(`world ${json.id}: ragged skin row ${i}`);
      const r = ranks - 1 - i;
      for (let f = 0; f < files; f++) {
        const ch = row[f];
        if (ch === '.') continue;
        const name = SKIN_CHARS[ch];
        if (!name) throw new Error(`world ${json.id}: bad skin char "${ch}" at row ${i} file ${f}`);
        if (world.at(f, r) !== FURNITURE) throw new Error(`world ${json.id}: skin "${ch}" on a non-furniture square (row ${i} file ${f})`);
        world.skins[world.idx(f, r)] = name;
      }
    });
  }
  world.spawns.sort((a, b) => a.n - b.n);
  return world;
}

/**
 * The world: `terrain[i]` FLOOR / WALL / HOLE / FURNITURE, `pieces[i]` a
 * piece letter or null, `skins[i]` the authored skin name or null (the
 * skin grid is AUTHORED and static — a double door pairs on it even after
 * a leaf is gone, board-ui classifyTerrain), and the layers as Sets of
 * cell indices: `godCrates` ('^' the gods minted — painted cracked),
 * `opened` (floor where a door opened), `rubble` (floor where a wall
 * broke). Cells index `r * files + f`, rank 0 at the bottom.
 */
export class World {
  constructor({ id, files, ranks, title = '', theme = null, notes = '' }) {
    this.id = id;
    this.files = files;
    this.ranks = ranks;
    this.title = title;
    this.theme = theme;
    this.notes = notes;
    const n = files * ranks;
    this.terrain = new Array(n).fill(FLOOR);
    this.pieces = new Array(n).fill(null);
    this.skins = new Array(n).fill(null);
    this.godCrates = new Set();
    this.opened = new Set();
    this.rubble = new Set();
    this.start = null; // { f, r, facing }
    this.spawns = []; // [{ n, f, r }]
  }

  /** A loaded stage (stage.mjs loadStageV2, flipped / cropped as dealt) → a
   *  world of its size wearing its terrain and skins: the Phase 1 page's
   *  world IS the arena. */
  static fromStage(stage) {
    const w = new World({ id: stage.id, files: stage.files, ranks: stage.ranks, title: stage.title ?? stage.id, theme: stage.theme ?? null, notes: stage.notes ?? '' });
    for (let r = 0; r < stage.ranks; r++) {
      for (let f = 0; f < stage.files; f++) {
        const t = stage.grid[r][f];
        w.terrain[w.idx(f, r)] = t === WALL ? WALL : t === FURNITURE ? FURNITURE : FLOOR;
        const s = stage.skin?.[r]?.[f];
        if (s && t === FURNITURE) w.skins[w.idx(f, r)] = s;
      }
    }
    return w;
  }

  get size() {
    return this.files * this.ranks;
  }

  idx(f, r) {
    return r * this.files + f;
  }

  cellAt(i) {
    const f = i % this.files;
    return { f, r: (i - f) / this.files };
  }

  inBounds(f, r) {
    return f >= 0 && f < this.files && r >= 0 && r < this.ranks;
  }

  /** The terrain of a cell (FLOOR / WALL / HOLE / FURNITURE), undefined off the world. */
  at(f, r) {
    return this.inBounds(f, r) ? this.terrain[this.idx(f, r)] : undefined;
  }

  pieceAt(f, r) {
    return this.inBounds(f, r) ? this.pieces[this.idx(f, r)] : null;
  }

  skinAt(f, r) {
    return this.inBounds(f, r) ? this.skins[this.idx(f, r)] : null;
  }

  setTerrain(f, r, t) {
    this.terrain[this.idx(f, r)] = t;
  }

  setPiece(f, r, ch) {
    this.pieces[this.idx(f, r)] = ch ?? null;
  }

  isFloor(f, r) {
    return this.at(f, r) === FLOOR;
  }

  /** Floor with nothing standing on it (the army rule's BFS). */
  passable(f, r) {
    return this.isFloor(f, r) && !this.pieceAt(f, r);
  }

  /** The FEN cell of a world cell: a piece letter, '*' (a wall OR a hole —
   *  the engine cannot tell them apart), '^', or null for floor. */
  v(f, r) {
    if (!this.inBounds(f, r)) return undefined;
    const i = this.idx(f, r);
    const p = this.pieces[i];
    if (p) return p;
    const t = this.terrain[i];
    return t === FLOOR ? null : t === HOLE ? WALL : t;
  }

  /**
   * What board-ui classifyTerrain reads per cell (its `cell` hook): the FEN
   * cell, whether a '*' is a hole, whether a '^' is god-minted, the
   * authored skin, and the residue. Undefined off the world.
   */
  cellView(f, r) {
    if (!this.inBounds(f, r)) return undefined;
    const i = this.idx(f, r);
    return { v: this.v(f, r), hole: this.terrain[i] === HOLE, crate: this.godCrates.has(i), skin: this.skins[i], opened: this.opened.has(i), rubble: this.rubble.has(i) };
  }

  /**
   * Write an arena's board into the world through a crop (the canvas
   * board's setPosition): every square's piece and terrain, the Director's
   * holes and god crates, the residue. A `skins` map REPLACES the crop's
   * skins (a square absent from it is cleared — the map is the authored
   * grid of the arena, every '^' the stage had, standing or not, so a
   * double door keeps pairing after a leaf is gone); null leaves them.
   * `fen` may be a full FEN or its board field.
   */
  writeArena(tx, fen, { holes = null, godCrates = null, opened = null, rubble = null, skins = null } = {}) {
    const boardField = fen.includes(' ') ? splitFen(fen).board : fen;
    const grid = parseBoard(boardField); // [rankFromTop][file]
    const has = (set, sq) => !!set && set.has(sq);
    for (let r = 0; r < tx.ranks; r++) {
      for (let f = 0; f < tx.files; f++) {
        const c = arenaToWorld(tx, f, r);
        if (!c || !this.inBounds(c.f, c.r)) continue;
        const i = this.idx(c.f, c.r);
        const sq = squareName(f, r);
        const v = grid[tx.ranks - 1 - r]?.[f] ?? null;
        if (v === WALL) {
          this.terrain[i] = has(holes, sq) ? HOLE : WALL;
          this.pieces[i] = null;
        } else if (v === FURNITURE) {
          this.terrain[i] = FURNITURE;
          this.pieces[i] = null;
        } else {
          this.terrain[i] = FLOOR;
          this.pieces[i] = v;
        }
        if (has(godCrates, sq)) this.godCrates.add(i); else this.godCrates.delete(i);
        if (has(opened, sq)) this.opened.add(i); else this.opened.delete(i);
        if (has(rubble, sq)) this.rubble.add(i); else this.rubble.delete(i);
        if (skins) this.skins[i] = skins[sq] ?? null;
      }
    }
  }

  /** The FEN of a crop of this world (turn `w` / `b`): a hole is '*', a
   *  piece its letter — the board the engine sees. */
  arenaFen(tx, turn = 'w') {
    const board = emptyBoard(tx.files, tx.ranks);
    for (let r = 0; r < tx.ranks; r++) {
      for (let f = 0; f < tx.files; f++) {
        const c = arenaToWorld(tx, f, r);
        board[tx.ranks - 1 - r][f] = c ? this.v(c.f, c.r) ?? null : null;
      }
    }
    return `${serializeBoard(board)} ${turn} - - 0 1`;
  }

  /** The skins of a crop by arena square (stage.mjs stageSkins' shape). */
  arenaSkins(tx) {
    const out = {};
    for (let r = 0; r < tx.ranks; r++) {
      for (let f = 0; f < tx.files; f++) {
        const c = arenaToWorld(tx, f, r);
        const s = c ? this.skinAt(c.f, c.r) : null;
        if (s && this.at(c.f, c.r) === FURNITURE) out[squareName(f, r)] = s;
      }
    }
    return out;
  }

  /** The screen grid of the whole world under a facing (camera.mjs screenDims). */
  screenDims(facing) {
    return screenDims(this.files, this.ranks, facing);
  }

  /** The world as rows of chars, top rank first (a save, a test, the eye):
   *  terrain with pieces over it. */
  rows({ pieces = true } = {}) {
    const out = [];
    for (let r = this.ranks - 1; r >= 0; r--) {
      let s = '';
      for (let f = 0; f < this.files; f++) {
        const i = this.idx(f, r);
        s += (pieces && this.pieces[i]) || this.terrain[i];
      }
      out.push(s);
    }
    return out;
  }

  /** One serializable object (the run save, schema stamped by run.mjs). */
  serialize() {
    const rows = (arr, dflt) => {
      const out = [];
      for (let r = this.ranks - 1; r >= 0; r--) {
        let s = '';
        for (let f = 0; f < this.files; f++) s += arr[this.idx(f, r)] ?? dflt;
        out.push(s);
      }
      return out;
    };
    const skinChar = Object.fromEntries(Object.entries(SKIN_CHARS).map(([ch, name]) => [name, ch]));
    return {
      id: this.id,
      files: this.files,
      ranks: this.ranks,
      title: this.title,
      theme: this.theme,
      terrain: rows(this.terrain, FLOOR),
      pieces: rows(this.pieces, '.'),
      skins: rows(this.skins.map((s) => (s ? skinChar[s] ?? '.' : '.')), '.'),
      godCrates: [...this.godCrates].sort((a, b) => a - b),
      opened: [...this.opened].sort((a, b) => a - b),
      rubble: [...this.rubble].sort((a, b) => a - b),
      start: this.start ? { ...this.start } : null,
      spawns: this.spawns.map((s) => ({ ...s })),
    };
  }

  static load(obj) {
    const w = new World({ id: obj.id, files: obj.files, ranks: obj.ranks, title: obj.title ?? '', theme: obj.theme ?? null });
    const read = (rowsIn, put) => {
      for (let r = 0; r < w.ranks; r++) {
        const row = rowsIn[w.ranks - 1 - r] ?? '';
        for (let f = 0; f < w.files; f++) put(w.idx(f, r), row[f]);
      }
    };
    read(obj.terrain ?? [], (i, ch) => { w.terrain[i] = ch === WALL || ch === '#' ? WALL : ch === HOLE ? HOLE : ch === FURNITURE ? FURNITURE : FLOOR; });
    read(obj.pieces ?? [], (i, ch) => { w.pieces[i] = ch && ch !== '.' ? ch : null; });
    read(obj.skins ?? [], (i, ch) => { w.skins[i] = ch && ch !== '.' ? SKIN_CHARS[ch] ?? null : null; });
    for (const i of obj.godCrates ?? []) w.godCrates.add(i);
    for (const i of obj.opened ?? []) w.opened.add(i);
    for (const i of obj.rubble ?? []) w.rubble.add(i);
    w.start = obj.start ? { ...obj.start } : null;
    w.spawns = (obj.spawns ?? []).map((s) => ({ ...s }));
    return w;
  }
}
