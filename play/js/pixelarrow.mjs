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
// centre (pulled a few pixels clear of the piece for an unlabelled arrow)
// to a tip short of the destination's centre, so the head never covers a
// piece. An UNLABELLED arrow (the last move, a displacement) is a 2–3 px
// shaft with a 5-px head. A LABELLED arrow (a hint) is the chunky kind:
// a 5-px shaft and a 6-px head, and THE NUMBER RIDES INSIDE THE SHAFT.
// The first cut set it on a plate beside the shaft and the designer found
// it "way too big"; a second put the digits in an axis-aligned band on the
// shaft, which hung out of every diagonal in rectangular corners. Now the
// digits are a STAIRCASE: every glyph stays upright and each steps along
// the arrow's own direction by the least advance that keeps the 3×5 cells
// apart (4 px of x or 6 px of y, whichever the direction reaches first),
// so a horizontal arrow reads as a line of digits, a vertical one as a
// column, and a knight's move or a diagonal as a flight of steps — read in
// the screen's order, left to right or top to bottom, whichever way the
// arrow points. Each glyph's cell grown by one pixel is a PAD that joins
// the shaft (the shaft bulges a pixel where the digits are), the run sits
// on the shaft's midpoint and backs off toward the tail when it would
// reach into the head. The label is shortened to fit a tile: no leading
// plus, one decimal under ten, whole pawns from ten ("12", "5.1", "-1.2",
// "M3"). A pixel is lit when its centre is within the shaft's half-width
// of the segment, inside the head's triangle or inside a pad; the halo is
// the same test one pixel wider. Every arrow shares one shape; the colour
// says whose (board-ui's kinds and ranks), the opacity nudges with
// strength.
import { drawText, GLYPH_W, GLYPH_H } from './pixelfont.mjs';

export const ARROW_COLOURS = { 'hint-1': '#f2c14e', 'hint-2': '#c9ced8', 'hint-3': '#c8813f', quake: '#7cc8ff', last: '#e0443f' };
const INK = '#14151a';
const HALO = '#000000';

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
export function arrowShape(x1, y1, x2, y2, { label = null, strength = 1 } = {}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  const ux = dx / len, uy = dy / len;
  const text = label ? compactLabel(label) : null;
  const half = text ? 2.5 : 1 + 0.5 * Math.max(0, Math.min(1, strength)); // shaft half-width: 5 px labelled, 2–3 px by strength
  const headLen = text ? 6 : 5, headHalf = text ? 4 : 3;
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
    shaft: [sx, sy, baseX, baseY], half, tri, label: text ? { text, glyphs, pads } : null,
    box: { x0: Math.floor(Math.min(...xs)) - pad, y0: Math.floor(Math.min(...ys)) - pad, x1: Math.ceil(Math.max(...xs)) + pad, y1: Math.ceil(Math.max(...ys)) + pad },
    mid,
  };
}

/**
 * Rasterise one arrow onto `ctx` (its transform the pixel grid): the halo
 * (one pixel wider, black), then the fill, then the label's digits in
 * dark ink. `alpha` is applied to the whole arrow through a scratch
 * canvas so the halo never shows through a translucent fill.
 */
export function drawArrow(ctx, x1, y1, x2, y2, { colour = ARROW_COLOURS['hint-1'], label = null, strength = 1, alpha = 1, scratch = null } = {}) {
  const s = arrowShape(x1, y1, x2, y2, { label, strength });
  if (!s) return;
  const g = scratch ?? ctx;
  if (scratch) {
    scratch.clearRect(0, 0, scratch.canvas.width, scratch.canvas.height);
    scratch.globalAlpha = 1;
  }
  const pads = s.label?.pads ?? [];
  const inPad = (px, py, grow) => pads.some((p) => px >= p.x - grow && px <= p.x + p.w + grow && py >= p.y - grow && py <= p.y + p.h + grow);
  const lit = (px, py, grow) => distToSegment(px, py, s.shaft[0], s.shaft[1], s.shaft[2], s.shaft[3]) <= s.half + grow || distToTriangle(px, py, s.tri) <= grow || inPad(px, py, grow);
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
