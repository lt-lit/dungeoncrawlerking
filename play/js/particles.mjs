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
// Two kinds of chunk fly: the PERSISTENT ones the painter will paint (they
// land and hold until the caller commits the cells — commit first, then
// clear the canvas, so the eye never sees a gap) and the EPHEMERAL shatter
// (debris.mjs shatterOf: the broken sprite cut into 2×2 blocks, most of
// which fade in the air). A skid is drawn PROGRESSIVELY under the sliding
// piece (streak): the motion draws the mark.
//
// Cost: a hundred chunks a frame on a 160×160 canvas — well under a
// millisecond on a phone. Reduced motion / ?fx=0 give ms = 0 and every call
// resolves at once (the debris then simply appears, the painter's path).
import { toArenaPx, MATERIALS } from './debris.mjs';

const TICK = 66; // ms between frames — the pixel-art step

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOut = (p) => 1 - (1 - p) * (1 - p);

export class Particles {
  constructor(boardUI) {
    this.ui = boardUI;
    this.live = 0; // flights in the air (a paint commits under them; the canvas clears when the last lands)
    this.frames = 0; // drawn frames (a test surface)
  }

  #ctx() {
    const c = this.ui.fxCanvas;
    return c.getContext('2d');
  }

  get busy() {
    return this.live > 0;
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

  /**
   * Fly chunks from an origin (env px) to their targets. `chunks` are the
   * painter's persistent chunks ({x, y, w, h, px, t}); `eph` the shatter
   * blocks ({x, y, tx, ty, t, fade}); `hop` the arc height in px. Resolves
   * when the last chunk has landed; the caller commits the cells first and
   * THEN calls clear() (or lets the next flight's first frame clear).
   */
  async fly({ tx, chunks = [], eph = [], origin, ms = 320, hop = 5, bounce = false }) {
    if (!ms || (!chunks.length && !eph.length)) return;
    this.live++;
    const ctx = this.#ctx();
    const t0 = performance.now();
    try {
      for (;;) {
        const u = Math.min(1, (performance.now() - t0) / ms);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        for (const c of chunks) {
          const p = Math.min(1, u / c.t);
          const e = easeOut(p);
          let x = origin.x - c.w / 2 + (c.x - (origin.x - c.w / 2)) * e;
          let y = origin.y - c.h / 2 + (c.y - (origin.y - c.h / 2)) * e;
          if (p < 1) y -= hop * Math.sin(Math.PI * p) * (0.6 + 0.4 * c.t);
          else if (bounce && c.sz >= 2 && u < c.t + 0.18) y -= Math.round(2 * Math.sin(Math.PI * (u - c.t) / 0.18));
          this.#draw(ctx, tx, c, x, y);
        }
        for (const c of eph) {
          const p = Math.min(1, u / c.t);
          if (u > c.fade + 0.3) continue;
          const e = easeOut(p);
          const x = c.x + (c.tx - c.x) * e;
          const y = c.y + (c.ty - c.y) * e - hop * 1.4 * Math.sin(Math.PI * Math.min(1, p));
          const alpha = u < c.fade ? 1 : Math.max(0, 1 - (u - c.fade) / 0.3);
          this.#draw(ctx, tx, c, x, y, alpha);
        }
        this.frames++;
        if (u >= 1) break;
        await wait(TICK);
      }
    } finally {
      this.live--;
    }
  }

  /** Draw a skid's chunks progressively over `ms`, in step with the slide. */
  async streak({ tx, chunks = [], ms = 340 }) {
    if (!ms || !chunks.length) return;
    this.live++;
    const ctx = this.#ctx();
    const t0 = performance.now();
    try {
      for (;;) {
        const u = Math.min(1, (performance.now() - t0) / ms);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        for (const c of chunks) if (c.t <= u) this.#draw(ctx, tx, c, c.x, c.y);
        this.frames++;
        if (u >= 1) break;
        await wait(TICK);
      }
    } finally {
      this.live--;
    }
  }

  /** The canvas is empty (nothing in the air). */
  clear() {
    if (this.live) return; // another flight still owns the frame
    const c = this.ui.fx.querySelector(':scope > canvas.fx-debris');
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  /** The material's hop height and bounce, for a flight. */
  static arcFor(material) {
    const m = MATERIALS[material] ?? MATERIALS.stone;
    return { hop: m.hop, bounce: material === 'stone' || material === 'clay' };
  }
}
