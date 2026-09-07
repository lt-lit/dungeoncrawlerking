// PIXEL-ART ARROWS (Phase 2 milestone 1.1, 2026-09-07 — designer: "the
// arrows should probably be in the same rendering system, reworked to fit
// the 16x16 tile art"). The hint arrows, the enemy's last move and the
// gods' displacements are drawn INTO the canvas board's native buffer as
// chunky 16-grid pixels — a shaft, a head, a one-pixel black halo, and the
// eval label in the 3×5 pixel font INSIDE the shaft — where the DOM board
// draws them as an SVG overlay (board-ui renderArrows). Pure: rasterises
// onto any 2D context whose transform is the pixel grid.
//
// Geometry, in native pixels: the shaft runs from the origin square's
// centre, pulled a few pixels clear of the piece, to a tip short of the
// destination's centre, so the head never covers a piece. THE STYLE is
// the player's (Options → Look: `width`, the shaft in floor pixels 1–5,
// and `alpha`, the opacity — designer 2026-09-07: "make the arrows
// thinner. A thickness and opacity dial wouldn't hurt"): the head grows
// with the shaft (width + 3 long, width + 1 to each side), an odd width
// runs through a pixel centre and an even one along a pixel boundary so
// a horizontal or vertical shaft is exactly `width` rows, and the opacity
// is the dial's scaled by the arrow's strength (arrowAlpha). The hint
// arrows carry NO NUMBER — the designer cut the evals off the arrows the
// same day ("not worth keeping"; a plate beside the shaft had been "way
// too big", a staircase of digits inside it small enough but not worth
// the clutter) and the hint line under the board lists them instead. A
// LABEL is still drawn when a caller asks for one (the replay page
// numbers its PV arrows): a 5-px shaft with a 6-px head and the digits a
// STAIRCASE inside it — every 3×5 glyph upright, each stepping along the
// arrow's own direction by the least advance that keeps the cells apart
// (4 px of x or 6 px of y), a line on a horizontal arrow, a column on a
// vertical one, a flight of steps on a diagonal, read in the screen's
// order; each glyph's cell grown by a pixel is a PAD the shaft bulges to,
// and the run backs off toward the tail when it would reach into the
// head; the label is compacted to a tile ("12", "5.1", "-1.2", "M3"). A
// pixel is lit when its centre is within the shaft's half-width of the
// segment, inside the head's triangle or inside a pad; the halo is the
// same test one pixel wider. Every arrow shares one shape; the colour
// says whose (board-ui's kinds and ranks).
import { drawText, GLYPH_W, GLYPH_H } from './pixelfont.mjs';

export const ARROW_COLOURS = { 'hint-1': '#f2c14e', 'hint-2': '#c9ced8', 'hint-3': '#c8813f', quake: '#7cc8ff', last: '#e0443f' };
const INK = '#14151a';
const HALO = '#000000';

/** The arrow style dials: the shaft's width in floor pixels and the
 *  opacity at full strength. Both boards take a style through
 *  `setArrowStyle`; main.mjs keeps it in the Options. */
export const ARROW_STYLE_DEFAULT = Object.freeze({ width: 2, alpha: 0.85 });
export const ARROW_WIDTH_RANGE = [1, 5];
export const ARROW_ALPHA_RANGE = [0.2, 1];

/** A clamped, whole-pixel copy of a style (missing or bad fields → the defaults). */
export function normalizeArrowStyle(style) {
  const w = Math.round(Number(style?.width)), a = Number(style?.alpha);
  return {
    width: Number.isFinite(w) ? Math.min(ARROW_WIDTH_RANGE[1], Math.max(ARROW_WIDTH_RANGE[0], w)) : ARROW_STYLE_DEFAULT.width,
    alpha: Number.isFinite(a) ? Math.min(ARROW_ALPHA_RANGE[1], Math.max(ARROW_ALPHA_RANGE[0], Math.round(a * 100) / 100)) : ARROW_STYLE_DEFAULT.alpha,
  };
}

/** An arrow's opacity: the style's alpha at full strength, 60% of it at none. */
export function arrowAlpha(alpha, strength = 1) {
  const s = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1));
  return Math.max(0, Math.min(1, alpha * (0.6 + 0.4 * s)));
}

