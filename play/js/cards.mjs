// THE CARD UI, the pure half (Phase 3.2, 2026-09-25 — the designer, on the
// deck's first card row: "These little buttons aren't gonna cut it. I wanna
// take notes from other card wielding games like mtg arena and hearthstone.
// Probably cast spells by dragging them from the hand to the field, that
// kind of thing"; the four calls of the proposal in brief §4.10 "The card
// UI" agreed the same day). What of the hand can be computed without a DOM:
//
// - THE FAN (`fanLayout`): where n cards sit in a row of a given width — side
//   by side and centred while they fit, overlapping in an even step when
//   they do not (a Hearthstone hand), each card tilted from the middle out
//   and the outer ones dropped a few pixels so the tops trace an arc.
// - THE ART (`cardArt`, `stampGlyph`): a card's face is its spell's own
//   pixel glyph — the portal's ring and the ice's snowflake off
//   pixelarrow.mjs, the same drawings the hint frames wear (rule 19: one
//   art source), so a card reads as its hint — and for the meta cards two
//   drawings of their own: an EYE for Reveal, a COUNTER-CLOCKWISE ARROW for
//   Undo, at the same 11×11 with the same one-pixel drop shadow.
// - THE GESTURE (`gestureStart` / `gestureMove` / `gestureEnd`): one pointer
//   path split three ways — a TAP (under `DRAG_SLOP` of travel, released
//   before `LONG_PRESS_MS`) lifts a card into cast mode, a DRAG (travel past
//   the slop) carries it to the board, a HOLD (the timer, no drag) opens the
//   reader. The page runs the timer; this classifies the samples.
// - THE DROP PREVIEW (`castArea`): the squares a card's cast would touch
//   under the finger — an ice card's whole 3×3 patch on the floor it would
//   freeze (a wall takes no ice), a portal's one square — tinted while the
//   card is dragged and gone on release (the designer's ruling for the ice
//   HINT — "outlines around all 9 tiles is way too loud" — was for a mark
//   that stays; the drag preview vanishes with the finger; agreed 2026-09-25).
// - THE WORDS (`cardHint`, `dropWords`): what a card's face and the ghost's
//   tooltip say.
import { CARDS } from './deck.mjs';
import { SPELL_GLYPHS, SPELL_SHADOW } from './pixelarrow.mjs';
import { isTerrain } from './fen.mjs';

/** A press that travels this many CSS pixels is a drag, not a tap. */
export const DRAG_SLOP = 8;
/** A press held this long without travelling opens the reader. */
export const LONG_PRESS_MS = 450;
/** The fan's tilt at the outer cards, degrees; the arc's drop at the outer cards, pixels. */
export const FAN_MAX_ROT = 7;
export const FAN_ARC = 5;

// THE META CARDS' GLYPHS — 11×11, drawn in the spell glyphs' own idiom (a
// hollow shape, a one-pixel drop shadow): Reveal an EYE (an almond with a
// ringed iris and its pupil), Undo a COUNTER-CLOCKWISE ARROW (the portal's
// ring opened on its left with the head at the top end, pointing down).
export const REVEAL_GLYPH = Object.freeze([
  '...........',
  '...RRRRR...',
  '..R.....R..',
  '.R..RRR..R.',
  'R..R...R..R',
  'R..R.R.R..R',
  'R..R...R..R',
  '.R..RRR..R.',
  '..R.....R..',
  '...RRRRR...',
  '...........',
]);
export const UNDO_GLYPH = Object.freeze([
  '....UUUU...',
  '..UU....UU.',
  '..U......U.',
  'UUU.......U',
  '.U........U',
  '..........U',
  '..........U',
  '..U......U.',
  '..UU....UU.',
  '....UUUU...',
  '...........',
]);
export const META_GLYPHS = Object.freeze({ reveal: REVEAL_GLYPH, undo: UNDO_GLYPH });

/** A card kind's glyph rows: the spell's off pixelarrow (the hint's own drawing), a meta card's from above. Null for an unknown kind. */
export function cardArt(kind) {
  return SPELL_GLYPHS[kind] ?? META_GLYPHS[kind] ?? null;
}

/** A glyph's box with its drop shadow: { w, h } (the shadow adds a pixel right and below). */
export function artSize(kind) {
  const g = cardArt(kind);
  return g ? { w: g[0].length + 1, h: g.length + 1 } : { w: 0, h: 0 };
}

/** Stamp any glyph (rows of '.' and ink) with the spell glyphs' drop shadow — a shadow pixel down and right of every ink pixel where the
 *  glyph has none, then the ink — its top-left at (x, y), whole pixels. The same rule as pixelarrow's drawSpell, for the meta cards too. */
export function stampGlyph(ctx, rows, x, y, colour, shadow = SPELL_SHADOW) {
  const h = rows.length, w = rows[0].length;
  const at = (r, c) => rows[r]?.[c] ?? '.';
  ctx.fillStyle = shadow;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (at(r, c) !== '.' && at(r + 1, c + 1) === '.') ctx.fillRect(x + c + 1, y + r + 1, 1, 1);
  ctx.fillStyle = colour;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (at(r, c) !== '.') ctx.fillRect(x + c, y + r, 1, 1);
}

