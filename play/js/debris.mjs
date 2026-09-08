// THE DEBRIS LAYER (2026-09-07, designer: "a universal debris system, so
// traces of destruction can be seen everywhere").
//
// Every violent thing that happens on a floor leaves a mark on it, and the
// marks are the FLOOR's, not the duel's: the ledger lives in ENVIRONMENT
// space — today a stage in its own uncropped, unflipped grid, later a window
// of the 100×100 dungeon floor — and a duel only contributes to it through
// one transform (envTransform: the deal's flip, crop and king-anchored
// auto-crop). Persistence rides the environment (main.mjs keeps one ledger
// per stage in localStorage), so a rematch starts on the scarred floor.
//
// THE LEDGER IS THE TRUTH, PIXELS ARE A CACHE. An event is small — kind,
// material, an origin and a direction in env PIXELS, the epoch (the duel
// count on this floor) and ply it happened on, and which SPRITE the thing
// that broke was wearing (a role + variant + wall case, never pixels), so a
// theme switch or a toggle repaints every square from the ledger. The
// painter is deterministic: every chunk is drawn from a PRNG seeded by the
// event alone, so a saved floor repaints identically after a reload and the
// flight (particles.mjs) lands every chunk exactly where the painter puts
// it — the last frame of the flight IS the persistent debris.
//
// THE 16×16 RULE (designer): no debris pixel is ever a different size or
// alignment from the floor tile's. The painter writes bytes into a 16×16
// RGBA buffer per cell — never paths, never anti-aliasing — and the
// renderer paints that buffer as a background layer of the cell under the
// terrain tiles, scaled exactly like the floor tile beneath it (style.css
// --debris). Chunks are sampled from the broken thing's OWN SPRITE (real
// plank pixels off a crate, the brick face off a wall, the glaze off an
// urn) and fall back to a material palette when no sprite is available.
//
// Growth is bounded twice: a cell's bucket holds at most CELL_CAP events
// (the oldest is evicted), and a cell paints at most PIXEL_CAP opaque
// pixels (an older event drops its smallest flecks first), so a floor can
// never hold more than its cells × the cap however many duels it has seen.
// Debris also SETTLES: after an epoch the 1-px flecks are gone, after three
// the 2-px chips; blood dries from red to maroon after DRY_PLIES plies or
// by the next duel; skids fade.
//
// Nothing here touches the DOM, ffish or the engine (Node-testable:
// phase0/harness/test-debris.mjs).

export const T = 16; // the tile grid

/** What happened. The CATEGORY is the toggle it answers to. */
export const KINDS = ['smash', 'breach', 'crumble', 'weaken', 'kill', 'skid'];
export const CATEGORY = { smash: 'destruction', breach: 'destruction', crumble: 'destruction', weaken: 'destruction', kill: 'blood', skid: 'skid' };
export const CATEGORIES = ['destruction', 'blood', 'skid', 'wear'];

export const CELL_CAP = 12; // events per cell bucket
export const PIXEL_CAP = 112; // opaque debris pixels per cell at intensity 1 (of 256)
/** The Amount slider's 100% (designer 2026-09-07, after a session at 200%:
 *  "let's make 200% the new baseline"): the game hands the painter
 *  intensity × BASELINE, so the slider keeps its 0–200% range and its
 *  headroom while 100% paints what 200% used to. */
export const BASELINE = 2;
export const DRY_PLIES = 20; // blood is red this long, then maroon
export const WEAR_LEVELS = [6, 16, 40]; // traffic → wear level 1 / 2 / 3

/** Chunk sizes, reach (env px), spread (radians either side of the cone's
 *  axis), count at intensity 1 and the flight's hop height, per material.
 *  Stone is heavy and short, wood flies far in slivers, clay in shards. */
