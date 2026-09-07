// THE FLIGHT (2026-09-07, designer: "what if we visibly see it spray out and
// land on the environment… smashing thru walls with pieces could look so
// cool"). Debris does not appear; it flies. One canvas over the board at the
// board's own pixel grid (board-ui fxCanvas: files×16 by ranks×16, scaled up
// pixelated) draws every live chunk as small rectangles at INTEGER pixel
// coordinates on a pixel-art tick (~15 steps a second — sub-pixel motion
// at sixty frames would be smoother and wrong for this art), and the last
// frame of a flight is the persistent debris pixel for pixel: the painter
// (debris.mjs chunksOf) decided where every chunk lands before it took off,
// so the flight is a tween from the broken thing to a known target, with a
// hop for the arc and a bounce for stone.
//
// Two kinds of chunk fly: the PERSISTENT ones the painter will paint and the
// EPHEMERAL shatter (debris.mjs shatterOf: the broken sprite cut into 2×2
// blocks, most of which fade in the air). A skid is drawn PROGRESSIVELY
// under the sliding piece (streak): the motion draws the mark.
//
// ONE FRAME LOOP for every flight in the air (the first cut gave each flight
// its own loop, and two flights — a capture's spray still airborne when a
// quake's beats began, two skids drawn side by side — cleared each other's
// chunks at fifteen hertz: the designer's "flickering for a split second").
// A flight goes flying → LANDED (its chunks HELD at their final pixels, its
// `landed` promise resolved, so the caller can paint the cells under them)
// → RELEASED (the caller has painted; the chunks leave the canvas). The
// canvas clears only when no flight remains.
//
// Cost: a hundred chunks a frame on a 160×160 canvas — well under a
// millisecond on a phone. Reduced motion / ?fx=0 give ms = 0 and a flight
// lands at once (the debris then simply appears, the painter's path).
import { toArenaPx, MATERIALS } from './debris.mjs';

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
  }

  get busy() {
    return this.flights.length > 0;
  }

  #ctx() {
    return this.ui.fxCanvas.getContext('2d');
  }

  /** Draw one chunk at an env-pixel position (top-left), alpha 0…1. */
  #draw(ctx, tx, c, x, y, alpha = 1) {
    for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) {
      const s = (j * c.w + i) * 4;
      const a = c.px[s + 3];
      if (!a) continue;
      const p = toArenaPx(tx, Math.round(x) + i, Math.round(y) + j);
      if (!p) continue;
      ctx.fillStyle = `rgba(${c.px[s]},${c.px[s + 1]},${c.px[s + 2]},${((a / 255) * alpha).toFixed(3)})`;
      ctx.fillRect(p.x, p.y, 1, 1);
    }
  }

  #drawFlight(ctx, f, u) {
    const { tx, origin, hop } = f;
    if (f.kind === 'streak') {
      for (const c of f.chunks) if (c.t <= u) this.#draw(ctx, tx, c, c.x, c.y);
      return;
    }
    for (const c of f.chunks) {
      const p = Math.min(1, u / c.t);
      const e = easeOut(p);
      const x = origin.x - c.w / 2 + (c.x - (origin.x - c.w / 2)) * e;
      let y = origin.y - c.h / 2 + (c.y - (origin.y - c.h / 2)) * e;
      if (p < 1) y -= hop * Math.sin(Math.PI * p) * (0.6 + 0.4 * c.t);
      else if (f.bounce && c.sz >= 2 && u < c.t + 0.18) y -= Math.round(2 * Math.sin((Math.PI * (u - c.t)) / 0.18));
      this.#draw(ctx, tx, c, x, y);
    }
    for (const c of f.eph) {
      if (u > c.fade + 0.3) continue;
      const p = Math.min(1, u / c.t);
      const e = easeOut(p);
      const x = c.x + (c.tx - c.x) * e;
      const y = c.y + (c.ty - c.y) * e - hop * 1.4 * Math.sin(Math.PI * p);
      const alpha = u < c.fade ? 1 : Math.max(0, 1 - (u - c.fade) / 0.3);
      this.#draw(ctx, tx, c, x, y, alpha);
    }
  }

  /** The one loop: clear once, draw every flight at its own time, land the
   *  ones that are done, drop the released, stop when none remain. */
  #frame() {
    this.timer = null;
    const ctx = this.#ctx();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const now = performance.now();
    this.flights = this.flights.filter((f) => !f.released);
    for (const f of this.flights) {
      const u = Math.min(1, (now - f.t0) / f.ms);
      this.#drawFlight(ctx, f, u);
      if (u >= 1 && !f.landedAt) {
        f.landedAt = now;
        f.resolve();
      }
    }
    this.frames++;
    if (!this.flights.length) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
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

  /** Clear the canvas — only when nothing is in the air or held. */
  clear() {
    if (this.flights.some((f) => !f.released)) return;
    const c = this.ui.fx.querySelector(':scope > canvas.fx-debris');
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  /** The material's hop height and bounce, for a flight. */
  static arcFor(material) {
    const m = MATERIALS[material] ?? MATERIALS.stone;
    return { hop: m.hop, bounce: material === 'stone' || material === 'clay' };
  }
}
