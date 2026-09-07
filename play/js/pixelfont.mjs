// A 3×5 pixel font for the board's edge coordinates (a–l, 0–9) — drawn
// INTO the native buffer, so a coordinate is pixel art on the same grid as
// the floor, like everything else on the canvas board (brief §2 item 5).
// Glyphs are five rows of three characters; '#' is a lit pixel.
const GLYPHS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
  a: ['.#.', '#.#', '###', '#.#', '#.#'],
  b: ['##.', '#.#', '##.', '#.#', '##.'],
  c: ['.##', '#..', '#..', '#..', '.##'],
  d: ['##.', '#.#', '#.#', '#.#', '##.'],
  e: ['###', '#..', '##.', '#..', '###'],
  f: ['###', '#..', '##.', '#..', '#..'],
  g: ['.##', '#..', '#.#', '#.#', '.##'],
  h: ['#.#', '#.#', '###', '#.#', '#.#'],
  i: ['###', '.#.', '.#.', '.#.', '###'],
  j: ['..#', '..#', '..#', '#.#', '.#.'],
  k: ['#.#', '#.#', '##.', '#.#', '#.#'],
  l: ['#..', '#..', '#..', '#..', '###'],
  m: ['#.#', '###', '###', '#.#', '#.#'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
};
export const GLYPH_W = 3;
export const GLYPH_H = 5;

/** Width in pixels of a string set in this font (1-px gaps). */
export function textWidth(s) {
  return s.length ? s.length * GLYPH_W + (s.length - 1) : 0;
}

/**
 * Draw `text` at (x, y) — the top-left of the first glyph — with fillRect
 * calls on a 2D context whose transform is the pixel grid. `shadow`, when
 * given, is painted first one pixel down and right.
 */
export function drawText(ctx, text, x, y, fill, shadow = null) {
  const put = (dx, dy, colour) => {
    ctx.fillStyle = colour;
    let cx = x + dx;
    for (const ch of String(text)) {
      const g = GLYPHS[ch] ?? GLYPHS[ch.toLowerCase()];
      if (g) for (let r = 0; r < GLYPH_H; r++) for (let c = 0; c < GLYPH_W; c++) if (g[r][c] === '#') ctx.fillRect(cx + c, y + dy + r, 1, 1);
      cx += GLYPH_W + 1;
    }
  };
  if (shadow) put(1, 1, shadow);
  put(0, 0, fill);
}