export const MATERIALS = {
  stone: { chunks: [[2, 2], [2, 1], [1, 2], [1, 1], [1, 1], [3, 2]], reach: 15, spread: 0.95, n: 14, hop: 5, palette: ['#6a6577', '#8b869b', '#4c4757'] },
  wood: { chunks: [[3, 1], [1, 3], [2, 1], [1, 2], [1, 1], [1, 1]], reach: 21, spread: 0.7, n: 16, hop: 8, palette: ['#8a5a2b', '#b07a3c', '#5c3a1a'] },
  clay: { chunks: [[2, 2], [2, 1], [1, 2], [1, 1], [1, 1]], reach: 17, spread: 0.8, n: 14, hop: 7, palette: ['#a5623b', '#c98757', '#6e3d24'] },
  floor: { chunks: [[2, 1], [1, 2], [1, 1], [1, 1]], reach: 13, spread: Math.PI, n: 10, hop: 4, palette: ['#6b6b60', '#7d7d70', '#57574d'] },
  blood: { chunks: [[1, 1], [1, 1], [1, 1], [2, 1], [1, 2]], reach: 18, spread: 0.55, n: 12, hop: 3, palette: ['#a8141c', '#c9232c', '#7a0c12'], dried: ['#5a1a1a', '#6e2222', '#3f1212'] },
};
export const MATERIAL_OF_ROLE = { wall: 'stone', masonry: 'stone', floor: 'floor', crate: 'wood', chest: 'wood', door: 'wood', 'door2-l': 'wood', 'door2-r': 'wood', wreckage: 'wood', barrel: 'clay', piece: 'blood' };

// ------------------------------------------------------------ determinism

