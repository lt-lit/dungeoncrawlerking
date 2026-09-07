// PIXEL-ART ARROWS (Phase 2 milestone 1.1, 2026-09-07 — designer: "the
// arrows should probably be in the same rendering system, reworked to fit
// the 16x16 tile art"). The hint arrows, the enemy's last move and the
// gods' displacements are drawn INTO the canvas board's native buffer as
// chunky 16-grid pixels — a shaft, a head, a one-pixel black halo, and the
// eval label in the 3×5 pixel font on a plate at the shaft's midpoint —
// where the DOM board draws them as an SVG overlay (board-ui renderArrows).
// Pure: rasterises onto any 2D context whose transform is the pixel grid.
//
// Geometry, in native pixels: the shaft runs from the origin square's
// centre (pulled a few pixels clear of the piece for an unlabelled arrow)
// to a tip short of the destination's centre, so the head never covers a
// piece; the shaft is 2 px wide (3 with a label), the head 5 px long and
// 3 px to each side. A pixel is lit when its centre is within the shaft's
// half-width of the segment or inside the head's triangle; the halo is the
// same test one pixel wider. Every arrow shares one shape; the colour says
// whose (board-ui's kinds and ranks), the opacity nudges with strength.
import { drawText, textWidth, GLYPH_H } from './pixelfont.mjs';

export const ARROW_COLOURS = { 'hint-1': '#f2c14e', 'hint-2': '#c9ced8', 'hint-3': '#c8813f', quake: '#7cc8ff', last: '#e0443f' };
const INK = '#14151a';
const HALO = '#000000';

/** The colour an arrow wears: its rank for a hint, its kind otherwise. */
export function arrowColour({ kind = 'hint', rank = null }) {
  if (kind === 'quake' || kind === 'last') return ARROW_COLOURS[kind];
  return ARROW_COLOURS[`hint-${rank === 2 || rank === 3 ? rank : 1}`];
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
 * The arrow's shape between two square centres (native px): the shaft
 * segment, the head triangle and the bounding box, or null for a
 * zero-length arrow.
 */
export function arrowShape(x1, y1, x2, y2, { label = null, strength = 1 } = {}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  const ux = dx / len, uy = dy / len;
  const half = label ? 1.5 : 1 + 0.5 * Math.max(0, Math.min(1, strength)); // shaft half-width: 3 px labelled, 2–3 px by strength
  const headLen = 5, headHalf = 3;
  const tail = label ? 0 : 5; // px clear of the origin centre
  const pull = 3; // px short of the destination centre
  const sx = x1 + ux * tail, sy = y1 + uy * tail;
  const tipX = x2 - ux * pull, tipY = y2 - uy * pull;
  const baseX = tipX - ux * headLen, baseY = tipY - uy * headLen;
  const px = -uy, py = ux;
  const tri = [tipX, tipY, baseX + px * headHalf, baseY + py * headHalf, baseX - px * headHalf, baseY - py * headHalf];
  const xs = [sx, tipX, tri[2], tri[4]], ys = [sy, tipY, tri[3], tri[5]];
  const pad = Math.ceil(half + 2);
  return {
    shaft: [sx, sy, baseX, baseY], half, tri,
    box: { x0: Math.floor(Math.min(...xs)) - pad, y0: Math.floor(Math.min(...ys)) - pad, x1: Math.ceil(Math.max(...xs)) + pad, y1: Math.ceil(Math.max(...ys)) + pad },
    mid: [(sx + baseX) / 2, (sy + baseY) / 2],
  };
}

/**
 * Rasterise one arrow onto `ctx` (its transform the pixel grid): the halo
 * (one pixel wider, black), then the fill, then the label's plate and
 * text. `alpha` is applied to the whole arrow through a scratch canvas
 * so the halo never shows through a translucent fill.
 */
export function drawArrow(ctx, x1, y1, x2, y2, { colour = ARROW_COLOURS['hint-1'], label = null, strength = 1, alpha = 1, scratch = null } = {}) {
  const s = arrowShape(x1, y1, x2, y2, { label, strength });
  if (!s) return;
  const g = scratch ?? ctx;
  if (scratch) {
    scratch.clearRect(0, 0, scratch.canvas.width, scratch.canvas.height);
    scratch.globalAlpha = 1;
  }
  const lit = (px, py, grow) => distToSegment(px, py, s.shaft[0], s.shaft[1], s.shaft[2], s.shaft[3]) <= s.half + grow || distToTriangle(px, py, s.tri) <= grow;
  const paint = (grow, fill) => {
    g.fillStyle = fill;
    for (let y = s.box.y0; y <= s.box.y1; y++) for (let x = s.box.x0; x <= s.box.x1; x++) if (lit(x + 0.5, y + 0.5, grow)) g.fillRect(x, y, 1, 1);
  };
  paint(1, HALO);
  paint(0, colour);
  if (label) {
    // A plate on the shaft's midpoint: the arrow's colour, a black outline, the eval in dark ink.
    const w = textWidth(label) + 4, h = GLYPH_H + 4;
    const x = Math.round(s.mid[0] - w / 2), y = Math.round(s.mid[1] - h / 2);
    g.fillStyle = HALO;
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = colour;
    g.fillRect(x, y, w, h);
    drawText(g, label, x + 2, y + 2, INK);
  }
  if (scratch) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratch.canvas, 0, 0);
    ctx.globalAlpha = 1;
  }
}
