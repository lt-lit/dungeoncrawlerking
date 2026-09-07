// THE FLIGHT (2026-09-07, designer: "what if we visibly see it spray out and
// land on the environment… smashing thru walls with pieces could look so
// cool"). Debris does not appear; it flies. On a pixel-art tick (~15 steps
// a second — sub-pixel motion at sixty frames would be smoother and wrong
// for this art) every live chunk is drawn as PIXELS OF THE 16-GRID into a
// second SVG over the board (board-ui flightSvg: the arrow layer's twin,
// same viewBox, above the pieces and below the FLIP clones) — one <path>
// per colour, every pixel a unit square at tile coordinates, crisp edges.
// The last frame of a flight is the persistent debris pixel for pixel: the
// painter (debris.mjs chunksOf) decided where every chunk lands before it
// took off, so the flight is a tween from the broken thing to a known
// target, with a hop for the arc and a bounce for stone.
//
// Why an SVG and not a canvas: three cuts of this flight drew on a canvas —
// board-wide on the fx layer, board-wide under z-indexed pieces (which
// made Firefox drop every positioned child of the cells for a frame), and
// per cell into the debris canvases (which coincided with pieces vanishing
// for whole seconds on a desktop Firefox while idle). The game now has no
// canvas on the board at all; the flight rides the SVG the hint arrows
// already ride. A chunk in the air passes IN FRONT of a piece (the layer
// is above the pieces — the only place a board-wide layer can be without
// giving the pieces a z-index); the landed debris is under them.
//
// Two kinds of chunk fly: the PERSISTENT ones the painter will paint and the
// EPHEMERAL shatter (debris.mjs shatterOf: the broken sprite cut into 2×2
// blocks, most of which fade in the air). A skid is drawn PROGRESSIVELY
// under the sliding piece (streak): the motion draws the mark.
//
// ONE FRAME LOOP for every flight in the air. A flight goes flying →
// LANDED (its chunks held at their final pixels, its `landed` promise
// resolved, so the caller can paint the persistent debris under them) →
// RELEASED (the caller has painted; the chunks leave). The group is
// removed when no flight remains.
//
// Phase 2 (2026-09-07): on the CANVAS BOARD (canvas-board.mjs) the same
// frame goes to `ui.drawFlight(pixels)` — pixels in its native buffer,
// above the pieces — instead of SVG paths; the flight model is unchanged.
//
// Cost: a few hundred unit squares in a handful of path strings per frame.
// Reduced motion / ?fx=0 give ms = 0 and a flight lands at once (the debris
// then simply appears).
import { toArenaPx, MATERIALS, T } from './debris.mjs';