export function hash(a, b, c = 0) {
  let h = (Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** mulberry32: a small, fast, seedable PRNG — one per event. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hex(s) {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// -------------------------------------------------------------- transform
//
// THE ENVIRONMENT IS THE WORLD (Phase 2 milestone 4, 2026-09-08): the
// transform from an arena's squares and pixels to the world's cells and
// pixels lives in world.mjs (the crop: an origin cell and the army's
// facing; the identity on the Phase 1 page, whose world IS the dealt
// arena) and is re-exported here under the names the ledger's callers
// use. Env cell (ef, er) is the world's file and 0-based rank; env pixels
// run x right, y DOWN, with row 0 the TOP of the world (its highest rank).
import { cellOfPx } from './world.mjs';
export { cropTransform, identityTransform, isIdentity, arenaToWorld, worldToArena, toEnvCell, fromEnvCell, toEnvPx, envDir, cellOfPx, toArenaPx } from './world.mjs';

export function parseSquare(sq) {
  return { f: sq.charCodeAt(0) - 97, r: parseInt(sq.slice(1), 10) - 1 };
}
export function spriteVar(src) {
  if (!src) return null;
  if (src.role === 'wall' || src.role === 'masonry') return src.mask >= 0 ? `--tile-wall-${src.mask}` : '--tile-wall';
  if (src.role === 'floor') return `--tile-floor-${src.v || 1}`;
  if (src.role === 'door2-l' || src.role === 'door2-r') return `--sprite-${src.role}`;
  return `--sprite-${src.role}${src.v > 1 ? `-${src.v}` : ''}`;
}

// ------------------------------------------------------------------ ledger

const EV_FIELDS = ['id', 'k', 'm', 'x', 'y', 'x2', 'y2', 'dx', 'dy', 'e', 'p', 's', 'role', 'v', 'mask', 'n'];

export class DebrisLedger {
  constructor({ id, files, ranks }) {
    this.id = id;
    this.files = files;
    this.ranks = ranks;
    this.epoch = 0;
    this.next = 1;
    this.events = [];
    this.buckets = new Map(); // cell index → event ids, oldest first
    this.traffic = new Uint16Array(files * ranks); // settled traffic (before this epoch)
    this.trafficEpoch = new Map(); // this epoch's visits, cell index → count (undo recomputes it)
  }

  cellIndex(ef, er) {
    return er * this.files + ef;
  }

  inBounds(ef, er) {
    return ef >= 0 && ef < this.files && er >= 0 && er < this.ranks;
  }

  /** A new duel on this floor: the last one's traffic settles, the epoch ticks. */
  beginEpoch() {
    this.settleTraffic();
    this.epoch++;
    return this.epoch;
  }

  settleTraffic() {
    for (const [i, c] of this.trafficEpoch) this.traffic[i] = Math.min(65535, this.traffic[i] + c);
    this.trafficEpoch.clear();
  }

  /**
   * Record an event: { k, m, x, y, x2?, y2?, dx?, dy?, p, s?, src?: {role, v, mask}, n? }
   * (env pixels; `p` the ply; `s` a salt so two events in one ply differ).
   * Returns the stored event (with `id` and `e`).
   */
  add(ev) {
    const stored = {
      id: this.next++,
      k: ev.k,
      m: ev.m ?? (ev.k === 'kill' ? 'blood' : ev.k === 'crumble' || ev.k === 'skid' ? 'floor' : ev.src ? MATERIAL_OF_ROLE[ev.src.role] ?? 'stone' : 'stone'),
      x: Math.round(ev.x),
      y: Math.round(ev.y),
      x2: ev.x2 == null ? null : Math.round(ev.x2),
      y2: ev.y2 == null ? null : Math.round(ev.y2),
      dx: ev.dx ?? 0,
      dy: ev.dy ?? 0,
      e: this.epoch,
      p: ev.p ?? 0,
      s: ev.s ?? 0,
      role: ev.src?.role ?? null,
      v: ev.src?.v ?? 0,
      mask: ev.src?.mask ?? -1,
      n: ev.n ?? 1,
    };
    if (!KINDS.includes(stored.k)) throw new Error(`debris: unknown kind ${stored.k}`);
    this.events.push(stored);
    this.#bucket(stored);
    return stored;
  }

  /** The cells an event can touch — conservative, by the kind's reach. */
  cellsOf(ev) {
    const out = new Set();
    const put = (x, y) => {
      const c = cellOfPx(this, x, y);
      if (this.inBounds(c.ef, c.er)) out.add(this.cellIndex(c.ef, c.er));
    };
    if (ev.k === 'skid' && ev.x2 != null) {
      const steps = Math.max(1, Math.ceil(Math.hypot(ev.x2 - ev.x, ev.y2 - ev.y) / 4));
      for (let i = 0; i <= steps; i++) {
        const x = ev.x + ((ev.x2 - ev.x) * i) / steps, y = ev.y + ((ev.y2 - ev.y) * i) / steps;
        for (const [ox, oy] of [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]]) put(x + ox, y + oy);
      }
      return out;
    }
    const reach = ev.k === 'weaken' ? 10 : (MATERIALS[ev.m]?.reach ?? 16) + 3;
    for (let dy = -reach; dy <= reach; dy += T / 2) for (let dx = -reach; dx <= reach; dx += T / 2) put(ev.x + dx, ev.y + dy);
    put(ev.x + reach, ev.y + reach);
    put(ev.x - reach, ev.y - reach);
    if (ev.k === 'weaken') put(ev.x, ev.y + T); // the chips fall south
    return out;
  }

  #bucket(ev) {
    for (const i of this.cellsOf(ev)) {
      let b = this.buckets.get(i);
      if (!b) this.buckets.set(i, (b = []));
      b.push(ev.id);
      while (b.length > CELL_CAP) b.shift(); // the oldest leaves this cell
    }
  }

  #rebucket() {
    this.buckets.clear();
    for (const ev of this.events) this.#bucket(ev);
  }

  /** Undo: forget this epoch's events past `ply`. Traffic is the caller's to
   *  recompute (resetEpochTraffic + visit over the record's moves). */
  dropAfter(ply) {
    const before = this.events.length;
    this.events = this.events.filter((ev) => !(ev.e === this.epoch && ev.p > ply));
    if (this.events.length !== before) this.#rebucket();
    return before - this.events.length;
  }

  resetEpochTraffic() {
    this.trafficEpoch.clear();
  }

  /** A piece stood on / passed over a cell. */
  visit(ef, er, n = 1) {
    if (!this.inBounds(ef, er)) return;
    const i = this.cellIndex(ef, er);
    this.trafficEpoch.set(i, (this.trafficEpoch.get(i) ?? 0) + n);
  }

  trafficAt(ef, er) {
    if (!this.inBounds(ef, er)) return 0;
    const i = this.cellIndex(ef, er);
    return this.traffic[i] + (this.trafficEpoch.get(i) ?? 0);
  }

  /** The events that may paint on a cell, oldest first. */
  eventsAt(ef, er) {
    const b = this.buckets.get(this.cellIndex(ef, er));
    if (!b || !b.length) return [];
    const byId = this.#byId();
    return b.map((id) => byId.get(id)).filter(Boolean);
  }

  #byId() {
    if (!this._byId || this._byIdN !== this.events.length || this._byIdNext !== this.next) {
      this._byId = new Map(this.events.map((ev) => [ev.id, ev]));
      this._byIdN = this.events.length;
      this._byIdNext = this.next;
    }
    return this._byId;
  }

  /** Drop events no cell remembers any more (evicted everywhere). */
  compact() {
    const live = new Set();
    for (const b of this.buckets.values()) for (const id of b) live.add(id);
    const before = this.events.length;
    this.events = this.events.filter((ev) => live.has(ev.id));
    return before - this.events.length;
  }

  clear() {
    this.events = [];
    this.buckets.clear();
    this.traffic.fill(0);
    this.trafficEpoch.clear();
  }

  stats() {
    let touched = 0;
    for (let i = 0; i < this.traffic.length; i++) if (this.traffic[i] || this.trafficEpoch.get(i)) touched++;
    return { events: this.events.length, cells: this.buckets.size, epoch: this.epoch, traffic: touched };
  }

  serialize() {
    this.compact();
    const traffic = [];
    for (let i = 0; i < this.traffic.length; i++) if (this.traffic[i]) traffic.push([i, this.traffic[i]]);
    return {
      v: 1,
      id: this.id,
      files: this.files,
      ranks: this.ranks,
      epoch: this.epoch,
      next: this.next,
      events: this.events.map((ev) => EV_FIELDS.map((f) => ev[f])),
      traffic,
      trafficEpoch: [...this.trafficEpoch],
    };
  }

  static load(obj) {
    const L = new DebrisLedger({ id: obj.id, files: obj.files, ranks: obj.ranks });
    L.epoch = obj.epoch ?? 0;
    L.next = obj.next ?? 1;
    for (const row of obj.events ?? []) {
      const ev = {};
      EV_FIELDS.forEach((f, i) => { ev[f] = row[i]; });
      if (!KINDS.includes(ev.k)) continue;
      L.events.push(ev);
      L.next = Math.max(L.next, ev.id + 1);
    }
    for (const [i, c] of obj.traffic ?? []) if (i >= 0 && i < L.traffic.length) L.traffic[i] = c;
    // A reload mid-duel: that duel cannot resume, so its traffic settles.
    for (const [i, c] of obj.trafficEpoch ?? []) if (i >= 0 && i < L.traffic.length) L.traffic[i] = Math.min(65535, L.traffic[i] + c);
    L.#rebucket();
    return L;
  }
}

