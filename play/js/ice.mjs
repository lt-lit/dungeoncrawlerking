// THE ICE — the slide on the grid (2026-09-20; brief §4.9; engine/patches/
// ice.patch). The engine's physics (`Position::slide_outcome`), mirrored for
// the game's own grid code: the page animates a slide leg by leg, lights the
// square a piece will END on, writes the log, and the analyzer draws the
// arrow to the resting square — all off this one function, never off a
// second reading of the rules. The engine (and its oracle, engine/forge/
// oracle.py) is the source of truth; `test-ice-game.mjs` and the selftest
// hold this module to the engine's own board after every slide move.
//
// THE RULES (the designer's, 2026-09-20, exactly and with no special cases):
// a piece that ENDS its move on a slippery square keeps sliding in the
// direction it moved until it is not on a slippery square any more, or until
// it hits a wall, a crate, the edge or another piece. A pit swallows what
// slides into it (a piece is gone; the side whose KING fell has lost, and a
// move that drops your own king in is illegal, as ever). Momentum passes:
// when a slider bumps into a piece STANDING ON ICE, the slider stops where it
// is and the piece it hit slides on the same way — either colour, kings
// included, a chain as long as the ice; a slide never captures. A portal
// square is never slippery: a slide that reaches an EMPTY portal square is a
// landing (out of the twin, swapping with whatever stands there, at rest); a
// piece on a portal square is an obstacle. A knight lands where it jumps (no
// direction, no slide). A capture on ice slides the captor on (en passant
// included). A pawn that STOPS on its promotion zone promotes — its own move
// to the piece the move names, a shoved pawn to the strongest. Only the
// square a move ENTERS matters: a rider's line runs over ice without
// stopping, and the engine lists its quiet move onto a run of ice ONCE, at
// the last empty ice square before what stops it (`slideEnds`' aliases light
// the resting square on the page).
import { parseBoard, splitFen, serializeBoard, parsePortalField, slickSquares, squareName, parseSquare, isTerrain, PIT, WALL, HARD, FURNITURE } from './fen.mjs';

const MOVE_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))([a-zA-Z]?)$/;
const STRONGEST = 'q';

/** The unit step of a line move, or null for a leap (a knight) or a pass. */
export function slideDirection(from, to) {
  const a = parseSquare(from), b = parseSquare(to);
  const df = b.file - a.file, dr = b.rankFromBottom - a.rankFromBottom;
  if ((df === 0 && dr === 0) || (df && dr && Math.abs(df) !== Math.abs(dr))) return null;
  return { df: Math.sign(df), dr: Math.sign(dr) };
}

const isWhite = (ch) => ch === ch.toUpperCase();

/** A pawn that stops on its promotion zone promotes: to the piece named, else the strongest. */
function promote(ch, r, ranks, named) {
  if (ch.toLowerCase() !== 'p') return ch;
  const zone = isWhite(ch) ? ranks - 1 : 0;
  if (r !== zone) return ch;
  const p = (named || STRONGEST).toLowerCase();
  return isWhite(ch) ? p.toUpperCase() : p;
}

/**
 * What a move does on the ice, or null when it does not slide (its
 * destination is not slippery, is a portal square, or the move is a leap).
 * `fenBefore` is the position the move is played on, `uci` the move
 * (`e2e4`, `e6e7q`). Returns {
 *   dir:   { df, dr }              — the slide's direction (the move's own)
 *   steps: [{ piece, from, to, pit, landing, promoted, mover }]
 *          one per piece that slid, in order — the mover first, then each
 *          piece it (or the last slider) shoved. `from` is where the slide
 *          began (the move's destination for the mover), `to` where the
 *          piece rests (a portal landing's twin), or null when it FELL —
 *          `pit` then names the pit. `landing` = { entry, twin, swapped }
 *          for a slide that reached an empty portal square (`swapped` the
 *          piece that came back to the entry, or null). `promoted` is the
 *          letter a pawn became, else null.
 *   board: the board field after the move (the grid's own reading — the
 *          engine's is the truth; the gates compare them)
 * }
 */
