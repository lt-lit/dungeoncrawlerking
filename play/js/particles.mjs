// THE FLIGHT (2026-09-07, designer: "what if we visibly see it spray out and
// land on the environment… smashing thru walls with pieces could look so
// cool"). Debris does not appear; it flies. Every live chunk is drawn, on a
// pixel-art tick (~15 steps a second — sub-pixel motion at sixty frames
// would be smoother and wrong for this art), INTO THE DEBRIS CANVASES OF
// THE CELLS IT IS OVER (board-ui paintDebrisFrame: the cell's own 16×16
// canvas, composited over the square's persistent debris for the frame),
// at integer pixels of the same 16-grid the floor is drawn on. The last
// frame of a flight is the persistent debris pixel for pixel: the painter
// (debris.mjs chunksOf) decided where every chunk lands before it took off,
// so the flight is a tween from the broken thing to a known target, with a
// hop for the arc and a bounce for stone.
//
// Why the cells' own canvases and not one canvas over the board: a cell's
// debris canvas is its first child, so anything drawn in it sits UNDER the
// sprites and the pieces by document order — a chunk in the air passes
// behind a piece, and a landed chunk is never drawn over one. The first
// cut flew the chunks on the fx layer above everything ("blood and debris
// rendered on top of the piece layer"), and the second gave the pieces a
// z-index to stack them over a board-wide flight layer, which made Firefox
// drop every positioned child of the cells — pieces, sprites, torches —
// for a frame during the quake animations ("all the pieces will blink out
// of existence"). Nothing here touches a piece or a cell's style.
//
// Two kinds of chunk fly: the PERSISTENT ones the painter will paint and the
// EPHEMERAL shatter (debris.mjs shatterOf: the broken sprite cut into 2×2
// blocks, most of which fade in the air). A skid is drawn PROGRESSIVELY
// under the sliding piece (streak): the motion draws the mark.
//
// ONE FRAME LOOP for every flight in the air. A flight goes flying →
// LANDED (its chunks held at their final pixels, its `landed` promise
// resolved, so the caller can paint the persistent debris under them) →
// RELEASED (the caller has painted; the chunks leave). A cell a chunk left
// is restored to its persistent debris the next frame.
//
// Cost: a hundred chunks a frame stamped into a few dozen 16×16 buffers —
// well under a millisecond on a phone. Reduced motion / ?fx=0 give ms = 0
// and a flight lands at once (the debris then simply appears).
import { toArenaPx, MATERIALS, T } from './debris.mjs';

const TICK = 66; // ms between frames — the pixel-art step

const easeOut = (p) => 1 - (1 - p) * (1 - p);
const NONE = { id: 0, landed: Promise.resolve() };

export class Particles {
  constructor(boardUI) {
    this.ui = boardUI;
    this.flights = []; // in the air or held — see the header
    this.frames = 0; // drawn frames (a test surface)
    this.nextId = 1;
    this.timer = null;
    this.shown = new Set(); // squares wearing a transient frame
  }

  get busy() {
    return this.flights.length > 0;
  }