// -------------------------------------------------------------- the chunks

/** A w×h window of fully opaque pixels off a sprite, or null. */
export function sampleChunk(sprite, w, h, next) {
  if (!sprite || sprite.w < w || sprite.h < h) return null;
  for (let tries = 0; tries < 14; tries++) {
    const x0 = Math.floor(next() * (sprite.w - w + 1)), y0 = Math.floor(next() * (sprite.h - h + 1));
    let ok = true;
    for (let y = 0; y < h && ok; y++) for (let x = 0; x < w; x++) if (sprite.data[((y0 + y) * sprite.w + x0 + x) * 4 + 3] < 250) { ok = false; break; }
    if (!ok) continue;
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * sprite.w + x0 + x) * 4, d = (y * w + x) * 4;
      px[d] = sprite.data[s]; px[d + 1] = sprite.data[s + 1]; px[d + 2] = sprite.data[s + 2]; px[d + 3] = 255;
    }
    return px;
  }
  return null;
}

function paletteChunk(palette, w, h, next) {
  const px = new Uint8Array(w * h * 4);
  const cols = palette.map(hex);
  for (let i = 0; i < w * h; i++) {
    const c = cols[Math.min(cols.length - 1, Math.floor(next() * cols.length))];
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
  }
  return px;
}

function solidChunk(rgb, w, h, alpha = 255) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = rgb[0]; px[i * 4 + 1] = rgb[1]; px[i * 4 + 2] = rgb[2]; px[i * 4 + 3] = alpha; }
  return px;
}

function chunk(x, y, w, h, px, t, extra = {}) {
  return { x: Math.round(x), y: Math.round(y), w, h, px, t, sz: w * h, ...extra };
}

/** Is a piece of blood dried on this board? */
export function bloodDried(ev, ctx) {
  return ev.e < (ctx.epoch ?? ev.e) || (ctx.ply ?? ev.p) - ev.p >= DRY_PLIES;
}

/**
 * The persistent chunks an event lands: [{x, y, w, h, px, t, sz}] in env
 * pixels (x, y the chunk's top-left), `t` the landing time fraction the
 * flight uses (near lands first). Deterministic in the event and ctx.
 * `sprites.get(varName)` → {w, h, data} or null (the sampler; optional).
 */