export function slideOutcome(fenBefore, uci) {
  const m = String(uci ?? '').match(MOVE_RE);
  if (!m) return null;
  const [, from, to, promoSuffix] = m;
  if (from === to) return null;
  const F = splitFen(fenBefore);
  const rows = parseBoard(F.board);
  const ranks = rows.length;
  const files = Math.max(...rows.map((r) => r.length));
  const g = Array.from({ length: ranks }, () => Array(files).fill(null));
  rows.forEach((row, ri) => row.forEach((c, f) => { g[ranks - 1 - ri][f] = c; }));
  const P = parsePortalField(fenBefore);
  const slick = slickSquares(fenBefore);
  const at = (sq) => { const s = parseSquare(sq); return { f: s.file, r: s.rankFromBottom }; };
  const on = (f, r) => f >= 0 && f < files && r >= 0 && r < ranks;
  const a = at(from), b = at(to);
  const ch = g[a.r]?.[a.f];
  if (!ch || isTerrain(ch)) return null;
  if (P.twin.has(to) || !slick.has(to)) return null; // a landing on a portal, or plain floor: no slide
  const dir = slideDirection(from, to);
  if (!dir) return null; // a leap rests where it lands
  // The move itself: the mover leaves, the victim goes (a piece, a crate, the en passant pawn).
  g[a.r][a.f] = null;
  const white = isWhite(ch);
  const up = white ? 1 : -1;
  if (ch.toLowerCase() === 'p' && g[b.r][b.f] === null && a.f !== b.f) {
    const eps = String(F.ep ?? '-').split(',').filter((s) => s && s !== '-');
    if (eps.includes(to) && on(b.f, b.r - up)) g[b.r - up][b.f] = null; // en passant: the pawn beside the landing
  }
  g[b.r][b.f] = null;
  let mover = promote(ch, b.r, ranks, promoSuffix); // a pawn landing on the zone promotes before it slides
  g[b.r][b.f] = mover;
  const steps = [];
  let sq = { f: b.f, r: b.r };
  let pc = mover;
  let isMover = true;
  for (;;) {
    let cur = sq;
    let landing = null;
    let shoved = null;
    let pit = null;
    for (;;) {
      const nf = cur.f + dir.df, nr = cur.r + dir.dr;
      if (!on(nf, nr)) break;
      const occ = g[nr][nf];
      if (occ === WALL || occ === HARD || occ === FURNITURE) break; // a wall, a crate: stop here
      if (occ === PIT) { pit = { f: nf, r: nr }; break; } // a pit: gone
      const name = squareName(nf, nr);
      if (P.twin.has(name)) {
        if (occ === null) landing = { f: nf, r: nr }; // an empty portal square: a landing on it
        break; // a piece on one is an obstacle
      }
      if (occ !== null) {
        if (slick.has(name)) shoved = { f: nf, r: nr }; // a piece on ice: it takes the momentum
        break; // stop before it either way
      }
      if (slick.has(name)) { cur = { f: nf, r: nr }; continue; } // empty ice: slide on
      landing = { f: nf, r: nr }; // empty floor: land
      break;
    }
    const before = pc;
    g[sq.r][sq.f] = null;
    const step = { piece: before, from: squareName(sq.f, sq.r), to: null, pit: null, landing: null, promoted: null, mover: isMover };
    const named = isMover ? promoSuffix : null;
    if (pit) {
      step.pit = squareName(pit.f, pit.r);
    } else if (landing && P.twin.has(squareName(landing.f, landing.r))) {
      const entry = squareName(landing.f, landing.r);
      const twinName = P.twin.get(entry);
      const q = at(twinName);
      const sw = g[q.r][q.f];
      const placed = promote(pc, q.r, ranks, named);
      g[q.r][q.f] = placed;
      if (sw !== null) g[landing.r][landing.f] = sw;
      step.to = twinName;
      step.landing = { entry, twin: twinName, swapped: sw ?? null };
      if (placed !== pc) step.promoted = placed;
    } else {
      const end = landing ?? cur;
      const placed = promote(pc, end.r, ranks, named);
      g[end.r][end.f] = placed;
      step.to = squareName(end.f, end.r);
      if (placed !== pc) step.promoted = placed;
    }
    steps.push(step);
    if (!shoved) break;
    sq = shoved;
    pc = g[shoved.r][shoved.f];
    isMover = false;
  }
  const board = Array.from({ length: ranks }, (_, ri) => g[ranks - 1 - ri].slice());
  return { dir, steps, board: serializeBoard(board) };
}

/** The mover's resting square of a move, or the move's destination when it
 *  does not slide; null when the mover fell into a pit. */
export function slideEnd(fenBefore, uci) {
  const o = slideOutcome(fenBefore, uci);
  if (!o) { const m = String(uci ?? '').match(MOVE_RE); return m ? m[2] : null; }
  return o.steps[0].to;
}

/**
 * THE RESTING SQUARES a piece's legal moves end on, as aliases of the moves
 * (the page lights them beside the destinations, and a tap on one plays the
 * move that slides there): Map(restingSquare → uci) for every legal move
 * from `from` that slides to a square that is not itself a destination of
 * one of them. A move whose mover falls into a pit maps its pit square.
 */
export function slideAliases(fenBefore, from, legalMoves) {
  const out = new Map();
  const dests = new Set();
  const mine = [];
  for (const u of legalMoves) {
    const m = String(u).match(MOVE_RE);
    if (!m || m[1] !== from) continue;
    dests.add(m[2]);
    mine.push(u);
  }
  for (const u of mine) {
    const o = slideOutcome(fenBefore, u);
    if (!o) continue;
    const s = o.steps[0];
    const end = s.to ?? s.pit;
    if (end && !dests.has(end) && !out.has(end)) out.set(end, u);
  }
  return out;
}

/** The pieces a slide lost to a pit: [{ piece, pit }]. */
export function fallen(outcome) {
  return (outcome?.steps ?? []).filter((s) => s.pit).map((s) => ({ piece: s.piece, pit: s.pit }));
}