const TICK = 66; // ms between frames — the pixel-art step
const SVG_NS = 'http://www.w3.org/2000/svg';
const CELL = 10; // SVG units per cell (board-ui's viewBox)
const PX = CELL / T; // SVG units per tile pixel

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

  /** Add one chunk's pixels at an env-pixel position (top-left) to the
   *  per-colour path strings, alpha 0…1 (quantised to quarters). */
  #stamp(paths, tx, c, x, y, alpha = 1) {
    const bx = Math.round(x), by = Math.round(y);
    for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) {
      const s = (j * c.w + i) * 4;
      const a = (c.px[s + 3] / 255) * alpha;
      if (a <= 0.02) continue;
      const p = toArenaPx(tx, bx + i, by + j);
      if (!p) continue;
      const q = Math.round(a * 4) / 4;
      const key = `${c.px[s]},${c.px[s + 1]},${c.px[s + 2]}|${q}`;
      let list = paths.get(key);
      if (!list) paths.set(key, (list = []));
      list.push(p.x, p.y);
    }
  }

  /** Present a frame's pixels: on a board that draws its own flight (the
   *  canvas board's drawFlight — pixels in its buffer above the pieces),
   *  hand them over as a flat list; otherwise one SVG path per colour. */
  #present(paths) {
    if (typeof this.ui.drawFlight === 'function') {
      const out = [];
      for (const [key, list] of paths) {
        const [rgb, q] = key.split('|');
        const a = parseFloat(q);
        for (let i = 0; i < list.length; i += 2) out.push({ rgb, a, x: list[i], y: list[i + 1] });
      }
      this.ui.drawFlight(out);
      return;
    }
    const g = this.#group();
    const els = [...g.children];
    let i = 0;
    for (const [key, list] of paths) {
      const [rgb, q] = key.split('|');
      let d = '';
      for (let j = 0; j < list.length; j += 2) d += `M${(list[j] * PX).toFixed(3)} ${(list[j + 1] * PX).toFixed(3)}h${PX}v${PX}h-${PX}z`;
      const el = els[i] ?? g.appendChild(document.createElementNS(SVG_NS, 'path'));
      el.setAttribute('d', d);
      el.setAttribute('fill', `rgb(${rgb})`);
      if (q !== '1') el.setAttribute('fill-opacity', q);
      else el.removeAttribute('fill-opacity');
      i++;
    }
    for (let k = els.length - 1; k >= i; k--) els[k].remove();
  }

  #stampFlight(paths, f, u) {
    const { tx, origin, hop } = f;
    if (f.kind === 'streak') {
      for (const c of f.chunks) if (c.t <= u) this.#stamp(paths, tx, c, c.x, c.y);
      return;
    }
    for (const c of f.chunks) {
      const p = Math.min(1, u / c.t);
      const e = easeOut(p);
      const x = origin.x - c.w / 2 + (c.x - (origin.x - c.w / 2)) * e;
      let y = origin.y - c.h / 2 + (c.y - (origin.y - c.h / 2)) * e;
      if (p < 1) y -= hop * Math.sin(Math.PI * p) * (0.6 + 0.4 * c.t);
      else if (f.bounce && c.sz >= 2 && u < c.t + 0.18) y -= Math.round(2 * Math.sin((Math.PI * (u - c.t)) / 0.18));
      this.#stamp(paths, tx, c, x, y);
    }
    for (const c of f.eph) {
      if (u > c.fade + 0.3) continue;
      const p = Math.min(1, u / c.t);
      const e = easeOut(p);
      const x = c.x + (c.tx - c.x) * e;
      const y = c.y + (c.ty - c.y) * e - hop * 1.4 * Math.sin(Math.PI * p);
      const alpha = u < c.fade ? 1 : Math.max(0, 1 - (u - c.fade) / 0.3);
      this.#stamp(paths, tx, c, x, y, alpha);
    }
  }

  #group() {
    const svg = this.ui.flightSvg;
    let g = svg.querySelector(':scope > g.flight');
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'flight');
      svg.appendChild(g);
    }
    return g;
  }

  /** The one loop: gather every flight's pixels at its own time into
   *  per-colour paths, replace the group's paths, land the flights that
   *  are done, drop the released, stop when none remain. */
  #frame() {
    this.timer = null;
    const now = performance.now();
    this.flights = this.flights.filter((f) => !f.released);
    const paths = new Map();
    for (const f of this.flights) {
      const u = Math.min(1, (now - f.t0) / f.ms);
      this.#stampFlight(paths, f, u);
      if (u >= 1 && !f.landedAt) {
        f.landedAt = now;
        f.resolve();
      }
    }
    if (!this.flights.length) {
      this.clear();
      return;
    }
    this.#present(paths);
    this.frames++;
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

  /** The flight group gone — only when nothing is in the air or held. */
  clear() {
    if (this.flights.some((f) => !f.released)) return;
    if (typeof this.ui.drawFlight === 'function') this.ui.drawFlight(null);
    else this.ui.container.querySelector(':scope > svg.flight-layer > g.flight')?.remove();
  }

  /** The material's hop height and bounce, for a flight. */
  static arcFor(material) {
    const m = MATERIALS[material] ?? MATERIALS.stone;
    return { hop: m.hop, bounce: material === 'stone' || material === 'clay' };
  }
}