/** The colour an arrow wears: its rank for a hint, its kind otherwise. */
export function arrowColour({ kind = 'hint', rank = null }) {
  if (kind === 'quake' || kind === 'last') return ARROW_COLOURS[kind];
  return ARROW_COLOURS[`hint-${rank === 2 || rank === 3 ? rank : 1}`];
}

/** The label as the arrow carries it: no leading plus, a plain minus, one
 *  decimal under ten pawns and whole pawns from ten, mates as "M3". */
export function compactLabel(label) {
  if (label == null) return null;
  let t = String(label).replace(/−/g, '-').replace(/^\+/, '');
  const m = t.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (m) {
    const whole = parseInt(m[2], 10);
    t = whole >= 10 || !m[3] ? `${m[1]}${whole}` : `${m[1]}${whole}.${m[3][0]}`;
  }
  return t;
}

/** Draw order: quake arrows first (underneath), the last move, then hints
 *  worst to best so the best is on top — board-ui renderArrows' order. */
export function sortArrows(arrows) {
  const key = (a) => (a.kind === 'quake' ? -100 : a.kind === 'last' ? -90 : -(a.rank ?? 2 - (a.strength ?? 1)));
  return [...arrows].sort((a, b) => key(a) - key(b));
}

const distToSegment = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  const qx = x1 + t * dx, qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
};
const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
const inTriangle = (px, py, t) => {
  const d1 = sign(px, py, t[0], t[1], t[2], t[3]), d2 = sign(px, py, t[2], t[3], t[4], t[5]), d3 = sign(px, py, t[4], t[5], t[0], t[1]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const distToTriangle = (px, py, t) => (inTriangle(px, py, t) ? 0 : Math.min(distToSegment(px, py, t[0], t[1], t[2], t[3]), distToSegment(px, py, t[2], t[3], t[4], t[5]), distToSegment(px, py, t[4], t[5], t[0], t[1])));

/**
 * The digits' staircase along a direction (ux, uy): the whole-pixel step
 * from one glyph to the next — the least advance along the arrow that
 * keeps neighbouring 3×5 cells a pixel apart — pointing the screen's
 * reading way (rightward on a horizontal-ish arrow, downward on a
 * vertical-ish one), and that advance's length.
 */
export function glyphStep(ux, uy) {
  const a = Math.min(ux ? (GLYPH_W + 1) / Math.abs(ux) : Infinity, uy ? (GLYPH_H + 1) / Math.abs(uy) : Infinity);
  let sx = Math.round(ux * a), sy = Math.round(uy * a);
  if (Math.abs(ux) >= Math.abs(uy) ? sx < 0 : sy < 0) { sx = -sx; sy = -sy; }
  return { sx, sy, a };
}

/**
 * The arrow's shape between two square centres (native px): the shaft
 * segment, the head triangle, the label's glyphs and pads, and the
 * bounding box — or null for a zero-length arrow.
 */
export function arrowShape(x1, y1, x2, y2, { label = null, width = ARROW_STYLE_DEFAULT.width } = {}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  const ux = dx / len, uy = dy / len;
  const text = label ? compactLabel(label) : null;
  const w = text ? 5 : normalizeArrowStyle({ width }).width; // the shaft in pixels: the style's, or 5 so the digits fit
  // An odd shaft runs through a pixel centre, an even one along a pixel
  // boundary: a square's centre (8, 8) is a boundary, so shift the odd ones
  // half a pixel and a horizontal or vertical shaft is exactly `w` rows.
  const off = w % 2 ? -0.5 : 0;
  x1 += off; y1 += off; x2 += off; y2 += off;
  const half = w / 2;
  const headLen = text ? 6 : w + 3, headHalf = text ? 4 : w + 1;
  const tail = text ? 0 : 5; // px clear of the origin centre
  const pull = 3; // px short of the destination centre
  const sx = x1 + ux * tail, sy = y1 + uy * tail;
  const tipX = x2 - ux * pull, tipY = y2 - uy * pull;
  const baseX = tipX - ux * headLen, baseY = tipY - uy * headLen;
  const px = -uy, py = ux;
  const tri = [tipX, tipY, baseX + px * headHalf, baseY + py * headHalf, baseX - px * headHalf, baseY - py * headHalf];
  const mid = [(sx + baseX) / 2, (sy + baseY) / 2];
  const shaftLen = Math.hypot(baseX - sx, baseY - sy);
  // The digits: a staircase of upright glyphs stepping along the arrow,
  // centred on the shaft's midpoint, backed off toward the tail when the
  // run would reach into the head. Each glyph's cell grown by one pixel
  // is a pad the shaft wears.
  let glyphs = null, pads = null;
  if (text) {
    const n = text.length;
    const { sx: stx, sy: sty, a } = glyphStep(ux, uy);
    const runHalf = ((n - 1) * a + Math.abs(ux) * (GLYPH_W + 2) + Math.abs(uy) * (GLYPH_H + 2)) / 2;
    const c = Math.min(shaftLen / 2, shaftLen - runHalf);
    const cx = sx + ux * c, cy = sy + uy * c;
    const gx0 = Math.round(cx - ((n - 1) / 2) * stx) - (GLYPH_W >> 1), gy0 = Math.round(cy - ((n - 1) / 2) * sty) - (GLYPH_H >> 1);
    glyphs = []; pads = [];
    for (let i = 0; i < n; i++) {
      const gx = gx0 + i * stx, gy = gy0 + i * sty;
      glyphs.push({ ch: text[i], x: gx, y: gy });
      pads.push({ x: gx - 1, y: gy - 1, w: GLYPH_W + 2, h: GLYPH_H + 2 });
    }
  }
  const xs = [sx, tipX, tri[2], tri[4], ...(pads ?? []).flatMap((p) => [p.x, p.x + p.w])], ys = [sy, tipY, tri[3], tri[5], ...(pads ?? []).flatMap((p) => [p.y, p.y + p.h])];
  const pad = Math.ceil(half + 2);
  return {
    shaft: [sx, sy, baseX, baseY], half, width: w, tri, label: text ? { text, glyphs, pads } : null,
    box: { x0: Math.floor(Math.min(...xs)) - pad, y0: Math.floor(Math.min(...ys)) - pad, x1: Math.ceil(Math.max(...xs)) + pad, y1: Math.ceil(Math.max(...ys)) + pad },
    mid,
  };
}

/**
 * Rasterise one arrow onto `ctx` (its transform the pixel grid): the halo
 * (one pixel wider, black), then the fill, then the label's digits in
 * dark ink. `width` is the style's shaft (floor pixels); `alpha` is applied
 * to the whole arrow through a scratch canvas so the halo never shows
 * through a translucent fill (the caller scales it by strength — arrowAlpha).
 */
export function drawArrow(ctx, x1, y1, x2, y2, { colour = ARROW_COLOURS['hint-1'], label = null, width = ARROW_STYLE_DEFAULT.width, alpha = 1, scratch = null } = {}) {
  const s = arrowShape(x1, y1, x2, y2, { label, width });
  if (!s) return;
  const g = scratch ?? ctx;
  if (scratch) {
    scratch.clearRect(0, 0, scratch.canvas.width, scratch.canvas.height);
    scratch.globalAlpha = 1;
  }
  const pads = s.label?.pads ?? [];
  const inPad = (px, py, grow) => pads.some((p) => px >= p.x - grow && px <= p.x + p.w + grow && py >= p.y - grow && py <= p.y + p.h + grow);
  const lit = (px, py, grow) => distToSegment(px, py, s.shaft[0], s.shaft[1], s.shaft[2], s.shaft[3]) < s.half + grow || distToTriangle(px, py, s.tri) <= grow || inPad(px, py, grow);
  const paint = (grow, fill) => {
    g.fillStyle = fill;
    for (let y = s.box.y0; y <= s.box.y1; y++) for (let x = s.box.x0; x <= s.box.x1; x++) if (lit(x + 0.5, y + 0.5, grow)) g.fillRect(x, y, 1, 1);
  };
  paint(1, HALO);
  paint(0, colour);
  if (s.label) for (const gl of s.label.glyphs) drawText(g, gl.ch, gl.x, gl.y, INK); // the digits inside the shaft, stepping along the arrow
  if (scratch) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratch.canvas, 0, 0);
    ctx.globalAlpha = 1;
  }
}