/**
 * THE FAN: n cards in a row `width` wide, each `cardW` wide. Returns one
 * { x, y, rot } per card — x the card's left edge from the row's left, y a
 * downward drop (the arc), rot a tilt in degrees (negative leans left).
 * Cards that fit side by side (with `gap` between) are centred; cards that
 * do not overlap in an even step so the last card's right edge meets the
 * row's. One card sits centred and upright.
 */
export function fanLayout(n, width, cardW, { gap = 6, maxRot = FAN_MAX_ROT, arc = FAN_ARC } = {}) {
  const out = [];
  if (!(n > 0)) return out;
  const fits = n * cardW + (n - 1) * gap <= width;
  const step = n === 1 ? 0 : fits ? cardW + gap : (width - cardW) / (n - 1);
  const span = n === 1 ? cardW : step * (n - 1) + cardW;
  const x0 = fits ? (width - span) / 2 : 0;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : (i - mid) / mid; // −1 at the left card … +1 at the right
    out.push({ x: Math.round(x0 + i * step), y: Math.round(u * u * arc), rot: Math.round(u * maxRot * 10) / 10 });
  }
  return out;
}

/** THE GESTURE's samples: start a press at (x, y) at time t. */
export function gestureStart(x, y, t = 0) {
  return { x0: x, y0: y, x, y, t0: t, moved: 0, drag: false, held: false };
}

/** A move of the same pointer: the state's travel, and whether it just crossed into a drag (true once). */
export function gestureMove(g, x, y, slop = DRAG_SLOP) {
  g.x = x;
  g.y = y;
  g.moved = Math.max(g.moved, Math.hypot(x - g.x0, y - g.y0));
  if (!g.drag && g.moved > slop) {
    g.drag = true;
    return true;
  }
  return false;
}

/** The hold timer fired before the pointer moved past the slop: the press is a hold (the reader opens; a later release is nothing). */
export function gestureHold(g) {
  if (g.drag) return false;
  g.held = true;
  return true;
}

/** The release: 'drag' (carried past the slop), 'hold' (the timer fired first), else 'tap'. */
export function gestureEnd(g) {
  return g.drag ? 'drag' : g.held ? 'hold' : 'tap';
}

/**
 * THE DROP PREVIEW: the squares a cast on `sq` would touch, for the board to
 * tint under the dragged card. The ice's 3×3 patch on floor (the engine's
 * `ice_patch`: the 3×3 ∩ the board ∩ ~terrain — a wall, a crate, bedrock, a
 * pit take no ice; a piece stands on ice); a portal's own square; nothing
 * for a meta card. `at(sq)` reads the FEN's square (null for empty, a piece
 * letter, or a terrain glyph); `files` / `ranks` bound the board.
 */
export function castArea(kind, sq, { files, ranks, at }) {
  if (!sq || !CARDS[kind] || CARDS[kind].cls !== 'spell') return [];
  const m = sq.match(/^([a-l])(10|[1-9])$/);
  if (!m) return [];
  if (kind !== 'ice') return [sq];
  const f0 = m[1].charCodeAt(0) - 97, r0 = parseInt(m[2], 10);
  const out = [];
  for (let dr = 1; dr >= -1; dr--) {
    for (let df = -1; df <= 1; df++) {
      const f = f0 + df, r = r0 + dr;
      if (f < 0 || f >= files || r < 1 || r > ranks) continue;
      const s = String.fromCharCode(97 + f) + r;
      const c = at(s);
      if (c != null && isTerrain(c)) continue;
      out.push(s);
    }
  }
  return out;
}

/** The face's one line and the reader's line for a card in play: the portal with its half open asks for the link. */
export function cardHint(kind, { halfAt = null } = {}) {
  const c = CARDS[kind];
  if (!c) return '';
  if (kind === 'portal' && halfAt) return `your portal at ${halfAt} is open: pick the square it links to`;
  if (kind === 'portal') return 'cast a portal: pick a square; the second cast links it to the first';
  if (kind === 'ice') return 'cast ice: pick the centre of a 3×3 patch on the middle rows — a piece that moves onto the ice slides on until something stops it';
  return c.text;
}

/** The ghost's tooltip while a card is dragged: over a legal square what the release does, elsewhere nothing. */
export function dropWords(kind, sq, { halfAt = null } = {}) {
  if (!sq) return '';
  if (kind === 'ice') return `release to freeze the floor around ${sq}`;
  if (kind === 'portal') return halfAt ? `release to link the portals ${halfAt}–${sq}` : `release to open a portal at ${sq}`;
  if (kind === 'reveal') return 'release to reveal the oracle’s lines';
  if (kind === 'undo') return 'release to take back the last turn';
  return `release to play on ${sq}`;
}

/** The cost pip's words: a spell is the caster's move, a meta card free. */
export function costWords(kind) {
  return CARDS[kind]?.cost === 'free' ? 'costs no move' : 'costs your move';
}