export function chunksOf(ev, sprites, ctx = {}) {
  const intensity = ctx.intensity ?? 1;
  const next = rng(hash(ev.x * 31 + ev.y, ev.e * 1000 + ev.p, ev.s + KINDS.indexOf(ev.k) * 97));
  const mat = MATERIALS[ev.m] ?? MATERIALS.stone;
  const sprite = sprites?.get?.(spriteVar({ role: ev.role, v: ev.v, mask: ev.mask })) ?? null;
  const pick = (w, h) => sampleChunk(sprite, w, h, next) ?? paletteChunk(mat.palette, w, h, next);
  const out = [];
  const dir = Math.hypot(ev.dx, ev.dy) > 0 ? Math.atan2(ev.dy, ev.dx) : null;
  const scatter = (count, { reach = mat.reach, spread = mat.spread, sizes = mat.chunks, ox = 0, oy = 0, minD = 0.15, pixels = pick } = {}) => {
    for (let i = 0; i < count; i++) {
      const [w, h] = sizes[Math.floor(next() * sizes.length)];
      const a = dir == null || spread >= Math.PI ? next() * Math.PI * 2 : dir + (next() - 0.5) * 2 * spread;
      const sizeF = w * h >= 3 ? 0.6 : w * h === 2 ? 0.8 : 1;
      const d = reach * (minD + (1 - minD) * next() ** 1.3) * sizeF;
      const x = ev.x + ox + Math.cos(a) * d - w / 2, y = ev.y + oy + Math.sin(a) * d - h / 2;
      out.push(chunk(x, y, w, h, pixels(w, h), 0.35 + 0.65 * (d / reach)));
    }
  };
  switch (ev.k) {
    case 'smash':
    case 'breach':
      scatter(Math.round(mat.n * intensity * ev.n));
      break;
    case 'crumble':
      scatter(Math.round(MATERIALS.floor.n * intensity * ev.n), { reach: MATERIALS.floor.reach, spread: Math.PI, sizes: MATERIALS.floor.chunks, minD: 0.55 });
      break;
    case 'weaken': {
      // Two or three chips fall from the crack onto the floor to the south.
      const n = Math.max(1, Math.round(3 * intensity * ev.n));
      for (let i = 0; i < n; i++) {
        const [w, h] = [[2, 1], [1, 1], [1, 1]][Math.floor(next() * 3)];
        out.push(chunk(ev.x - 6 + next() * 11, ev.y + T / 2 + 1 + next() * 5, w, h, pick(w, h), 0.4 + 0.6 * next()));
      }
      break;
    }
    case 'kill': {
      const dried = bloodDried(ev, ctx);
      const pal = dried ? mat.dried : mat.palette;
      const cols = pal.map(hex);
      // The pool: a blob a little along the direction of the blow.
      const px = ev.x + (dir == null ? 0 : Math.cos(dir) * 2), py = ev.y + (dir == null ? 0 : Math.sin(dir) * 2);
      const rx = 2 + next() * 1.2, ry = 1.6 + next() * 1.2;
      for (let y = -3; y <= 3; y++) for (let x = -4; x <= 4; x++) {
        const d = (x / rx) ** 2 + (y / ry) ** 2;
        if (d > 1 + (next() - 0.5) * 0.5) continue;
        const c = d < 0.4 ? cols[1] : d < 0.8 ? cols[0] : cols[2];
        out.push(chunk(px + x, py + y, 1, 1, solidChunk(c, 1, 1), 0.3 + d * 0.15, { pool: true }));
      }
      // Droplets, away from the blow; a couple of drips far out.
      const drops = Math.round(mat.n * intensity * ev.n);
      scatter(drops, { pixels: (w, h) => paletteChunk(pal, w, h, next), minD: 0.3 });
      scatter(2, { reach: mat.reach + 6, spread: 0.3, sizes: [[1, 2], [1, 1]], minD: 0.7, pixels: (w, h) => paletteChunk(pal, w, h, next) });
      break;
    }
    case 'skid': {
      if (ev.x2 == null) break;
      // A scuff along the drag: translucent dark pixels, thin and broken on
      // the way, a denser darker scrape at the landing.
      const len = Math.hypot(ev.x2 - ev.x, ev.y2 - ev.y);
      const steps = Math.max(2, Math.round(len));
      const nx = -(ev.y2 - ev.y) / (len || 1), ny = (ev.x2 - ev.x) / (len || 1);
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const late = u > 0.7;
        if (!late && next() > 0.55 * intensity) continue;
        const side = late ? (next() - 0.5) * 2.4 : (next() - 0.5) * 2;
        const x = ev.x + (ev.x2 - ev.x) * u + nx * side, y = ev.y + (ev.y2 - ev.y) * u + ny * side;
        out.push(chunk(x, y, 1, 1, solidChunk([0, 0, 0], 1, 1, late ? 0x84 : 0x58), u));
        if (late && next() < 0.5) out.push(chunk(x + nx, y + ny, 1, 1, solidChunk([0, 0, 0], 1, 1, 0x60), u));
      }
      break;
    }
    default:
      break;
  }
  return settle(ev, out, ctx, next);
}