  /** Stamp one chunk at an env-pixel position (top-left) into the per-square
   *  frame buffers, alpha 0…1 — pixel by pixel, each into the square it is
   *  over, replacing where opaque and blending where translucent. */
  #stamp(overlays, tx, c, x, y, alpha = 1) {
    const bx = Math.round(x), by = Math.round(y);
    for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) {
      const s = (j * c.w + i) * 4;
      const a = c.px[s + 3] * alpha;
      if (a <= 0) continue;
      const p = toArenaPx(tx, bx + i, by + j);
      if (!p) continue;
      let buf = overlays.get(p.sq);
      if (!buf) {
        const base = this.ui.debrisBuf(p.sq);
        buf = base ? new Uint8ClampedArray(base) : new Uint8ClampedArray(T * T * 4);
        overlays.set(p.sq, buf);
      }
      const o = ((p.y % T) * T + (p.x % T)) * 4;
      if (a >= 255 || !buf[o + 3]) {
        buf[o] = c.px[s]; buf[o + 1] = c.px[s + 1]; buf[o + 2] = c.px[s + 2]; buf[o + 3] = Math.round(a);
      } else {
        const sa = a / 255, da = buf[o + 3] / 255, oa = sa + da * (1 - sa);
        buf[o] = Math.round((c.px[s] * sa + buf[o] * da * (1 - sa)) / oa);
        buf[o + 1] = Math.round((c.px[s + 1] * sa + buf[o + 1] * da * (1 - sa)) / oa);
        buf[o + 2] = Math.round((c.px[s + 2] * sa + buf[o + 2] * da * (1 - sa)) / oa);
        buf[o + 3] = Math.round(oa * 255);
      }
    }
  }

  #stampFlight(overlays, f, u) {
    const { tx, origin, hop } = f;
    if (f.kind === 'streak') {
      for (const c of f.chunks) if (c.t <= u) this.#stamp(overlays, tx, c, c.x, c.y);
      return;
    }
    for (const c of f.chunks) {
      const p = Math.min(1, u / c.t);
      const e = easeOut(p);
      const x = origin.x - c.w / 2 + (c.x - (origin.x - c.w / 2)) * e;
      let y = origin.y - c.h / 2 + (c.y - (origin.y - c.h / 2)) * e;
      if (p < 1) y -= hop * Math.sin(Math.PI * p) * (0.6 + 0.4 * c.t);
      else if (f.bounce && c.sz >= 2 && u < c.t + 0.18) y -= Math.round(2 * Math.sin((Math.PI * (u - c.t)) / 0.18));
      this.#stamp(overlays, tx, c, x, y);
    }
    for (const c of f.eph) {
      if (u > c.fade + 0.3) continue;
      const p = Math.min(1, u / c.t);
      const e = easeOut(p);
      const x = c.x + (c.tx - c.x) * e;
      const y = c.y + (c.ty - c.y) * e - hop * 1.4 * Math.sin(Math.PI * p);
      const alpha = u < c.fade ? 1 : Math.max(0, 1 - (u - c.fade) / 0.3);
      this.#stamp(overlays, tx, c, x, y, alpha);
    }
  }

  /** The one loop: stamp every flight at its own time into per-square
   *  buffers, paint those squares, restore the squares the chunks left,
   *  land the flights that are done, drop the released, stop when none
   *  remain. */
  #frame() {
    this.timer = null;
    const now = performance.now();
    this.flights = this.flights.filter((f) => !f.released);
    const overlays = new Map();
    for (const f of this.flights) {
      const u = Math.min(1, (now - f.t0) / f.ms);
      this.#stampFlight(overlays, f, u);
      if (u >= 1 && !f.landedAt) {
        f.landedAt = now;
        f.resolve();
      }
    }
    for (const [sq, buf] of overlays) this.ui.paintDebrisFrame(sq, buf);
    for (const sq of this.shown) if (!overlays.has(sq)) this.ui.restoreDebris(sq);
    this.shown = new Set(overlays.keys());
    this.frames++;
    if (!this.flights.length) {
      this.clear();
      return;
    }
    this.timer = setTimeout(() => this.#frame(), TICK);
  }

  #launch(f) {
    if (!f.ms || (!f.chunks.length && !(f.eph ?? []).length)) return NONE;
    f.id = this.nextId++;
    f.t0 = performance.now();
    f.landedAt = 0;
    f.released = false;
    f.landed = new Promise((r) => { f.resolve = r; });
    this.flights.push(f);
    if (!this.timer) this.#frame();
    return { id: f.id, landed: f.landed };
  }

  /**
   * Fly chunks from an origin (env px) to their targets. `chunks` are the
   * painter's persistent chunks ({x, y, w, h, px, t}); `eph` the shatter
   * blocks ({x, y, tx, ty, t, fade}); `hop` the arc height in px. Returns
   * { id, landed }: `landed` resolves when the last chunk is down and HELD;
   * the caller paints the cells under it and then calls release(id).
   */
  fly({ tx, chunks = [], eph = [], origin, ms = 320, hop = 5, bounce = false }) {
    return this.#launch({ kind: 'fly', tx, chunks, eph, origin, ms, hop, bounce });
  }

  /** Draw a skid's chunks progressively over `ms`, in step with the slide. */
  streak({ tx, chunks = [], ms = 340 }) {
    return this.#launch({ kind: 'streak', tx, chunks, eph: [], origin: { x: 0, y: 0 }, ms, hop: 0, bounce: false });
  }

  /** The cells under a landed flight are painted: its chunks may go. */
  release(id) {
    if (!id) return;
    const f = this.flights.find((x) => x.id === id);
    if (f) f.released = true;
    if (!this.timer && this.flights.length) this.#frame();
  }

  /** Every square back to its persistent debris — only when nothing is in
   *  the air or held. */
  clear() {
    if (this.flights.some((f) => !f.released)) return;
    for (const sq of this.shown) this.ui.restoreDebris(sq);
    this.shown.clear();
  }

  /** The material's hop height and bounce, for a flight. */
  static arcFor(material) {
    const m = MATERIALS[material] ?? MATERIALS.stone;
    return { hop: m.hop, bounce: material === 'stone' || material === 'clay' };
  }
}