/** Debris settles with age: flecks go first, then chips; skids fade. */
function settle(ev, chunks, ctx, next) {
  const age = (ctx.epoch ?? ev.e) - ev.e;
  if (age <= 0) return chunks;
  if (ev.k === 'skid') return age >= 3 ? [] : chunks.filter((c, i) => (i + age) % 2 === 0);
  if (ev.k === 'kill') return chunks.filter((c) => c.pool || (age < 3 && c.sz >= 2));
  return chunks.filter((c) => (age < 3 ? c.sz >= 2 : c.sz >= 3));
}

/**
 * The SHATTER: the broken sprite itself, cut into 2×2 blocks, every block a
 * flying chunk that fades in the air (ephemeral — the flight draws them, the
 * painter never does). `sprite` = {w, h, data}; the origin is the sprite's
 * cell (env px of its top-left; a 16×32 prop stands on its cell and rises
 * into the one north, so its top-left is one cell up).
 */
export function shatterOf(ev, sprite, ctx = {}) {
  if (!sprite) return [];
  const inward = !!ctx.inward; // the crumble: the floor's own blocks fall INTO the pit
  const next = rng(hash(ev.x, ev.y, ev.s + 7));
  const mat = MATERIALS[ev.m] ?? MATERIALS.stone;
  const dir = Math.hypot(ev.dx, ev.dy) > 0 ? Math.atan2(ev.dy, ev.dx) : null;
  const left = ev.x - T / 2, top = ev.y - T / 2 - (sprite.h - T);
  const out = [];
  for (let by = 0; by < sprite.h; by += 2) for (let bx = 0; bx < sprite.w; bx += 2) {
    const px = new Uint8Array(16);
    let any = false;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const sx = bx + x, sy = by + y;
      if (sx >= sprite.w || sy >= sprite.h) continue;
      const s = (sy * sprite.w + sx) * 4, d = (y * 2 + x) * 4;
      if (sprite.data[s + 3] < 128) continue;
      px[d] = sprite.data[s]; px[d + 1] = sprite.data[s + 1]; px[d + 2] = sprite.data[s + 2]; px[d + 3] = 255;
      any = true;
    }
    if (!any) continue;
    const a = dir == null ? next() * Math.PI * 2 : dir + (next() - 0.5) * 2 * Math.min(1.4, mat.spread + 0.4);
    const d = mat.reach * (0.3 + next() * 1.1) * (ctx.intensity ?? 1);
    const tx = inward ? ev.x - 1 + (next() - 0.5) * 3 : left + bx + Math.cos(a) * d;
    const ty = inward ? ev.y - 1 + (next() - 0.5) * 3 : top + by + Math.sin(a) * d;
    out.push({ x: left + bx, y: top + by, w: 2, h: 2, px, sz: 4, tx, ty, t: 0.5 + next() * 0.5, fade: inward ? 0.2 + next() * 0.4 : 0.35 + next() * 0.5, eph: true });
  }
  return out;
}

// --------------------------------------------------------------- the paint

export function wearLevel(traffic) {
  let l = 0;
  for (const th of WEAR_LEVELS) if (traffic >= th) l++;
  return l;
}

/** The scuff a worn cell wears: translucent dark pixels, denser by level,
 *  where the feet go — the middle of the square. */
function paintWear(buf, level, ef, er) {
  if (level <= 0) return;
  const n = [0, 9, 20, 36][Math.min(3, level)];
  const alpha = [0, 0x40, 0x50, 0x60][Math.min(3, level)];
  const next = rng(hash(ef * 7 + 3, er * 13 + 5, 99));
  for (let i = 0; i < n; i++) {
    const x = 3 + Math.floor(next() * 10), y = 4 + Math.floor(next() * 10);
    const o = (y * T + x) * 4;
    if (buf[o + 3]) continue;
    buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = alpha;
  }
}

/** Straight-alpha "over" of one pixel. */
function over(buf, o, r, g, b, a) {
  if (a >= 255 || !buf[o + 3]) {
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
    return;
  }
  const sa = a / 255, da = buf[o + 3] / 255;
  const oa = sa + da * (1 - sa);
  buf[o] = Math.round((r * sa + buf[o] * da * (1 - sa)) / oa);
  buf[o + 1] = Math.round((g * sa + buf[o + 1] * da * (1 - sa)) / oa);
  buf[o + 2] = Math.round((b * sa + buf[o + 2] * da * (1 - sa)) / oa);
  buf[o + 3] = Math.round(oa * 255);
}

/** Write a chunk's pixels that fall inside the cell window at (wx, wy). */
export function blitChunk(buf, c, wx, wy) {
  let n = 0;
  for (let y = 0; y < c.h; y++) {
    const py = c.y + y - wy;
    if (py < 0 || py >= T) continue;
    for (let x = 0; x < c.w; x++) {
      const px = c.x + x - wx;
      if (px < 0 || px >= T) continue;
      const s = (y * c.w + x) * 4;
      if (!c.px[s + 3]) continue;
      const o = (py * T + px) * 4;
      if (!buf[o + 3] && c.px[s + 3] === 255) n++;
      over(buf, o, c.px[s], c.px[s + 1], c.px[s + 2], c.px[s + 3]);
    }
  }
  return n;
}

/**
 * Paint one env cell: a 16×16 RGBA buffer, or null when nothing is on it.
 * ctx = { sprites?, toggles?: {destruction, blood, skid, wear}, intensity?,
 *         ply?, epoch?, isFloor?: (ef, er) → bool, pending?: Set of event ids
 *         still in flight (not painted yet) }
 */
export function paintCell(ledger, ef, er, ctx = {}) {
  if (!ledger.inBounds(ef, er)) return null;
  if (ctx.isFloor && !ctx.isFloor(ef, er)) return null;
  const toggles = ctx.toggles ?? {};
  const on = (cat) => toggles[cat] !== false;
  const intensity = ctx.intensity ?? 1;
  const buf = new Uint8ClampedArray(T * T * 4);
  let any = false;
  if (on('wear')) {
    const level = wearLevel(ledger.trafficAt(ef, er));
    if (level) { paintWear(buf, level, ef, er); any = true; }
  }
  const wx = ef * T, wy = (ledger.ranks - 1 - er) * T;
  const events = ledger.eventsAt(ef, er).filter((ev) => on(CATEGORY[ev.k]) && !(ctx.pending?.has(ev.id)));
  if (events.length) {
    const cctx = { ...ctx, intensity, epoch: ctx.epoch ?? ledger.epoch };
    // Every event's chunks that touch this window, oldest event first.
    const lists = events.map((ev) => chunksOf(ev, ctx.sprites, cctx).filter((c) => c.x + c.w > wx && c.x < wx + T && c.y + c.h > wy && c.y < wy + T));
    // The coverage cap: the oldest event drops its smallest chunks first.
    const cap = Math.min(T * T, Math.round(PIXEL_CAP * intensity));
    let total = lists.reduce((s, l) => s + l.reduce((t, c) => t + (c.px[3] === 255 ? c.sz : 0), 0), 0);
    let i = 0;
    while (total > cap && i < lists.length) {
      const l = lists[i];
      if (!l.length) { i++; continue; }
      let k = 0;
      for (let j = 1; j < l.length; j++) if (l[j].sz < l[k].sz) k = j;
      total -= l[k].px[3] === 255 ? l[k].sz : 0;
      l.splice(k, 1);
    }
    for (const l of lists) for (const c of l) { blitChunk(buf, c, wx, wy); any = true; }
  }
  return any ? buf : null;
}

/** Is this cell's terrain floor (debris paints on floor only)? From a
 *  classifyTerrain kind. */
export function kindIsFloor(k) {
  return !!k && !k.wallTile && !k.hole && !k.furniture;
}
